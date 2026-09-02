/* Adapter for hosts without Stimulus: a `<script type="module">` in the layout
   imports attach() and Turbo events keep the layer in sync. Works without
   Turbo too — the listeners simply never fire. */
import { mount } from "./index.js"

const DEFAULT_SELECTOR = "[data-sticky-notes]"

let selector = DEFAULT_SELECTOR
let listening = false
let notes = null

export function attach(target = DEFAULT_SELECTOR) {
  selector = target
  listen()

  return remount()
}

// Turbo re-evaluates inline body module scripts on every visit, so attach()
// runs many times per page — the flag keeps a single set of listeners.
function listen() {
  if (listening) return
  listening = true

  document.addEventListener("turbo:load", remount)
  document.addEventListener("turbo:before-cache", () => notes?.unmount())
  document.addEventListener("turbo:frame-render", () => notes?.refresh())
  document.addEventListener("turbo:morph", () => notes?.refresh())
}

// data-anchors="data-qa data-cy" → attributes the host treats as stable anchors
const anchorsOf = (el) => el.dataset.anchors?.split(/\s+/).filter(Boolean)

// The host element is a new node after every visit, so always re-find it.
function remount() {
  const el = document.querySelector(selector)
  notes = el ? mount({ root: el, key: el.dataset.key || undefined, anchors: anchorsOf(el) }) : null

  return notes
}
