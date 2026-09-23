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

// turbo:load and the inline script both call in for the same element — the
// second call must not rebuild the layer (two daemon calls, a flash of chrome).
it("leaves a layer that is already on the current element alone", () => {
  document.body.innerHTML = `<div data-sticky-notes data-key="${KEY}"></div>`

  const first = attach()
  const pin = document.querySelector(".sticky-notes-pin")
  document.dispatchEvent(new Event("turbo:load"))

  expect(attach()).toBe(first)
  expect(document.querySelector(".sticky-notes-pin")).toBe(pin)

  // a new body (Turbo visit) has a new element → a fresh mount
  document.body.innerHTML = `<div data-sticky-notes data-key="${KEY}"></div>`
  document.dispatchEvent(new Event("turbo:load"))
  expect(document.querySelectorAll(".sticky-notes-pin")).toHaveLength(1)
  expect(document.querySelector(".sticky-notes-pin")).not.toBe(pin)
})
