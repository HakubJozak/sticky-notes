(function(exports) {
  "use strict";
  const LAYER_SELECTOR = ".sticky-notes-bar, .sticky-notes-export, .sticky-notes-leaders, .sticky-note, .sticky-note-badge";
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
      ""
    ];
  }
  function flagsOf(row) {
    let flags = "";
    if (row.orphan) flags += ` ${ORPHAN_FLAG}`;
    if (row.anchored === false) flags += ` ${UNANCHORED_FLAG}`;
    return flags;
  }
  const css = '/* Injected once at mount as <style id="sticky-notes-style">.\n   `all: unset` on controls and a z-index near the maximum keep the layer intact\n   on host pages with aggressive CSS. Host pages may lack a [hidden] reset, so we\n   ship our own. */\n\n.sticky-notes-bar {\n  position: fixed;\n  right: 16px;\n  bottom: 16px;\n  z-index: 2147482930;\n  display: flex;\n  gap: 6px;\n  align-items: center;\n  background: var(--card, #fff);\n  color: var(--ink, #1e2430);\n  border: 1px solid var(--line, #c8ccd4);\n  padding: 6px 8px;\n  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);\n  font: 12px "IBM Plex Mono", ui-monospace, Menlo, monospace;\n}\n\n.sticky-notes-bar__button {\n  all: unset;\n  cursor: pointer;\n  padding: 6px 10px;\n  border: 1px solid var(--line, #c8ccd4);\n  font: inherit;\n  line-height: 1;\n  white-space: nowrap;\n}\n\n.sticky-notes-bar__button:hover {\n  background: rgba(0, 0, 0, 0.06);\n}\n\n.sticky-notes-bar__button[aria-pressed="true"] {\n  background: #e0b400;\n  color: #1e2430;\n  border-color: #e0b400;\n}\n\n.sticky-notes-bar__count {\n  opacity: 0.6;\n  min-width: 3ch;\n  text-align: center;\n}\n\n.sticky-notes-bar__message {\n  opacity: 0.6;\n}\n\nbody.sticky-notes-picking,\nbody.sticky-notes-picking * {\n  cursor: crosshair !important;\n}\n\n.sticky-notes-hover {\n  outline: 2px dashed #e0b400 !important;\n  outline-offset: 2px;\n}\n\n.sticky-notes-anchor {\n  outline: 2px solid #e0b400 !important;\n  outline-offset: 2px;\n}\n\n.sticky-notes-leaders {\n  position: absolute;\n  left: 0;\n  top: 0;\n  z-index: 2147482900;\n  pointer-events: none;\n  overflow: visible;\n}\n\n.sticky-note {\n  position: absolute;\n  z-index: 2147482920;\n  width: 240px;\n  height: 110px;\n  min-width: 160px;\n  min-height: 72px;\n  display: flex;\n  flex-direction: column;\n  box-sizing: border-box;\n  resize: both;\n  overflow: hidden;\n  margin: 0;\n  background: #fff3b0;\n  color: #1e2430;\n  border: 1px solid #d9b93c;\n  border-radius: 0;\n  box-shadow: 2px 3px 0 rgba(0, 0, 0, 0.18);\n  padding: 6px 8px 8px;\n  font: 12px/1.4 "IBM Plex Sans", system-ui, sans-serif;\n  text-align: left;\n}\n\n.sticky-note[hidden],\n.sticky-notes-export[hidden] {\n  display: none !important;\n}\n\n.sticky-note--dragging {\n  box-shadow: 6px 8px 0 rgba(0, 0, 0, 0.22);\n  opacity: 0.95;\n}\n\n.sticky-note__header {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  margin: 0 0 4px;\n  padding: 0;\n  font: 600 11px "IBM Plex Mono", ui-monospace, Menlo, monospace;\n  color: #6b5a12;\n  cursor: grab;\n  user-select: none;\n  touch-action: none;\n}\n\n.sticky-note--dragging .sticky-note__header {\n  cursor: grabbing;\n}\n\n.sticky-note__index {\n  background: #1e2430;\n  color: #fff3b0;\n  border-radius: 9px;\n  padding: 0 6px;\n  font: inherit;\n}\n\n.sticky-note__path {\n  flex: 1;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font: inherit;\n  font-size: 10px;\n  background: none;\n  color: inherit;\n  padding: 0;\n}\n\n.sticky-note__button {\n  all: unset;\n  color: #6b5a12;\n  padding: 0 4px;\n  cursor: pointer;\n  font-size: 14px;\n  line-height: 18px;\n}\n\n.sticky-note__button[data-command="remove"] {\n  font-weight: 700;\n  border: 1px solid transparent;\n}\n\n.sticky-note__button[data-command="remove"]:hover {\n  color: #fff;\n  background: #b3261e;\n  border-color: #b3261e;\n}\n\n.sticky-note__text {\n  all: unset;\n  display: block;\n  flex: 1;\n  width: 100%;\n  box-sizing: border-box;\n  min-height: 0;\n  color: inherit;\n  font: inherit;\n  white-space: pre-wrap;\n  overflow: auto;\n}\n\n.sticky-note-badge {\n  position: absolute;\n  z-index: 2147482910;\n  background: #1e2430;\n  color: #fff3b0;\n  font: 700 10px "IBM Plex Mono", ui-monospace, Menlo, monospace;\n  border-radius: 9px;\n  padding: 0 5px;\n  line-height: 16px;\n  cursor: pointer;\n}\n\n.sticky-notes-export {\n  position: fixed;\n  left: 16px;\n  right: 16px;\n  bottom: 64px;\n  max-height: 40vh;\n  overflow: auto;\n  z-index: 2147482930;\n  margin: 0;\n  background: var(--card, #fff);\n  color: var(--ink, #1e2430);\n  border: 1px solid var(--line, #c8ccd4);\n  padding: 12px;\n  font: 12px "IBM Plex Mono", ui-monospace, Menlo, monospace;\n  white-space: pre-wrap;\n  text-align: left;\n}\n';
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
  const EXPORT_MARKDOWN_COMMAND = "export-markdown";
  const EXPORT_JSON_COMMAND = "export-json";
  const CLEAR_COMMAND = "clear";
  const COLLAPSE_COMMAND = "collapse";
  const REMOVE_COMMAND = "remove";
  const TOGGLE_LABEL = "✎ Notes";
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
  function createLayer({ root, onPick, onChange, onRemove, onClear, onExport }) {
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
      <button class="sticky-notes-bar__button" type="button" data-command="${EXPORT_MARKDOWN_COMMAND}">${MARKDOWN_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${EXPORT_JSON_COMMAND}">${JSON_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${CLEAR_COMMAND}">${CLEAR_LABEL}</button>
      <span class="sticky-notes-bar__message"></span>`;
      toggleButton = bar.querySelector(`[data-command="${TOGGLE_COMMAND}"]`);
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
      for (const [key, value] of Object.entries(DEFAULT_BOX)) {
        if (typeof note[key] !== "number") note[key] = value;
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
      layer = createLayer({ root, onPick, onChange: save, onRemove, onClear: clear, onExport: exportNotes });
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
    const instance = {
      mount: mount2,
      unmount,
      refresh,
      toggle,
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
  exports.createStickyNotes = createStickyNotes;
  exports.default = index;
  exports.mount = mount;
  Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
})(this.StickyNotes = this.StickyNotes || {});
