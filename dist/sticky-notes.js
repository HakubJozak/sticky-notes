const LAYER_SELECTOR = ".sticky-notes-bar, .sticky-notes-export, .sticky-notes-leaders, .sticky-notes-screenshot, .sticky-note, .sticky-note-badge";
const DEFAULT_ANCHORS$1 = ["data-testid", "data-test"];
const GENERATED_ID = /^(?:[0-9a-f-]{20,}|radix-|headlessui-|mui-|react-|:)/i;
const WEAK_ANCHOR_SEGMENT = /\[(name|action)=/;
const CONTEXT_TAGS = "h1,h2,h3,h4,caption,legend";
const CONTEXT_MAX = 80;
const EXCERPT_MAX = 120;
const ELEMENT_NODE = 1;
const DOCUMENT_POSITION_FOLLOWING = 4;
const attr = (name, value) => `[${name}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
const textOf = (el) => el ? el.innerText ?? el.textContent ?? "" : "";
const condense = (text, max) => String(text).trim().replace(/\s+/g, " ").slice(0, max);
function cssPath(el, { anchors = DEFAULT_ANCHORS$1 } = {}) {
  const doc = el.ownerDocument;
  const parts = [];
  let node = el;
  let anchored = false;
  while (node && node.nodeType === ELEMENT_NODE && node !== doc.body) {
    const strong = strongAnchor(node, anchors, doc);
    if (strong) {
      parts.unshift(strong);
      anchored = true;
      break;
    }
    const segment = segmentOf(node);
    anchored || (anchored = WEAK_ANCHOR_SEGMENT.test(segment));
    parts.unshift(segment);
    node = node.parentNode;
  }
  return { path: parts.join(" > "), anchored };
}
function strongAnchor(el, anchors, doc) {
  const name = anchors.find((a) => el.getAttribute(a));
  if (name) return attr(name, el.getAttribute(name));
  return uniqueId(el, doc);
}
function uniqueId(el, doc) {
  const id = el.id;
  if (!id || GENERATED_ID.test(id)) return "";
  const escaped = CSS.escape(id);
  if (doc.querySelectorAll(`#${escaped}`).length !== 1) return "";
  return `#${escaped}`;
}
function segmentOf(el) {
  const tag = el.tagName.toLowerCase();
  const siblings = [...el.parentNode.children].filter((c) => c.tagName === el.tagName);
  const unique = (selector) => siblings.filter((c) => c.matches(selector)).length === 1;
  const weak = [
    ["name", el.name],
    ["action", el.getAttribute("action")],
    ["data-controller", el.dataset?.controller]
  ].find(([name, value]) => value && unique(tag + attr(name, value)));
  if (weak) return tag + attr(...weak);
  if (siblings.length === 1) return tag;
  return `${tag}:nth-of-type(${siblings.indexOf(el) + 1})`;
}
function contextOf(el) {
  const doc = el.ownerDocument;
  let context = "";
  for (const heading of doc.querySelectorAll(CONTEXT_TAGS)) {
    if (heading.closest(LAYER_SELECTOR)) continue;
    if (!(heading.compareDocumentPosition(el) & DOCUMENT_POSITION_FOLLOWING)) continue;
    context = condense(textOf(heading), CONTEXT_MAX);
  }
  return context;
}
function excerpt(el) {
  const text = textOf(el) || el.value || labelOf(el) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.alt || "";
  return condense(text, EXCERPT_MAX);
}
function labelOf(el) {
  const doc = el.ownerDocument;
  const linked = el.id && doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  return textOf(linked || el.closest("label"));
}
const KEY_PREFIX = "sticky-notes:";
const LEGACY_KEY_PREFIX = "kz-notes:";
function createStore(storage, key) {
  const storageKey = KEY_PREFIX + key;
  const legacyKey = LEGACY_KEY_PREFIX + key;
  const load = () => read(storage, storageKey) ?? migrate(storage, legacyKey, storageKey);
  const save = (notes) => write(storage, storageKey, notes);
  return { load, save };
}
function migrate(storage, legacyKey, storageKey) {
  const legacy = read(storage, legacyKey);
  if (!legacy) return [];
  write(storage, storageKey, legacy);
  remove(storage, legacyKey);
  return legacy;
}
function read(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function write(storage, key, notes) {
  try {
    storage.setItem(key, JSON.stringify(notes));
  } catch {
  }
}
function remove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
  }
}
const MARKDOWN = "markdown";
const JSON_FORMAT = "json";
const EMPTY_TEXT = "—";
const EMPTY_NOTE = "(no comment)";
const ORPHAN_FLAG = "(element not found on this version of the page)";
const UNANCHORED_FLAG = "(unanchored — give the container an id)";
const SCREENSHOT_LINE = "screenshot: ";
const JSON_INDENT = 2;
function toMarkdown(rows, { title = "", url = "" } = {}) {
  return [`# Notes on ${title}`, url, "", ...rows.flatMap(markdownRow)].join("\n");
}
function toJson(rows, { title = "", url = "", key = "" } = {}) {
  return JSON.stringify({ page: url, title, key, notes: rows }, null, JSON_INDENT);
}
function markdownRow(row) {
  const pad = " ".repeat(`${row.n}. `.length);
  const comment = row.note || EMPTY_NOTE;
  return [
    `${row.n}. \`${row.path}\`${flagsOf(row)}`,
    `${pad}> ${row.text || EMPTY_TEXT}`,
    ...row.ctx ? [`${pad}under: ${row.ctx}`] : [],
    ...comment.split("\n").map((line) => pad + line),
    ...(row.shots ?? []).map((path) => `${pad}${SCREENSHOT_LINE}${path}`),
    ""
  ];
}
function flagsOf(row) {
  let flags = "";
  if (row.orphan) flags += ` ${ORPHAN_FLAG}`;
  if (row.anchored === false) flags += ` ${UNANCHORED_FLAG}`;
  return flags;
}
const css = '/* Injected once at mount as <style id="sticky-notes-style">.\n   `all: unset` on controls and a z-index near the maximum keep the layer intact\n   on host pages with aggressive CSS. Host pages may lack a [hidden] reset, so we\n   ship our own. */\n\n.sticky-notes-bar {\n  position: fixed;\n  right: 16px;\n  bottom: 16px;\n  z-index: 2147482930;\n  display: flex;\n  gap: 6px;\n  align-items: center;\n  background: var(--card, #fff);\n  color: var(--ink, #1e2430);\n  border: 1px solid var(--line, #c8ccd4);\n  padding: 6px 8px;\n  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);\n  font: 12px "IBM Plex Mono", ui-monospace, Menlo, monospace;\n}\n\n.sticky-notes-bar__button {\n  all: unset;\n  cursor: pointer;\n  padding: 6px 10px;\n  border: 1px solid var(--line, #c8ccd4);\n  font: inherit;\n  line-height: 1;\n  white-space: nowrap;\n}\n\n.sticky-notes-bar__button:disabled {\n  opacity: 0.4;\n  cursor: default;\n}\n\n.sticky-notes-bar__button:hover:not(:disabled) {\n  background: rgba(0, 0, 0, 0.06);\n}\n\n.sticky-notes-bar__button[aria-pressed="true"] {\n  background: #e0b400;\n  color: #1e2430;\n  border-color: #e0b400;\n}\n\n.sticky-notes-bar__count {\n  opacity: 0.6;\n  min-width: 3ch;\n  text-align: center;\n}\n\n.sticky-notes-bar__message {\n  opacity: 0.6;\n}\n\nbody.sticky-notes-picking,\nbody.sticky-notes-picking * {\n  cursor: crosshair !important;\n}\n\n.sticky-notes-hover {\n  outline: 2px dashed #e0b400 !important;\n  outline-offset: 2px;\n}\n\n.sticky-notes-anchor {\n  outline: 2px solid #e0b400 !important;\n  outline-offset: 2px;\n}\n\n.sticky-notes-leaders {\n  position: absolute;\n  left: 0;\n  top: 0;\n  z-index: 2147482900;\n  pointer-events: none;\n  overflow: visible;\n}\n\n.sticky-note {\n  position: absolute;\n  z-index: 2147482920;\n  width: 240px;\n  height: 110px;\n  min-width: 160px;\n  min-height: 72px;\n  display: flex;\n  flex-direction: column;\n  box-sizing: border-box;\n  resize: both;\n  overflow: hidden;\n  margin: 0;\n  background: #fff3b0;\n  color: #1e2430;\n  border: 1px solid #d9b93c;\n  border-radius: 0;\n  box-shadow: 2px 3px 0 rgba(0, 0, 0, 0.18);\n  padding: 6px 8px 8px;\n  font: 12px/1.4 "IBM Plex Sans", system-ui, sans-serif;\n  text-align: left;\n}\n\n.sticky-note[hidden],\n.sticky-notes-export[hidden] {\n  display: none !important;\n}\n\n.sticky-note--dragging {\n  box-shadow: 6px 8px 0 rgba(0, 0, 0, 0.22);\n  opacity: 0.95;\n}\n\n.sticky-note__header {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  margin: 0 0 4px;\n  padding: 0;\n  font: 600 11px "IBM Plex Mono", ui-monospace, Menlo, monospace;\n  color: #6b5a12;\n  cursor: grab;\n  user-select: none;\n  touch-action: none;\n}\n\n.sticky-note--dragging .sticky-note__header {\n  cursor: grabbing;\n}\n\n.sticky-note__index {\n  background: #1e2430;\n  color: #fff3b0;\n  border-radius: 9px;\n  padding: 0 6px;\n  font: inherit;\n}\n\n.sticky-note__path {\n  flex: 1;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font: inherit;\n  font-size: 10px;\n  background: none;\n  color: inherit;\n  padding: 0;\n}\n\n.sticky-note__button {\n  all: unset;\n  color: #6b5a12;\n  padding: 0 4px;\n  cursor: pointer;\n  font-size: 14px;\n  line-height: 18px;\n}\n\n.sticky-note__button[data-command="remove"] {\n  font-weight: 700;\n  border: 1px solid transparent;\n}\n\n.sticky-note__button[data-command="remove"]:hover {\n  color: #fff;\n  background: #b3261e;\n  border-color: #b3261e;\n}\n\n.sticky-note__text {\n  all: unset;\n  display: block;\n  flex: 1;\n  width: 100%;\n  box-sizing: border-box;\n  min-height: 0;\n  color: inherit;\n  font: inherit;\n  white-space: pre-wrap;\n  overflow: auto;\n}\n\n.sticky-note-badge {\n  position: absolute;\n  z-index: 2147482910;\n  background: #1e2430;\n  color: #fff3b0;\n  font: 700 10px "IBM Plex Mono", ui-monospace, Menlo, monospace;\n  border-radius: 9px;\n  padding: 0 5px;\n  line-height: 16px;\n  cursor: pointer;\n}\n\n.sticky-notes-export {\n  position: fixed;\n  left: 16px;\n  right: 16px;\n  bottom: 64px;\n  max-height: 40vh;\n  overflow: auto;\n  z-index: 2147482930;\n  margin: 0;\n  background: var(--card, #fff);\n  color: var(--ink, #1e2430);\n  border: 1px solid var(--line, #c8ccd4);\n  padding: 12px;\n  font: 12px "IBM Plex Mono", ui-monospace, Menlo, monospace;\n  white-space: pre-wrap;\n  text-align: left;\n}\n\n.sticky-notes-screenshot {\n  position: fixed;\n  inset: 0;\n  z-index: 2147482940;\n  cursor: crosshair;\n  touch-action: none;\n  user-select: none;\n}\n\n.sticky-notes-screenshot__rect {\n  position: fixed;\n  border: 1px dashed #e0b400;\n  background: rgba(224, 180, 0, 0.08);\n  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);\n  pointer-events: none;\n}\n\n.sticky-notes-screenshot__rect[hidden] {\n  display: none !important;\n}\n';
const NOTE_WIDTH = 240;
const NOTE_HEIGHT = 110;
const GAP = 24;
const BADGE_OFFSET = 8;
const EDGE_MARGIN = 4;
const DEFAULT_BOX = { dx: -264, dy: -8, w: NOTE_WIDTH, h: NOTE_HEIGHT };
function anchorOf(el) {
  const view = el.ownerDocument.defaultView;
  const rect = el.getBoundingClientRect();
  return { x: view.scrollX + rect.left, y: view.scrollY + rect.top };
}
function initialOffset(el) {
  const anchor = anchorOf(el);
  const rect = el.getBoundingClientRect();
  const page = el.ownerDocument.documentElement;
  if (anchor.x + DEFAULT_BOX.dx >= 0) return {};
  if (anchor.x + rect.width + GAP + DEFAULT_BOX.w <= page.clientWidth) return { dx: rect.width + GAP };
  return { dx: 0, dy: rect.height + GAP / 2 };
}
function placeNote(note, el, box) {
  const anchor = anchorOf(el);
  const page = el.ownerDocument.documentElement;
  const maxLeft = Math.max(0, page.scrollWidth - (note.w || DEFAULT_BOX.w) - EDGE_MARGIN);
  box.style.left = `${Math.min(Math.max(0, anchor.x + note.dx), maxLeft)}px`;
  box.style.top = `${Math.max(0, anchor.y + note.dy)}px`;
  box.style.width = `${note.w}px`;
  box.style.height = `${note.h}px`;
}
function placeBadge(el, badge) {
  const anchor = anchorOf(el);
  badge.style.left = `${anchor.x - BADGE_OFFSET}px`;
  badge.style.top = `${anchor.y - BADGE_OFFSET}px`;
}
function leaderEnds(el, box) {
  const anchor = anchorOf(el);
  const left = box.offsetLeft;
  const top = box.offsetTop;
  const x = Math.min(Math.max(anchor.x, left), left + box.offsetWidth);
  const y = Math.min(Math.max(anchor.y, top), top + box.offsetHeight);
  if (x === anchor.x && y === anchor.y) return null;
  return { from: anchor, to: { x, y } };
}
const PREFIX = "[modern-screenshot]";
const IN_BROWSER = typeof window !== "undefined";
const SUPPORT_WEB_WORKER = IN_BROWSER && "Worker" in window;
const USER_AGENT = IN_BROWSER ? window.navigator?.userAgent : "";
const IN_CHROME = USER_AGENT.includes("Chrome");
const IN_SAFARI = USER_AGENT.includes("AppleWebKit") && !IN_CHROME;
const IN_FIREFOX = USER_AGENT.includes("Firefox");
const isContext = (value) => value && "__CONTEXT__" in value;
const isCssFontFaceRule = (rule) => rule.constructor.name === "CSSFontFaceRule";
const isCSSImportRule = (rule) => rule.constructor.name === "CSSImportRule";
const isLayerBlockRule = (rule) => rule.constructor.name === "CSSLayerBlockRule";
const isElementNode = (node) => node.nodeType === 1;
const isSVGElementNode = (node) => typeof node.className === "object";
const isSVGImageElementNode = (node) => node.tagName === "image";
const isSVGUseElementNode = (node) => node.tagName === "use";
const isHTMLElementNode = (node) => isElementNode(node) && typeof node.style !== "undefined" && !isSVGElementNode(node);
const isCommentNode = (node) => node.nodeType === 8;
const isTextNode = (node) => node.nodeType === 3;
const isImageElement = (node) => node.tagName === "IMG";
const isVideoElement = (node) => node.tagName === "VIDEO";
const isCanvasElement = (node) => node.tagName === "CANVAS";
const isTextareaElement = (node) => node.tagName === "TEXTAREA";
const isInputElement = (node) => node.tagName === "INPUT";
const isStyleElement = (node) => node.tagName === "STYLE";
const isScriptElement = (node) => node.tagName === "SCRIPT";
const isSelectElement = (node) => node.tagName === "SELECT";
const isSlotElement = (node) => node.tagName === "SLOT";
const isIFrameElement = (node) => node.tagName === "IFRAME";
const consoleWarn = (...args) => console.warn(PREFIX, ...args);
function supportWebp(ownerDocument) {
  const canvas = ownerDocument?.createElement?.("canvas");
  if (canvas) {
    canvas.height = canvas.width = 1;
  }
  return Boolean(canvas) && "toDataURL" in canvas && Boolean(canvas.toDataURL("image/webp").includes("image/webp"));
}
const isDataUrl = (url) => url.startsWith("data:");
function resolveUrl(url, baseUrl) {
  if (url.match(/^[a-z]+:\/\//i))
    return url;
  if (IN_BROWSER && url.match(/^\/\//))
    return window.location.protocol + url;
  if (url.match(/^[a-z]+:/i))
    return url;
  if (!IN_BROWSER)
    return url;
  const doc = getDocument().implementation.createHTMLDocument();
  const base = doc.createElement("base");
  const a = doc.createElement("a");
  doc.head.appendChild(base);
  doc.body.appendChild(a);
  if (baseUrl)
    base.href = baseUrl;
  a.href = url;
  return a.href;
}
function getDocument(target) {
  return (target && isElementNode(target) ? target?.ownerDocument : target) ?? window.document;
}
const XMLNS = "http://www.w3.org/2000/svg";
function createSvg(width, height, ownerDocument) {
  const svg = getDocument(ownerDocument).createElementNS(XMLNS, "svg");
  svg.setAttributeNS(null, "width", width.toString());
  svg.setAttributeNS(null, "height", height.toString());
  svg.setAttributeNS(null, "viewBox", `0 0 ${width} ${height}`);
  return svg;
}
function svgToDataUrl(svg, removeControlCharacter) {
  let xhtml = new XMLSerializer().serializeToString(svg);
  if (removeControlCharacter) {
    xhtml = xhtml.replace(/[\u0000-\u0008\v\f\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "");
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xhtml)}`;
}
function readBlob(blob, type) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error(`Failed read blob to ${type}`));
    {
      reader.readAsDataURL(blob);
    }
  });
}
const blobToDataUrl = (blob) => readBlob(blob, "dataUrl");
function createImage(url, ownerDocument) {
  const img = getDocument(ownerDocument).createElement("img");
  img.decoding = "sync";
  img.loading = "eager";
  img.src = url;
  return img;
}
function loadMedia(media, options) {
  return new Promise((resolve) => {
    const { timeout, ownerDocument, onError: userOnError, onWarn } = options ?? {};
    const node = typeof media === "string" ? createImage(media, getDocument(ownerDocument)) : media;
    let timer = null;
    let removeEventListeners = null;
    function onResolve() {
      resolve(node);
      timer && clearTimeout(timer);
      removeEventListeners?.();
    }
    if (timeout) {
      timer = setTimeout(onResolve, timeout);
    }
    if (isVideoElement(node)) {
      const currentSrc = node.currentSrc || node.src;
      if (!currentSrc) {
        if (node.poster) {
          return loadMedia(node.poster, options).then(resolve);
        }
        return onResolve();
      }
      if (node.readyState >= 2) {
        return onResolve();
      }
      const onLoadeddata = onResolve;
      const onError = (error) => {
        onWarn?.(
          "Failed video load",
          currentSrc,
          error
        );
        userOnError?.(error);
        onResolve();
      };
      removeEventListeners = () => {
        node.removeEventListener("loadeddata", onLoadeddata);
        node.removeEventListener("error", onError);
      };
      node.addEventListener("loadeddata", onLoadeddata, { once: true });
      node.addEventListener("error", onError, { once: true });
    } else {
      const currentSrc = isSVGImageElementNode(node) ? node.href.baseVal : node.currentSrc || node.src;
      if (!currentSrc) {
        return onResolve();
      }
      const onLoad = async () => {
        if (isImageElement(node) && "decode" in node) {
          try {
            await node.decode();
          } catch (error) {
            onWarn?.(
              "Failed to decode image, trying to render anyway",
              node.dataset.originalSrc || currentSrc,
              error
            );
          }
        }
        onResolve();
      };
      const onError = (error) => {
        onWarn?.(
          "Failed image load",
          node.dataset.originalSrc || currentSrc,
          error
        );
        onResolve();
      };
      if (isImageElement(node) && node.complete) {
        return onLoad();
      }
      removeEventListeners = () => {
        node.removeEventListener("load", onLoad);
        node.removeEventListener("error", onError);
      };
      node.addEventListener("load", onLoad, { once: true });
      node.addEventListener("error", onError, { once: true });
    }
  });
}
async function waitUntilLoad(node, options) {
  if (isHTMLElementNode(node)) {
    if (isImageElement(node) || isVideoElement(node)) {
      await loadMedia(node, options);
    } else {
      await Promise.all(
        ["img", "video"].flatMap((selectors) => {
          return Array.from(node.querySelectorAll(selectors)).map((el) => loadMedia(el, options));
        })
      );
    }
  }
}
const uuid = /* @__PURE__ */ (function uuid2() {
  let counter = 0;
  const random = () => `0000${(Math.random() * 36 ** 4 << 0).toString(36)}`.slice(-4);
  return () => {
    counter += 1;
    return `u${random()}${counter}`;
  };
})();
function splitFontFamily(fontFamily) {
  return fontFamily?.split(",").map((val) => val.trim().replace(/"|'/g, "").toLowerCase()).filter(Boolean);
}
let uid = 0;
function createLogger(debug) {
  const prefix = `${PREFIX}[#${uid}]`;
  uid++;
  return {
    // eslint-disable-next-line no-console
    time: (label) => debug && console.time(`${prefix} ${label}`),
    // eslint-disable-next-line no-console
    timeEnd: (label) => debug && console.timeEnd(`${prefix} ${label}`),
    warn: (...args) => debug && consoleWarn(...args)
  };
}
function getDefaultRequestInit(bypassingCache) {
  return {
    cache: bypassingCache ? "no-cache" : "force-cache"
  };
}
async function orCreateContext(node, options) {
  return isContext(node) ? node : createContext(node, { ...options, autoDestruct: true });
}
async function createContext(node, options) {
  const { scale = 1, workerUrl, workerNumber = 1 } = options || {};
  const debug = Boolean(options?.debug);
  const features = options?.features ?? true;
  const ownerDocument = node.ownerDocument ?? (IN_BROWSER ? window.document : void 0);
  const ownerWindow = node.ownerDocument?.defaultView ?? (IN_BROWSER ? window : void 0);
  const requests = /* @__PURE__ */ new Map();
  const context = {
    // Options
    width: 0,
    height: 0,
    quality: 1,
    type: "image/png",
    scale,
    backgroundColor: null,
    style: null,
    filter: null,
    maximumCanvasSize: 0,
    timeout: 3e4,
    progress: null,
    debug,
    fetch: {
      requestInit: getDefaultRequestInit(options?.fetch?.bypassingCache),
      placeholderImage: "data:image/png;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      bypassingCache: false,
      ...options?.fetch
    },
    fetchFn: null,
    font: {},
    drawImageInterval: 100,
    workerUrl: null,
    workerNumber,
    onCloneEachNode: null,
    onCloneNode: null,
    onEmbedNode: null,
    onCreateForeignObjectSvg: null,
    includeStyleProperties: null,
    autoDestruct: false,
    ...options,
    // InternalContext
    __CONTEXT__: true,
    log: createLogger(debug),
    node,
    ownerDocument,
    ownerWindow,
    dpi: scale === 1 ? null : 96 * scale,
    svgStyleElement: createStyleElement(ownerDocument),
    svgDefsElement: ownerDocument?.createElementNS(XMLNS, "defs"),
    svgStyles: /* @__PURE__ */ new Map(),
    defaultComputedStyles: /* @__PURE__ */ new Map(),
    workers: [
      ...Array.from({
        length: SUPPORT_WEB_WORKER && workerUrl && workerNumber ? workerNumber : 0
      })
    ].map(() => {
      try {
        const worker = new Worker(workerUrl);
        worker.onmessage = async (event) => {
          const { url, result } = event.data;
          if (result) {
            requests.get(url)?.resolve?.(result);
          } else {
            requests.get(url)?.reject?.(new Error(`Error receiving message from worker: ${url}`));
          }
        };
        worker.onmessageerror = (event) => {
          const { url } = event.data;
          requests.get(url)?.reject?.(new Error(`Error receiving message from worker: ${url}`));
        };
        return worker;
      } catch (error) {
        context.log.warn("Failed to new Worker", error);
        return null;
      }
    }).filter(Boolean),
    fontFamilies: /* @__PURE__ */ new Map(),
    fontCssTexts: /* @__PURE__ */ new Map(),
    acceptOfImage: `${[
      supportWebp(ownerDocument) && "image/webp",
      "image/svg+xml",
      "image/*",
      "*/*"
    ].filter(Boolean).join(",")};q=0.8`,
    requests,
    drawImageCount: 0,
    tasks: [],
    features,
    isEnable: (key) => {
      if (key === "restoreScrollPosition") {
        return typeof features === "boolean" ? false : features[key] ?? false;
      }
      if (typeof features === "boolean") {
        return features;
      }
      return features[key] ?? true;
    },
    shadowRoots: []
  };
  context.log.time("wait until load");
  await waitUntilLoad(node, { timeout: context.timeout, onWarn: context.log.warn });
  context.log.timeEnd("wait until load");
  const { width, height } = resolveBoundingBox(node, context);
  context.width = width;
  context.height = height;
  return context;
}
function createStyleElement(ownerDocument) {
  if (!ownerDocument)
    return void 0;
  const style = ownerDocument.createElement("style");
  const cssText = style.ownerDocument.createTextNode(`
.______background-clip--text {
  background-clip: text;
  -webkit-background-clip: text;
}
`);
  style.appendChild(cssText);
  return style;
}
function resolveBoundingBox(node, context) {
  let { width, height } = context;
  if (isElementNode(node) && (!width || !height)) {
    const box = node.getBoundingClientRect();
    width = width || box.width || Number(node.getAttribute("width")) || 0;
    height = height || box.height || Number(node.getAttribute("height")) || 0;
  }
  return { width, height };
}
async function imageToCanvas(image, context) {
  const {
    log,
    timeout,
    drawImageCount,
    drawImageInterval
  } = context;
  log.time("image to canvas");
  const loaded = await loadMedia(image, { timeout, onWarn: context.log.warn });
  const { canvas, context2d } = createCanvas(image.ownerDocument, context);
  const drawImage = () => {
    try {
      context2d?.drawImage(loaded, 0, 0, canvas.width, canvas.height);
    } catch (error) {
      context.log.warn("Failed to drawImage", error);
    }
  };
  drawImage();
  if (context.isEnable("fixSvgXmlDecode")) {
    for (let i = 0; i < drawImageCount; i++) {
      await new Promise((resolve) => {
        setTimeout(() => {
          context2d?.clearRect(0, 0, canvas.width, canvas.height);
          drawImage();
          resolve();
        }, i + drawImageInterval);
      });
    }
  }
  context.drawImageCount = 0;
  log.timeEnd("image to canvas");
  return canvas;
}
function createCanvas(ownerDocument, context) {
  const { width, height, scale, backgroundColor, maximumCanvasSize: max } = context;
  const canvas = ownerDocument.createElement("canvas");
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (max) {
    if (canvas.width > max || canvas.height > max) {
      if (canvas.width > max && canvas.height > max) {
        if (canvas.width > canvas.height) {
          canvas.height *= max / canvas.width;
          canvas.width = max;
        } else {
          canvas.width *= max / canvas.height;
          canvas.height = max;
        }
      } else if (canvas.width > max) {
        canvas.height *= max / canvas.width;
        canvas.width = max;
      } else {
        canvas.width *= max / canvas.height;
        canvas.height = max;
      }
    }
  }
  const context2d = canvas.getContext("2d");
  if (context2d && backgroundColor) {
    context2d.fillStyle = backgroundColor;
    context2d.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { canvas, context2d };
}
function cloneCanvas(canvas, context) {
  if (canvas.ownerDocument) {
    try {
      const dataURL = canvas.toDataURL();
      if (dataURL !== "data:,") {
        return createImage(dataURL, canvas.ownerDocument);
      }
    } catch (error) {
      context.log.warn("Failed to clone canvas", error);
    }
  }
  const cloned = canvas.cloneNode(false);
  const ctx = canvas.getContext("2d");
  const clonedCtx = cloned.getContext("2d");
  try {
    if (ctx && clonedCtx) {
      clonedCtx.putImageData(
        ctx.getImageData(0, 0, canvas.width, canvas.height),
        0,
        0
      );
    }
    return cloned;
  } catch (error) {
    context.log.warn("Failed to clone canvas", error);
  }
  return cloned;
}
function cloneIframe(iframe, context) {
  try {
    if (iframe?.contentDocument?.documentElement) {
      return cloneNode(iframe.contentDocument.documentElement, context);
    }
  } catch (error) {
    context.log.warn("Failed to clone iframe", error);
  }
  return iframe.cloneNode(false);
}
function cloneImage(image) {
  const cloned = image.cloneNode(false);
  if (image.currentSrc && image.currentSrc !== image.src) {
    cloned.src = image.currentSrc;
    cloned.srcset = "";
  }
  if (cloned.loading === "lazy") {
    cloned.loading = "eager";
  }
  return cloned;
}
async function cloneVideo(video, context) {
  if (video.ownerDocument && !video.currentSrc && video.poster) {
    return createImage(video.poster, video.ownerDocument);
  }
  const cloned = video.cloneNode(false);
  cloned.crossOrigin = "anonymous";
  if (video.currentSrc && video.currentSrc !== video.src) {
    cloned.src = video.currentSrc;
  }
  const ownerDocument = cloned.ownerDocument;
  if (ownerDocument) {
    let canPlay = true;
    await loadMedia(cloned, { onError: () => canPlay = false, onWarn: context.log.warn });
    if (!canPlay) {
      if (video.poster) {
        return createImage(video.poster, video.ownerDocument);
      }
      return cloned;
    }
    cloned.currentTime = video.currentTime;
    await new Promise((resolve) => {
      cloned.addEventListener("seeked", resolve, { once: true });
    });
    const canvas = ownerDocument.createElement("canvas");
    canvas.width = video.offsetWidth;
    canvas.height = video.offsetHeight;
    try {
      const ctx = canvas.getContext("2d");
      if (ctx)
        ctx.drawImage(cloned, 0, 0, canvas.width, canvas.height);
    } catch (error) {
      context.log.warn("Failed to clone video", error);
      if (video.poster) {
        return createImage(video.poster, video.ownerDocument);
      }
      return cloned;
    }
    return cloneCanvas(canvas, context);
  }
  return cloned;
}
function cloneElement(node, context) {
  if (isCanvasElement(node)) {
    return cloneCanvas(node, context);
  }
  if (isIFrameElement(node)) {
    return cloneIframe(node, context);
  }
  if (isImageElement(node)) {
    return cloneImage(node);
  }
  if (isVideoElement(node)) {
    return cloneVideo(node, context);
  }
  return node.cloneNode(false);
}
function getSandBox(context) {
  let sandbox = context.sandbox;
  if (!sandbox) {
    const { ownerDocument } = context;
    try {
      if (ownerDocument) {
        sandbox = ownerDocument.createElement("iframe");
        sandbox.id = `__SANDBOX__${uuid()}`;
        sandbox.width = "0";
        sandbox.height = "0";
        sandbox.style.visibility = "hidden";
        sandbox.style.position = "fixed";
        ownerDocument.body.appendChild(sandbox);
        sandbox.srcdoc = '<!DOCTYPE html><meta charset="UTF-8"><title></title><body>';
        context.sandbox = sandbox;
      }
    } catch (error) {
      context.log.warn("Failed to getSandBox", error);
    }
  }
  return sandbox;
}
const ignoredStyles = [
  "width",
  "height",
  "-webkit-text-fill-color"
];
const includedAttributes = [
  "stroke",
  "fill"
];
function getDefaultStyle(node, pseudoElement, context) {
  const { defaultComputedStyles } = context;
  const nodeName = node.nodeName.toLowerCase();
  const isSvgNode = isSVGElementNode(node) && nodeName !== "svg";
  const attributes = isSvgNode ? includedAttributes.map((name) => [name, node.getAttribute(name)]).filter(([, value]) => value !== null) : [];
  const key = [
    isSvgNode && "svg",
    nodeName,
    attributes.map((name, value) => `${name}=${value}`).join(","),
    pseudoElement
  ].filter(Boolean).join(":");
  if (defaultComputedStyles.has(key))
    return defaultComputedStyles.get(key);
  const sandbox = getSandBox(context);
  const sandboxWindow = sandbox?.contentWindow;
  if (!sandboxWindow)
    return /* @__PURE__ */ new Map();
  const sandboxDocument = sandboxWindow?.document;
  let root;
  let el;
  if (isSvgNode) {
    root = sandboxDocument.createElementNS(XMLNS, "svg");
    el = root.ownerDocument.createElementNS(root.namespaceURI, nodeName);
    attributes.forEach(([name, value]) => {
      el.setAttributeNS(null, name, value);
    });
    root.appendChild(el);
  } else {
    root = el = sandboxDocument.createElement(nodeName);
  }
  el.textContent = " ";
  sandboxDocument.body.appendChild(root);
  const computedStyle = sandboxWindow.getComputedStyle(el, pseudoElement);
  const styles = /* @__PURE__ */ new Map();
  for (let len = computedStyle.length, i = 0; i < len; i++) {
    const name = computedStyle.item(i);
    if (ignoredStyles.includes(name))
      continue;
    styles.set(name, computedStyle.getPropertyValue(name));
  }
  sandboxDocument.body.removeChild(root);
  defaultComputedStyles.set(key, styles);
  return styles;
}
function getDiffStyle(style, defaultStyle, includeStyleProperties) {
  const diffStyle = /* @__PURE__ */ new Map();
  const prefixs = [];
  const prefixTree = /* @__PURE__ */ new Map();
  if (includeStyleProperties) {
    for (const name of includeStyleProperties) {
      applyTo(name);
    }
  } else {
    for (let len = style.length, i = 0; i < len; i++) {
      const name = style.item(i);
      applyTo(name);
    }
  }
  for (let len = prefixs.length, i = 0; i < len; i++) {
    prefixTree.get(prefixs[i])?.forEach((value, name) => diffStyle.set(name, value));
  }
  function applyTo(name) {
    const value = style.getPropertyValue(name);
    const priority = style.getPropertyPriority(name);
    const subIndex = name.lastIndexOf("-");
    const prefix = subIndex > -1 ? name.substring(0, subIndex) : void 0;
    if (prefix) {
      let map = prefixTree.get(prefix);
      if (!map) {
        map = /* @__PURE__ */ new Map();
        prefixTree.set(prefix, map);
      }
      map.set(name, [value, priority]);
    }
    if (defaultStyle.get(name) === value && !priority)
      return;
    if (prefix) {
      prefixs.push(prefix);
    } else {
      diffStyle.set(name, [value, priority]);
    }
  }
  return diffStyle;
}
function copyCssStyles(node, cloned, isRoot, context) {
  const { ownerWindow, includeStyleProperties, currentParentNodeStyle } = context;
  const clonedStyle = cloned.style;
  const computedStyle = ownerWindow.getComputedStyle(node);
  const defaultStyle = getDefaultStyle(node, null, context);
  currentParentNodeStyle?.forEach((_, key) => {
    defaultStyle.delete(key);
  });
  const style = getDiffStyle(computedStyle, defaultStyle, includeStyleProperties);
  style.delete("transition-property");
  style.delete("all");
  style.delete("d");
  style.delete("content");
  if (isRoot) {
    style.delete("position");
    style.delete("margin-top");
    style.delete("margin-right");
    style.delete("margin-bottom");
    style.delete("margin-left");
    style.delete("margin-block-start");
    style.delete("margin-block-end");
    style.delete("margin-inline-start");
    style.delete("margin-inline-end");
    style.set("box-sizing", ["border-box", ""]);
  }
  if (style.get("background-clip")?.[0] === "text") {
    cloned.classList.add("______background-clip--text");
  }
  if (IN_CHROME) {
    if (!style.has("font-kerning"))
      style.set("font-kerning", ["normal", ""]);
    if ((style.get("overflow-x")?.[0] === "hidden" || style.get("overflow-y")?.[0] === "hidden") && style.get("text-overflow")?.[0] === "ellipsis" && node.scrollWidth === node.clientWidth) {
      style.set("text-overflow", ["clip", ""]);
    }
  }
  for (let len = clonedStyle.length, i = 0; i < len; i++) {
    clonedStyle.removeProperty(clonedStyle.item(i));
  }
  style.forEach(([value, priority], name) => {
    clonedStyle.setProperty(name, value, priority);
  });
  return style;
}
function copyInputValue(node, cloned) {
  if (isTextareaElement(node) || isInputElement(node) || isSelectElement(node)) {
    cloned.setAttribute("value", node.value);
  }
}
const pseudoClasses = [
  "::before",
  "::after"
  // '::placeholder', TODO
];
const scrollbarPseudoClasses = [
  "::-webkit-scrollbar",
  "::-webkit-scrollbar-button",
  // '::-webkit-scrollbar:horizontal', TODO
  "::-webkit-scrollbar-thumb",
  "::-webkit-scrollbar-track",
  "::-webkit-scrollbar-track-piece",
  // '::-webkit-scrollbar:vertical', TODO
  "::-webkit-scrollbar-corner",
  "::-webkit-resizer"
];
function copyPseudoClass(node, cloned, copyScrollbar, context, addWordToFontFamilies) {
  const { ownerWindow, svgStyleElement, svgStyles, currentNodeStyle } = context;
  if (!svgStyleElement || !ownerWindow)
    return;
  function copyBy(pseudoClass) {
    const computedStyle = ownerWindow.getComputedStyle(node, pseudoClass);
    let content = computedStyle.getPropertyValue("content");
    if (!content || content === "none")
      return;
    addWordToFontFamilies?.(content);
    content = content.replace(/(')|(")|(counter\(.+\))/g, "");
    const klasses = [uuid()];
    const defaultStyle = getDefaultStyle(node, pseudoClass, context);
    currentNodeStyle?.forEach((_, key) => {
      defaultStyle.delete(key);
    });
    const style = getDiffStyle(computedStyle, defaultStyle, context.includeStyleProperties);
    style.delete("content");
    style.delete("-webkit-locale");
    if (style.get("background-clip")?.[0] === "text") {
      cloned.classList.add("______background-clip--text");
    }
    const cloneStyle = [
      `content: '${content}';`
    ];
    style.forEach(([value, priority], name) => {
      cloneStyle.push(`${name}: ${value}${priority ? " !important" : ""};`);
    });
    if (cloneStyle.length === 1)
      return;
    try {
      cloned.className = [cloned.className, ...klasses].join(" ");
    } catch (err) {
      context.log.warn("Failed to copyPseudoClass", err);
      return;
    }
    const cssText = cloneStyle.join("\n  ");
    let allClasses = svgStyles.get(cssText);
    if (!allClasses) {
      allClasses = [];
      svgStyles.set(cssText, allClasses);
    }
    allClasses.push(`.${klasses[0]}${pseudoClass}`);
  }
  pseudoClasses.forEach(copyBy);
  if (copyScrollbar)
    scrollbarPseudoClasses.forEach(copyBy);
}
const excludeParentNodes = /* @__PURE__ */ new Set([
  "symbol"
  // test/fixtures/svg.symbol.html
]);
async function appendChildNode(node, cloned, child, context, addWordToFontFamilies) {
  if (isElementNode(child) && (isStyleElement(child) || isScriptElement(child)))
    return;
  if (context.filter && !context.filter(child))
    return;
  if (excludeParentNodes.has(cloned.nodeName) || excludeParentNodes.has(child.nodeName)) {
    context.currentParentNodeStyle = void 0;
  } else {
    context.currentParentNodeStyle = context.currentNodeStyle;
  }
  const childCloned = await cloneNode(child, context, false, addWordToFontFamilies);
  if (context.isEnable("restoreScrollPosition")) {
    restoreScrollPosition(node, childCloned);
  }
  cloned.appendChild(childCloned);
}
async function cloneChildNodes(node, cloned, context, addWordToFontFamilies) {
  let firstChild = node.firstChild;
  if (isElementNode(node)) {
    if (node.shadowRoot) {
      firstChild = node.shadowRoot?.firstChild;
      context.shadowRoots.push(node.shadowRoot);
    }
  }
  for (let child = firstChild; child; child = child.nextSibling) {
    if (isCommentNode(child))
      continue;
    if (isElementNode(child) && isSlotElement(child) && typeof child.assignedNodes === "function") {
      const nodes = child.assignedNodes();
      for (let i = 0; i < nodes.length; i++) {
        await appendChildNode(node, cloned, nodes[i], context, addWordToFontFamilies);
      }
    } else {
      await appendChildNode(node, cloned, child, context, addWordToFontFamilies);
    }
  }
}
function restoreScrollPosition(node, chlidCloned) {
  if (!isHTMLElementNode(node) || !isHTMLElementNode(chlidCloned))
    return;
  const { scrollTop, scrollLeft } = node;
  if (!scrollTop && !scrollLeft) {
    return;
  }
  const { transform } = chlidCloned.style;
  const matrix = new DOMMatrix(transform);
  const { a, b, c, d } = matrix;
  matrix.a = 1;
  matrix.b = 0;
  matrix.c = 0;
  matrix.d = 1;
  matrix.translateSelf(-scrollLeft, -scrollTop);
  matrix.a = a;
  matrix.b = b;
  matrix.c = c;
  matrix.d = d;
  chlidCloned.style.transform = matrix.toString();
}
function applyCssStyleWithOptions(cloned, context) {
  const { backgroundColor, width, height, style: styles } = context;
  const clonedStyle = cloned.style;
  if (backgroundColor)
    clonedStyle.setProperty("background-color", backgroundColor, "important");
  if (width)
    clonedStyle.setProperty("width", `${width}px`, "important");
  if (height)
    clonedStyle.setProperty("height", `${height}px`, "important");
  if (styles) {
    for (const name in styles) clonedStyle[name] = styles[name];
  }
}
const NORMAL_ATTRIBUTE_RE = /^[\w-:]+$/;
async function cloneNode(node, context, isRoot = false, addWordToFontFamilies) {
  const { ownerDocument, ownerWindow, fontFamilies, onCloneEachNode } = context;
  if (ownerDocument && isTextNode(node)) {
    if (addWordToFontFamilies && /\S/.test(node.data)) {
      addWordToFontFamilies(node.data);
    }
    return ownerDocument.createTextNode(node.data);
  }
  if (ownerDocument && ownerWindow && isElementNode(node) && (isHTMLElementNode(node) || isSVGElementNode(node))) {
    const cloned2 = await cloneElement(node, context);
    if (context.isEnable("removeAbnormalAttributes")) {
      const names = cloned2.getAttributeNames();
      for (let len = names.length, i = 0; i < len; i++) {
        const name = names[i];
        if (!NORMAL_ATTRIBUTE_RE.test(name)) {
          cloned2.removeAttribute(name);
        }
      }
    }
    const style = context.currentNodeStyle = copyCssStyles(node, cloned2, isRoot, context);
    if (isRoot)
      applyCssStyleWithOptions(cloned2, context);
    let copyScrollbar = false;
    if (context.isEnable("copyScrollbar")) {
      const overflow = [
        style.get("overflow-x")?.[0],
        style.get("overflow-y")?.[0]
      ];
      copyScrollbar = overflow.includes("scroll") || (overflow.includes("auto") || overflow.includes("overlay")) && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth);
    }
    const textTransform = style.get("text-transform")?.[0];
    const families = splitFontFamily(style.get("font-family")?.[0]);
    const addWordToFontFamilies2 = families ? (word) => {
      if (textTransform === "uppercase") {
        word = word.toUpperCase();
      } else if (textTransform === "lowercase") {
        word = word.toLowerCase();
      } else if (textTransform === "capitalize") {
        word = word[0].toUpperCase() + word.substring(1);
      }
      families.forEach((family) => {
        let fontFamily = fontFamilies.get(family);
        if (!fontFamily) {
          fontFamilies.set(family, fontFamily = /* @__PURE__ */ new Set());
        }
        word.split("").forEach((text) => fontFamily.add(text));
      });
    } : void 0;
    copyPseudoClass(
      node,
      cloned2,
      copyScrollbar,
      context,
      addWordToFontFamilies2
    );
    copyInputValue(node, cloned2);
    if (!isVideoElement(node)) {
      await cloneChildNodes(
        node,
        cloned2,
        context,
        addWordToFontFamilies2
      );
    }
    await onCloneEachNode?.(cloned2);
    return cloned2;
  }
  const cloned = node.cloneNode(false);
  await cloneChildNodes(node, cloned, context);
  await onCloneEachNode?.(cloned);
  return cloned;
}
function destroyContext(context) {
  context.ownerDocument = void 0;
  context.ownerWindow = void 0;
  context.svgStyleElement = void 0;
  context.svgDefsElement = void 0;
  context.svgStyles.clear();
  context.defaultComputedStyles.clear();
  if (context.sandbox) {
    try {
      context.sandbox.remove();
    } catch (err) {
      context.log.warn("Failed to destroyContext", err);
    }
    context.sandbox = void 0;
  }
  context.workers = [];
  context.fontFamilies.clear();
  context.fontCssTexts.clear();
  context.requests.clear();
  context.tasks = [];
  context.shadowRoots = [];
}
function baseFetch(options) {
  const { url, timeout, responseType, ...requestInit } = options;
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : void 0;
  return fetch(url, { signal: controller.signal, ...requestInit }).then((response) => {
    if (!response.ok) {
      throw new Error("Failed fetch, not 2xx response", { cause: response });
    }
    switch (responseType) {
      case "arrayBuffer":
        return response.arrayBuffer();
      case "dataUrl":
        return response.blob().then(blobToDataUrl);
      case "text":
      default:
        return response.text();
    }
  }).finally(() => clearTimeout(timer));
}
function contextFetch(context, options) {
  const { url: rawUrl, requestType = "text", responseType = "text", imageDom } = options;
  let url = rawUrl;
  const {
    timeout,
    acceptOfImage,
    requests,
    fetchFn,
    fetch: {
      requestInit,
      bypassingCache,
      placeholderImage
    },
    font,
    workers,
    fontFamilies
  } = context;
  if (requestType === "image" && (IN_SAFARI || IN_FIREFOX)) {
    context.drawImageCount++;
  }
  let request = requests.get(rawUrl);
  if (!request) {
    if (bypassingCache) {
      if (bypassingCache instanceof RegExp && bypassingCache.test(url)) {
        url += (/\?/.test(url) ? "&" : "?") + (/* @__PURE__ */ new Date()).getTime();
      }
    }
    const canFontMinify = requestType.startsWith("font") && font && font.minify;
    const fontTexts = /* @__PURE__ */ new Set();
    if (canFontMinify) {
      const families = requestType.split(";")[1].split(",");
      families.forEach((family) => {
        if (!fontFamilies.has(family))
          return;
        fontFamilies.get(family).forEach((text) => fontTexts.add(text));
      });
    }
    const needFontMinify = canFontMinify && fontTexts.size;
    const baseFetchOptions = {
      url,
      timeout,
      responseType: needFontMinify ? "arrayBuffer" : responseType,
      headers: requestType === "image" ? { accept: acceptOfImage } : void 0,
      ...requestInit
    };
    request = {
      type: requestType,
      resolve: void 0,
      reject: void 0,
      response: null
    };
    request.response = (async () => {
      if (fetchFn && requestType === "image") {
        const result = await fetchFn(rawUrl);
        if (result)
          return result;
      }
      if (!IN_SAFARI && rawUrl.startsWith("http") && workers.length) {
        return new Promise((resolve, reject) => {
          const worker = workers[requests.size & workers.length - 1];
          worker.postMessage({ rawUrl, ...baseFetchOptions });
          request.resolve = resolve;
          request.reject = reject;
        });
      }
      return baseFetch(baseFetchOptions);
    })().catch((error) => {
      requests.delete(rawUrl);
      if (requestType === "image" && placeholderImage) {
        context.log.warn("Failed to fetch image base64, trying to use placeholder image", url);
        return typeof placeholderImage === "string" ? placeholderImage : placeholderImage(imageDom);
      }
      throw error;
    });
    requests.set(rawUrl, request);
  }
  return request.response;
}
async function replaceCssUrlToDataUrl(cssText, baseUrl, context, isImage) {
  if (!hasCssUrl(cssText))
    return cssText;
  for (const [rawUrl, url] of parseCssUrls(cssText, baseUrl)) {
    try {
      const dataUrl = await contextFetch(
        context,
        {
          url,
          requestType: isImage ? "image" : "text",
          responseType: "dataUrl"
        }
      );
      cssText = cssText.replace(toRE(rawUrl), `$1${dataUrl}$3`);
    } catch (error) {
      context.log.warn("Failed to fetch css data url", rawUrl, error);
    }
  }
  return cssText;
}
function hasCssUrl(cssText) {
  return /url\((['"]?)([^'"]+?)\1\)/.test(cssText);
}
const URL_RE = /url\((['"]?)([^'"]+?)\1\)/g;
function parseCssUrls(cssText, baseUrl) {
  const result = [];
  cssText.replace(URL_RE, (raw, quotation, url) => {
    result.push([url, resolveUrl(url, baseUrl)]);
    return raw;
  });
  return result.filter(([url]) => !isDataUrl(url));
}
function toRE(url) {
  const escaped = url.replace(/([.*+?^${}()|\[\]\/\\])/g, "\\$1");
  return new RegExp(`(url\\(['"]?)(${escaped})(['"]?\\))`, "g");
}
const properties = [
  "background-image",
  "border-image-source",
  "-webkit-border-image",
  "-webkit-mask-image",
  "list-style-image"
];
function embedCssStyleImage(style, context) {
  return properties.map((property) => {
    const value = style.getPropertyValue(property);
    if (!value || value === "none") {
      return null;
    }
    if (IN_SAFARI || IN_FIREFOX) {
      context.drawImageCount++;
    }
    return replaceCssUrlToDataUrl(value, null, context, true).then((newValue) => {
      if (!newValue || value === newValue)
        return;
      style.setProperty(
        property,
        newValue,
        style.getPropertyPriority(property)
      );
    });
  }).filter(Boolean);
}
function embedImageElement(cloned, context) {
  if (isImageElement(cloned)) {
    const originalSrc = cloned.currentSrc || cloned.src;
    if (!isDataUrl(originalSrc)) {
      return [
        contextFetch(context, {
          url: originalSrc,
          imageDom: cloned,
          requestType: "image",
          responseType: "dataUrl"
        }).then((url) => {
          if (!url)
            return;
          cloned.srcset = "";
          cloned.dataset.originalSrc = originalSrc;
          cloned.src = url || "";
        })
      ];
    }
    if (IN_SAFARI || IN_FIREFOX) {
      context.drawImageCount++;
    }
  } else if (isSVGElementNode(cloned) && !isDataUrl(cloned.href.baseVal)) {
    const originalSrc = cloned.href.baseVal;
    return [
      contextFetch(context, {
        url: originalSrc,
        imageDom: cloned,
        requestType: "image",
        responseType: "dataUrl"
      }).then((url) => {
        if (!url)
          return;
        cloned.dataset.originalSrc = originalSrc;
        cloned.href.baseVal = url || "";
      })
    ];
  }
  return [];
}
function embedSvgUse(cloned, context) {
  const { ownerDocument, svgDefsElement } = context;
  const href = cloned.getAttribute("href") ?? cloned.getAttribute("xlink:href");
  if (!href)
    return [];
  const [svgUrl, id] = href.split("#");
  if (id) {
    const query = `#${id}`;
    const definition = context.shadowRoots.reduce(
      (res, root) => {
        return res ?? root.querySelector(`svg ${query}`);
      },
      ownerDocument?.querySelector(`svg ${query}`)
    );
    if (svgUrl) {
      cloned.setAttribute("href", query);
    }
    if (svgDefsElement?.querySelector(query))
      return [];
    if (definition) {
      svgDefsElement?.appendChild(definition.cloneNode(true));
      return [];
    } else if (svgUrl) {
      return [
        contextFetch(context, {
          url: svgUrl,
          responseType: "text"
        }).then((svgData) => {
          svgDefsElement?.insertAdjacentHTML("beforeend", svgData);
        })
      ];
    }
  }
  return [];
}
function embedNode(cloned, context) {
  const { tasks } = context;
  if (isElementNode(cloned)) {
    if (isImageElement(cloned) || isSVGImageElementNode(cloned)) {
      tasks.push(...embedImageElement(cloned, context));
    }
    if (isSVGUseElementNode(cloned)) {
      tasks.push(...embedSvgUse(cloned, context));
    }
  }
  if (isHTMLElementNode(cloned)) {
    tasks.push(...embedCssStyleImage(cloned.style, context));
  }
  cloned.childNodes.forEach((child) => {
    embedNode(child, context);
  });
}
async function embedWebFont(clone, context) {
  const {
    ownerDocument,
    svgStyleElement,
    fontFamilies,
    fontCssTexts,
    tasks,
    font
  } = context;
  if (!ownerDocument || !svgStyleElement || !fontFamilies.size) {
    return;
  }
  if (font && font.cssText) {
    const cssText = filterPreferredFormat(font.cssText, context);
    svgStyleElement.appendChild(ownerDocument.createTextNode(`${cssText}
`));
  } else {
    const styleSheets = Array.from(ownerDocument.styleSheets).filter((styleSheet) => {
      try {
        return "cssRules" in styleSheet && Boolean(styleSheet.cssRules.length);
      } catch (error) {
        context.log.warn(`Error while reading CSS rules from ${styleSheet.href}`, error);
        return false;
      }
    });
    const tempDoc = ownerDocument.implementation.createHTMLDocument("");
    const tempStyleEl = tempDoc.createElement("style");
    tempDoc.head.appendChild(tempStyleEl);
    const tempStyleSheet = tempStyleEl.sheet;
    await Promise.all(
      styleSheets.flatMap((styleSheet) => {
        return Array.from(styleSheet.cssRules).map(async (cssRule) => {
          if (isCSSImportRule(cssRule)) {
            const baseUrl = cssRule.href;
            let cssText = "";
            try {
              cssText = await contextFetch(context, {
                url: baseUrl,
                requestType: "text",
                responseType: "text"
              });
            } catch (error) {
              context.log.warn(`Error fetch remote css import from ${baseUrl}`, error);
            }
            const replacedCssText = cssText.replace(
              URL_RE,
              (raw, quotation, url) => raw.replace(url, resolveUrl(url, baseUrl))
            );
            for (const rule of parseCss(replacedCssText)) {
              try {
                tempStyleSheet.insertRule(rule, tempStyleSheet.cssRules.length);
              } catch (error) {
                context.log.warn("Error inserting rule from remote css import", { rule, error });
              }
            }
          }
        });
      })
    );
    if (tempStyleSheet.cssRules.length)
      styleSheets.push(tempStyleSheet);
    const cssRules = [];
    styleSheets.forEach((sheet) => {
      unwrapCssLayers(sheet.cssRules, cssRules);
    });
    cssRules.filter((cssRule) => isCssFontFaceRule(cssRule) && hasCssUrl(cssRule.style.getPropertyValue("src")) && splitFontFamily(cssRule.style.getPropertyValue("font-family"))?.some((val) => fontFamilies.has(val))).forEach((value) => {
      const rule = value;
      const cssText = fontCssTexts.get(rule.cssText);
      if (cssText) {
        svgStyleElement.appendChild(ownerDocument.createTextNode(`${cssText}
`));
      } else {
        tasks.push(
          replaceCssUrlToDataUrl(
            rule.cssText,
            rule.parentStyleSheet ? rule.parentStyleSheet.href : null,
            context
          ).then((cssText2) => {
            cssText2 = filterPreferredFormat(cssText2, context);
            fontCssTexts.set(rule.cssText, cssText2);
            svgStyleElement.appendChild(ownerDocument.createTextNode(`${cssText2}
`));
          })
        );
      }
    });
  }
}
const COMMENTS_RE = /(\/\*[\s\S]*?\*\/)/g;
const KEYFRAMES_RE = /((@.*?keyframes [\s\S]*?){([\s\S]*?}\s*?)})/gi;
function parseCss(source) {
  if (source == null)
    return [];
  const result = [];
  let cssText = source.replace(COMMENTS_RE, "");
  while (true) {
    const matches = KEYFRAMES_RE.exec(cssText);
    if (!matches)
      break;
    result.push(matches[0]);
  }
  cssText = cssText.replace(KEYFRAMES_RE, "");
  const IMPORT_RE = /@import[\s\S]*?url\([^)]*\)[\s\S]*?;/gi;
  const UNIFIED_RE = new RegExp(
    // eslint-disable-next-line
    "((\\s*?(?:\\/\\*[\\s\\S]*?\\*\\/)?\\s*?@media[\\s\\S]*?){([\\s\\S]*?)}\\s*?})|(([\\s\\S]*?){([\\s\\S]*?)})",
    "gi"
  );
  while (true) {
    let matches = IMPORT_RE.exec(cssText);
    if (!matches) {
      matches = UNIFIED_RE.exec(cssText);
      if (!matches) {
        break;
      } else {
        IMPORT_RE.lastIndex = UNIFIED_RE.lastIndex;
      }
    } else {
      UNIFIED_RE.lastIndex = IMPORT_RE.lastIndex;
    }
    result.push(matches[0]);
  }
  return result;
}
const URL_WITH_FORMAT_RE = /url\([^)]+\)\s*format\((["']?)([^"']+)\1\)/g;
const FONT_SRC_RE = /src:\s*(?:url\([^)]+\)\s*format\([^)]+\)[,;]\s*)+/g;
function filterPreferredFormat(str, context) {
  const { font } = context;
  const preferredFormat = font ? font?.preferredFormat : void 0;
  return preferredFormat ? str.replace(FONT_SRC_RE, (match) => {
    while (true) {
      const [src, , format] = URL_WITH_FORMAT_RE.exec(match) || [];
      if (!format)
        return "";
      if (format === preferredFormat)
        return `src: ${src};`;
    }
  }) : str;
}
function unwrapCssLayers(rules, out = []) {
  for (const rule of Array.from(rules)) {
    if (isLayerBlockRule(rule)) {
      out.push(...unwrapCssLayers(rule.cssRules));
    } else if ("cssRules" in rule) {
      unwrapCssLayers(rule.cssRules, out);
    } else {
      out.push(rule);
    }
  }
  return out;
}
const SVG_EXTERNAL_RESOURCE_REGEX = /\bx?link:?href\s*=\s*["'](?!data:)[^"']+["']/i;
function svgHasExternalResources(svg) {
  return SVG_EXTERNAL_RESOURCE_REGEX.test(svg.innerHTML);
}
async function domToForeignObjectSvg(node, options) {
  const context = await orCreateContext(node, options);
  if (isElementNode(context.node) && isSVGElementNode(context.node) && !svgHasExternalResources(context.node))
    return context.node;
  const {
    ownerDocument,
    log,
    tasks,
    svgStyleElement,
    svgDefsElement,
    svgStyles,
    font,
    progress,
    autoDestruct,
    onCloneNode,
    onEmbedNode,
    onCreateForeignObjectSvg
  } = context;
  log.time("clone node");
  const clone = await cloneNode(context.node, context, true);
  if (svgStyleElement && ownerDocument) {
    let allCssText = "";
    svgStyles.forEach((klasses, cssText) => {
      allCssText += `${klasses.join(",\n")} {
  ${cssText}
}
`;
    });
    svgStyleElement.appendChild(ownerDocument.createTextNode(allCssText));
  }
  log.timeEnd("clone node");
  await onCloneNode?.(clone);
  if (font !== false && isElementNode(clone)) {
    log.time("embed web font");
    await embedWebFont(clone, context);
    log.timeEnd("embed web font");
  }
  log.time("embed node");
  embedNode(clone, context);
  const count = tasks.length;
  let current = 0;
  const runTask = async () => {
    while (true) {
      const task = tasks.pop();
      if (!task)
        break;
      try {
        await task;
      } catch (error) {
        context.log.warn("Failed to run task", error);
      }
      progress?.(++current, count);
    }
  };
  progress?.(current, count);
  await Promise.all([...Array.from({ length: 4 })].map(runTask));
  log.timeEnd("embed node");
  await onEmbedNode?.(clone);
  const svg = createForeignObjectSvg(clone, context);
  svgDefsElement && svg.insertBefore(svgDefsElement, svg.children[0]);
  svgStyleElement && svg.insertBefore(svgStyleElement, svg.children[0]);
  autoDestruct && destroyContext(context);
  await onCreateForeignObjectSvg?.(svg);
  return svg;
}
function createForeignObjectSvg(clone, context) {
  const { width, height } = context;
  const svg = createSvg(width, height, clone.ownerDocument);
  const foreignObject = svg.ownerDocument.createElementNS(svg.namespaceURI, "foreignObject");
  foreignObject.setAttributeNS(null, "x", "0%");
  foreignObject.setAttributeNS(null, "y", "0%");
  foreignObject.setAttributeNS(null, "width", "100%");
  foreignObject.setAttributeNS(null, "height", "100%");
  foreignObject.append(clone);
  svg.appendChild(foreignObject);
  return svg;
}
async function domToCanvas(node, options) {
  const context = await orCreateContext(node, options);
  const svg = await domToForeignObjectSvg(context);
  const dataUrl = svgToDataUrl(svg, context.isEnable("removeControlCharacter"));
  if (!context.autoDestruct) {
    context.svgStyleElement = createStyleElement(context.ownerDocument);
    context.svgDefsElement = context.ownerDocument?.createElementNS(XMLNS, "defs");
    context.svgStyles.clear();
  }
  const image = createImage(dataUrl, svg.ownerDocument);
  return await imageToCanvas(image, context);
}
const FALLBACK = "page";
const slug = (key) => String(key).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || FALLBACK;
const OVERLAY_CLASS = "sticky-notes-screenshot";
const RECT_CLASS = "sticky-notes-screenshot__rect";
const ESCAPE_KEY$1 = "Escape";
const MIN_SIZE = 8;
const PNG = "image/png";
const FILE_PREFIX = "screenshot";
const EXCLUDED = ["sticky-notes-bar", "sticky-notes-export", OVERLAY_CLASS];
function selectRect(doc) {
  const view = doc.defaultView;
  return new Promise((resolve) => {
    const overlay = doc.createElement("div");
    overlay.className = OVERLAY_CLASS;
    const rect = doc.createElement("div");
    rect.className = RECT_CLASS;
    rect.hidden = true;
    overlay.append(rect);
    doc.body.append(overlay);
    let start = null;
    const finish = (result) => {
      doc.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key !== ESCAPE_KEY$1) return;
      event.stopPropagation();
      finish(null);
    };
    const bounds = (event) => ({
      left: Math.min(start.x, event.clientX),
      top: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y)
    });
    overlay.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      start = { x: event.clientX, y: event.clientY };
      overlay.setPointerCapture(event.pointerId);
      rect.hidden = false;
    });
    overlay.addEventListener("pointermove", (event) => {
      if (!start) return;
      const box = bounds(event);
      Object.assign(rect.style, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`
      });
    });
    overlay.addEventListener("pointerup", (event) => {
      if (!start) return;
      const box = bounds(event);
      if (box.width < MIN_SIZE || box.height < MIN_SIZE) return finish(null);
      finish({
        x: Math.round(box.left + view.scrollX),
        y: Math.round(box.top + view.scrollY),
        w: Math.round(box.width),
        h: Math.round(box.height)
      });
    });
    doc.addEventListener("keydown", onKey, true);
  });
}
function captureRect(doc, { x, y, w, h }) {
  const view = doc.defaultView;
  return domToCanvas(doc.documentElement, {
    width: w,
    height: h,
    scale: view.devicePixelRatio || 1,
    style: { transform: `translate(${-x}px, ${-y}px)`, transformOrigin: "top left" },
    filter: (node) => !EXCLUDED.some((cls) => node.classList?.contains(cls))
  });
}
const toPng = (canvas) => canvasToBlob(canvas, PNG);
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("canvas produced no image")), type, quality);
  });
}
const screenshotFileName = (key, n) => `${slug(key)}-${FILE_PREFIX}-${n}.png`;
function download(doc, blob, name) {
  const view = doc.defaultView;
  const url = view.URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
}
async function copyImage(view, blob) {
  const clipboard = view.navigator?.clipboard;
  if (!clipboard?.write || !view.ClipboardItem) return false;
  try {
    await clipboard.write([new view.ClipboardItem({ [PNG]: blob })]);
    return true;
  } catch {
    return false;
  }
}
const STYLE_ID = "sticky-notes-style";
const SVG_NS = "http://www.w3.org/2000/svg";
const MESSAGE_MS = 1500;
const ESCAPE_KEY = "Escape";
const PICKING_CLASS = "sticky-notes-picking";
const HOVER_CLASS = "sticky-notes-hover";
const ANCHOR_CLASS = "sticky-notes-anchor";
const NOTE_CLASS = "sticky-note";
const BADGE_CLASS = "sticky-note-badge";
const DRAGGING_CLASS = "sticky-note--dragging";
const TOGGLE_COMMAND = "toggle";
const SCREENSHOT_COMMAND = "screenshot";
const DOWNLOAD_COMMAND = "download";
const EXPORT_MARKDOWN_COMMAND = "export-markdown";
const EXPORT_JSON_COMMAND = "export-json";
const CLEAR_COMMAND = "clear";
const COLLAPSE_COMMAND = "collapse";
const REMOVE_COMMAND = "remove";
const TOGGLE_LABEL = "✎ Notes";
const SCREENSHOT_LABEL = "▭ Screenshot";
const DOWNLOAD_LABEL = "Download";
const SCREENSHOT_HINT = "drag a rectangle · Esc cancels";
const RENDERING_MESSAGE = "rendering…";
const SCREENSHOT_FAILED_MESSAGE = "screenshot failed";
const COPIED_MESSAGE$1 = "copied";
const NOT_COPIED_MESSAGE = "captured (clipboard blocked)";
const MARKDOWN_LABEL = "Copy Markdown";
const JSON_LABEL = "Copy JSON";
const CLEAR_LABEL = "Clear";
const COLLAPSE_LABEL = "collapse";
const REMOVE_LABEL = "remove note";
const DRAG_HINT = "drag to move";
const NOTE_PLACEHOLDER = "note…";
const LEADER_COLOR = "#c9a227";
const LEADER_WIDTH = 1.5;
const LEADER_DASH = "2 4";
const ANCHOR_DOT_RADIUS = 2.5;
function createLayer({ root, key, onPick, onChange, onRemove, onClear, onExport }) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const live = /* @__PURE__ */ new Map();
  let notes = [];
  let controller = null;
  let bar = null;
  let toggleButton = null;
  let countEl = null;
  let messageEl = null;
  let exportPane = null;
  let leaders = null;
  let picking = false;
  let hovered = null;
  let messageTimer = 0;
  let screenshotCount = 0;
  let lastScreenshot = null;
  let downloadButton = null;
  function mount2() {
    injectStyle();
    buildChrome();
    listen();
  }
  function unmount() {
    setPicking(false);
    controller.abort();
    clearNodes();
    for (const node of [bar, exportPane, leaders]) node.remove();
    unhover();
    doc.getElementById(STYLE_ID)?.remove();
  }
  function injectStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    doc.head.appendChild(style);
  }
  function buildChrome() {
    bar = doc.createElement("div");
    bar.className = "sticky-notes-bar";
    bar.innerHTML = `
      <button class="sticky-notes-bar__button" type="button" data-command="${TOGGLE_COMMAND}" aria-pressed="false">${TOGGLE_LABEL}</button>
      <span class="sticky-notes-bar__count">0</span>
      <button class="sticky-notes-bar__button" type="button" data-command="${SCREENSHOT_COMMAND}">${SCREENSHOT_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${DOWNLOAD_COMMAND}" disabled>${DOWNLOAD_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${EXPORT_MARKDOWN_COMMAND}">${MARKDOWN_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${EXPORT_JSON_COMMAND}">${JSON_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${CLEAR_COMMAND}">${CLEAR_LABEL}</button>
      <span class="sticky-notes-bar__message"></span>`;
    toggleButton = bar.querySelector(`[data-command="${TOGGLE_COMMAND}"]`);
    downloadButton = bar.querySelector(`[data-command="${DOWNLOAD_COMMAND}"]`);
    countEl = bar.querySelector(".sticky-notes-bar__count");
    messageEl = bar.querySelector(".sticky-notes-bar__message");
    exportPane = doc.createElement("pre");
    exportPane.className = "sticky-notes-export";
    exportPane.hidden = true;
    leaders = doc.createElementNS(SVG_NS, "svg");
    leaders.setAttribute("class", "sticky-notes-leaders");
    for (const node of [bar, exportPane, leaders]) {
      node.setAttribute("data-turbo-temporary", "");
      root.appendChild(node);
    }
    bar.addEventListener("click", onBarClick);
  }
  function onBarClick(event) {
    const command = event.target.closest("[data-command]")?.dataset.command;
    if (!command) return;
    if (command === TOGGLE_COMMAND) setPicking(!picking);
    if (command === SCREENSHOT_COMMAND) screenshot();
    if (command === DOWNLOAD_COMMAND) downloadLast();
    if (command === EXPORT_MARKDOWN_COMMAND) onExport(MARKDOWN);
    if (command === EXPORT_JSON_COMMAND) onExport(JSON_FORMAT);
    if (command === CLEAR_COMMAND) onClear();
  }
  function listen() {
    controller = new AbortController();
    const signal = controller.signal;
    doc.addEventListener("keydown", (event) => event.key === ESCAPE_KEY && setPicking(false), { signal });
    doc.addEventListener("mouseover", onMouseOver, { signal });
    doc.addEventListener("mouseout", unhover, { signal });
    doc.addEventListener("click", onDocumentClick, { signal, capture: true });
    view.addEventListener("resize", () => render(notes), { signal });
  }
  function onMouseOver(event) {
    if (!picking || event.target.closest(LAYER_SELECTOR)) return;
    unhover();
    hovered = event.target;
    hovered.classList.add(HOVER_CLASS);
  }
  function unhover() {
    hovered?.classList.remove(HOVER_CLASS);
    hovered = null;
  }
  function onDocumentClick(event) {
    if (!picking || event.target.closest(LAYER_SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    onPick(event.target);
  }
  function setPicking(on) {
    picking = on;
    doc.body.classList.toggle(PICKING_CLASS, on);
    toggleButton.setAttribute("aria-pressed", String(on));
    exportPane.hidden = true;
    if (!on) unhover();
  }
  function message(text) {
    messageEl.textContent = text;
    view.clearTimeout(messageTimer);
    messageTimer = view.setTimeout(() => messageEl.textContent = "", MESSAGE_MS);
  }
  async function screenshot(rect = null) {
    setPicking(false);
    if (!rect) message(SCREENSHOT_HINT);
    const area = rect ?? await selectRect(doc);
    if (!area) return null;
    message(RENDERING_MESSAGE);
    try {
      const canvas = await captureRect(doc, area);
      const blob = await toPng(canvas);
      lastScreenshot = { blob, name: screenshotFileName(key, ++screenshotCount) };
      downloadButton.disabled = false;
      const copied = await copyImage(view, blob);
      message(copied ? COPIED_MESSAGE$1 : NOT_COPIED_MESSAGE);
      return blob;
    } catch (error) {
      message(SCREENSHOT_FAILED_MESSAGE);
      throw error;
    }
  }
  function downloadLast() {
    if (!lastScreenshot) return;
    download(doc, lastScreenshot.blob, lastScreenshot.name);
    message(lastScreenshot.name);
  }
  function showExport(text) {
    exportPane.textContent = text;
    exportPane.hidden = false;
  }
  function render(nextNotes) {
    notes = nextNotes;
    clearNodes();
    notes.forEach(renderNote);
    countEl.textContent = notes.length;
    drawLeaders();
  }
  function renderNote(note, index2) {
    const el = findElement(note);
    note.orphan = !el;
    if (!el) return;
    backfill(note);
    el.classList.add(ANCHOR_CLASS);
    const box = buildNote(note, index2);
    const badge = buildBadge(note, index2);
    root.append(box, badge);
    placeNote(note, el, box);
    placeBadge(el, badge);
    live.set(note.id, { el, box, badge, observer: observeResize(note, box) });
    makeDraggable(note, el, box);
  }
  function findElement(note) {
    try {
      return doc.querySelector(note.path);
    } catch {
      return null;
    }
  }
  function backfill(note) {
    for (const [key2, value] of Object.entries(DEFAULT_BOX)) {
      if (typeof note[key2] !== "number") note[key2] = value;
    }
  }
  function buildNote(note, index2) {
    const box = doc.createElement("div");
    box.className = NOTE_CLASS;
    box.dataset.id = note.id;
    box.hidden = !!note.collapsed;
    box.setAttribute("data-turbo-temporary", "");
    box.innerHTML = `
      <header class="sticky-note__header" title="${DRAG_HINT}">
        <b class="sticky-note__index">${index2 + 1}</b>
        <code class="sticky-note__path"></code>
        <button class="sticky-note__button" type="button" data-command="${COLLAPSE_COMMAND}" title="${COLLAPSE_LABEL}" aria-label="${COLLAPSE_LABEL}">–</button>
        <button class="sticky-note__button" type="button" data-command="${REMOVE_COMMAND}" title="${REMOVE_LABEL}" aria-label="${REMOVE_LABEL}">✕</button>
      </header>
      <textarea class="sticky-note__text" placeholder="${NOTE_PLACEHOLDER}"></textarea>`;
    const path = box.querySelector(".sticky-note__path");
    path.textContent = note.path;
    path.title = note.path;
    const text = box.querySelector(".sticky-note__text");
    text.value = note.note;
    text.addEventListener("input", (event) => {
      note.note = event.target.value;
      onChange();
    });
    box.querySelector(`[data-command="${REMOVE_COMMAND}"]`).addEventListener("click", () => onRemove(note));
    box.querySelector(`[data-command="${COLLAPSE_COMMAND}"]`).addEventListener("click", () => {
      note.collapsed = true;
      onChange();
      render(notes);
    });
    return box;
  }
  function buildBadge(note, index2) {
    const badge = doc.createElement("span");
    badge.className = BADGE_CLASS;
    badge.textContent = index2 + 1;
    badge.title = note.note || note.path;
    badge.setAttribute("data-turbo-temporary", "");
    badge.addEventListener("click", () => {
      note.collapsed = !note.collapsed;
      onChange();
      render(notes);
    });
    return badge;
  }
  function makeDraggable(note, el, box) {
    const header = box.querySelector(".sticky-note__header");
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, dx: note.dx, dy: note.dy };
      box.classList.add(DRAGGING_CLASS);
      try {
        header.setPointerCapture(event.pointerId);
      } catch {
      }
      const move = (moveEvent) => {
        note.dx = start.dx + (moveEvent.clientX - start.x);
        note.dy = start.dy + (moveEvent.clientY - start.y);
        placeNote(note, el, box);
        drawLeaders();
      };
      const up = () => {
        header.removeEventListener("pointermove", move);
        box.classList.remove(DRAGGING_CLASS);
        onChange();
      };
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", up, { once: true });
      header.addEventListener("pointercancel", up, { once: true });
    });
  }
  function observeResize(note, box) {
    const observer = new ResizeObserver(() => {
      if (box.hidden || box.classList.contains(DRAGGING_CLASS)) return;
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      if (w === note.w && h === note.h) return;
      note.w = w;
      note.h = h;
      onChange();
      drawLeaders();
    });
    observer.observe(box);
    return observer;
  }
  function drawLeaders() {
    const page = doc.documentElement;
    leaders.setAttribute("width", page.scrollWidth);
    leaders.setAttribute("height", page.scrollHeight);
    leaders.innerHTML = "";
    for (const { el, box } of live.values()) {
      if (box.hidden) continue;
      const ends = leaderEnds(el, box);
      if (!ends) continue;
      leaders.insertAdjacentHTML(
        "beforeend",
        `<line x1="${ends.from.x}" y1="${ends.from.y}" x2="${ends.to.x}" y2="${ends.to.y}" stroke="${LEADER_COLOR}" stroke-width="${LEADER_WIDTH}" stroke-dasharray="${LEADER_DASH}" stroke-linecap="round"/><circle cx="${ends.from.x}" cy="${ends.from.y}" r="${ANCHOR_DOT_RADIUS}" fill="${LEADER_COLOR}"/>`
      );
    }
  }
  function clearNodes() {
    live.forEach(({ observer }) => observer.disconnect());
    live.clear();
    root.querySelectorAll(`.${NOTE_CLASS}, .${BADGE_CLASS}`).forEach((node) => node.remove());
    doc.querySelectorAll(`.${ANCHOR_CLASS}`).forEach((node) => node.classList.remove(ANCHOR_CLASS));
  }
  function focusNote(id) {
    live.get(id)?.box.querySelector(".sticky-note__text")?.focus();
  }
  return {
    mount: mount2,
    unmount,
    render,
    setPicking,
    focusNote,
    message,
    showExport,
    screenshot,
    get picking() {
      return picking;
    }
  };
}
const DEFAULT_ANCHORS = ["data-testid", "data-test"];
const ID_RADIX = 36;
const COPIED_MESSAGE = "copied";
const COPY_FAILED_MESSAGE = "select & copy";
function createStickyNotes(options = {}) {
  const key = options.key ?? location.pathname;
  const anchors = options.anchors ?? DEFAULT_ANCHORS;
  const store = createStore(options.storage ?? localStorage, key);
  let notes = [];
  let layer = null;
  let root = null;
  const save = () => store.save(notes);
  const rerender = () => layer?.render(notes);
  function mount2() {
    if (layer) unmount();
    root = options.root ?? document.body;
    notes = store.load();
    layer = createLayer({ root, key, onPick, onChange: save, onRemove, onClear: clear, onExport: exportNotes });
    layer.mount();
    rerender();
    return instance;
  }
  function unmount() {
    layer?.unmount();
    layer = null;
  }
  const refresh = () => rerender();
  function toggle(on = !layer?.picking) {
    layer?.setPicking(!!on);
  }
  function onPick(el) {
    const note = {
      id: Date.now().toString(ID_RADIX),
      ...cssPath(el, { anchors }),
      text: excerpt(el),
      ctx: contextOf(el),
      note: "",
      created: (/* @__PURE__ */ new Date()).toISOString(),
      ...DEFAULT_BOX,
      ...initialOffset(el)
    };
    notes.push(note);
    save();
    rerender();
    layer.focusNote(note.id);
    layer.setPicking(false);
  }
  function onRemove(note) {
    notes = notes.filter((candidate) => candidate !== note);
    save();
    rerender();
  }
  function clear() {
    if (!notes.length) return;
    const view = (root ?? document.body).ownerDocument.defaultView;
    if (!view?.confirm?.(`Delete ${notes.length} notes?`)) return;
    notes = [];
    save();
    rerender();
  }
  function exportNotes(format) {
    const doc = (root ?? document.body).ownerDocument;
    const meta = { title: doc.title, url: doc.defaultView.location.href, key };
    const rows = notes.map(toRow);
    const text = format === JSON_FORMAT ? toJson(rows, meta) : toMarkdown(rows, meta);
    layer?.showExport(text);
    copy(doc.defaultView, text);
    return text;
  }
  const toRow = (note, index2) => ({
    n: index2 + 1,
    path: note.path,
    anchored: note.anchored !== false,
    text: note.text,
    ctx: note.ctx || "",
    note: note.note,
    orphan: !!note.orphan
  });
  function copy(view, text) {
    const clipboard = view.navigator?.clipboard;
    if (!clipboard) return layer?.message(COPY_FAILED_MESSAGE);
    clipboard.writeText(text).then(
      () => layer?.message(COPIED_MESSAGE),
      () => layer?.message(COPY_FAILED_MESSAGE)
    );
  }
  const screenshot = (rect) => layer?.screenshot(rect) ?? Promise.resolve(null);
  const instance = {
    mount: mount2,
    unmount,
    refresh,
    toggle,
    screenshot,
    export: exportNotes,
    clear,
    get notes() {
      return notes.slice();
    }
  };
  return instance;
}
let singleton = null;
function mount(options = {}) {
  singleton?.unmount();
  singleton = createStickyNotes(options);
  singleton.mount();
  return singleton;
}
const index = { createStickyNotes, mount };
export {
  createStickyNotes,
  index as default,
  mount
};
