import { it, expect } from "vitest"

import { attach } from "../src/turbo.js"

const BAR = ".sticky-notes-bar"
const KEY = "turbo-test"
const NOTE = { id: "1", path: "body", anchored: true, text: "x", ctx: "", note: "n", created: "", dx: 0, dy: 0, w: 240, h: 120 }

// jsdom has no ResizeObserver; layer.js observes every rendered note box.
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} }

// The inline module script re-runs on every Turbo visit, so attach() is called
// repeatedly — it must re-mount, not stack listeners or bars.
it("mounts once across repeated attach calls and unmounts before caching", () => {
  localStorage.setItem(`sticky-notes:${KEY}`, JSON.stringify([NOTE]))
  document.body.innerHTML = `<div data-sticky-notes data-key="${KEY}"></div>`

  attach()
  const notes = attach()

  expect(document.querySelectorAll(BAR)).toHaveLength(1)
  // data-key picked the bucket; without it the key would be location.pathname
  expect(notes.notes).toHaveLength(1)

  document.dispatchEvent(new Event("turbo:before-cache"))
  expect(document.querySelectorAll(BAR)).toHaveLength(0)
})
