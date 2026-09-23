import { mount } from "./sticky-notes.js";
const DEFAULT_SELECTOR = "[data-sticky-notes]";
const LOG_PREFIX = "[sticky-notes]";
let selector = DEFAULT_SELECTOR;
let listening = false;
let notes = null;
function attach(target = DEFAULT_SELECTOR) {
  selector = target;
  listen();
  return remount();
}
function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("turbo:load", remount);
  document.addEventListener("turbo:render", remount);
  document.addEventListener("turbo:before-cache", () => {
    notes?.unmount();
    trace("turbo:before-cache", "unmounted");
  });
  document.addEventListener("turbo:frame-render", () => notes?.refresh());
  document.addEventListener("turbo:morph", () => notes?.refresh());
}
const anchorsOf = (el) => el.dataset.anchors?.split(/\s+/).filter(Boolean);
function remount(event) {
  const el = document.querySelector(selector);
  const why = event?.type ?? "attach";
  if (el && notes?.mounted && notes.root === el) {
    trace(why, "kept");
    return notes;
  }
  notes = el ? mount({ root: el, key: el.dataset.key || void 0, anchors: anchorsOf(el), channel: el.dataset.channel, channelToken: el.dataset.channelToken, connect: false }) : null;
  trace(why, el ? "mounted" : "no host element");
  return notes;
}
const trace = (why, what) => console.debug(LOG_PREFIX, why, what, location.pathname);
export {
  attach
};
