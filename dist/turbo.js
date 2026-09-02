import { mount } from "./sticky-notes.js";
const DEFAULT_SELECTOR = "[data-sticky-notes]";
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
  document.addEventListener("turbo:before-cache", () => notes?.unmount());
  document.addEventListener("turbo:frame-render", () => notes?.refresh());
  document.addEventListener("turbo:morph", () => notes?.refresh());
}
const anchorsOf = (el) => el.dataset.anchors?.split(/\s+/).filter(Boolean);
function remount() {
  const el = document.querySelector(selector);
  notes = el ? mount({ root: el, key: el.dataset.key || void 0, anchors: anchorsOf(el) }) : null;
  return notes;
}
export {
  attach
};
