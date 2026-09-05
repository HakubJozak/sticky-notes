import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createStickyNotes } from "../src/index.js"

const KEY = "/orders/7"

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
const bar = () => document.querySelector(".sticky-notes-bar")
const pin = () => document.querySelector(".sticky-notes-pin")
const toast = () => document.querySelector(".sticky-notes-toast")
const sendButton = () => document.querySelector('[data-command="send"]')

// A channel whose send() waits for the test to release it.
function slowChannel() {
  const gate = {}
  return {
    gate,
    sessions: async () => [{ id: "s1", cwd: "/p", label: "portal" }],
    send: async () => {
      await new Promise((resolve) => (gate.release = resolve))
      return { delivered: true }
    },
  }
}

describe("folded bar", () => {
  let storage, instance

  beforeEach(() => {
    document.body.innerHTML = '<main><button id="save">Save</button></main>'
    storage = fakeStorage()
    instance = createStickyNotes({ key: KEY, storage, channel: null }).mount()
  })

  afterEach(() => instance.unmount())

  it("shows only the pin until it is clicked, and remembers the choice", () => {
    expect(bar().hidden).toBe(true)
    expect(pin().hidden).toBe(false)

    click(pin())
    expect(bar().hidden).toBe(false)
    expect(storage.data.get("sticky-notes:bar")).toBe("open")

    click(pin())
    expect(bar().hidden).toBe(true)
    expect(storage.data.get("sticky-notes:bar")).toBe("closed")
  })

  it("opens where the reviewer left it", () => {
    const remembered = createStickyNotes({ key: "/other", storage: fakeStorage({ "sticky-notes:bar": "open" }), channel: null, root: document.body }).mount()

    expect([...document.querySelectorAll(".sticky-notes-bar")].at(-1).hidden).toBe(false)
    remembered.unmount()
  })

  it("unfolds when picking starts from outside, folds picking away with itself", () => {
    instance.toggle(true)
    expect(bar().hidden).toBe(false)
    expect(document.body.classList.contains("sticky-notes-picking")).toBe(true)

    click(pin())
    expect(document.body.classList.contains("sticky-notes-picking")).toBe(false)
  })

  it("counts the notes on the pin while the bar is folded", () => {
    expect(document.querySelector(".sticky-notes-pin__count").hidden).toBe(true)

    instance.toggle(true)
    click(document.getElementById("save"))
    click(pin()) // fold it again

    const count = document.querySelector(".sticky-notes-pin__count")
    expect(count.hidden).toBe(false)
    expect(count.textContent).toBe("1")
    expect(document.querySelectorAll(".sticky-note")).toHaveLength(1) // the note itself stays
  })
})

describe("send feedback", () => {
  let instance, channel

  beforeEach(async () => {
    document.body.innerHTML = '<main><button id="save">Save</button></main>'
    channel = slowChannel()
    instance = createStickyNotes({ key: KEY, storage: fakeStorage(), channel }).mount()
    instance.setAutoShot(false)
    await tick()
  })

  afterEach(() => instance.unmount())

  it("shows progress on the button and a green toast naming the session", async () => {
    const sent = instance.send()
    await tick()

    expect(sendButton().disabled).toBe(true)
    expect(sendButton().textContent).toBe("sending…")
    expect(sendButton().classList.contains("sticky-notes-bar__button--busy")).toBe(true)

    channel.gate.release()
    await sent

    expect(sendButton().disabled).toBe(false)
    expect(sendButton().textContent).toBe("Send")
    expect(toast().hidden).toBe(false)
    expect(toast().textContent).toBe("sent to portal")
    expect(toast().dataset.kind).toBe("ok")
  })

  it("flags a failure in red and frees the button", async () => {
    const failing = { sessions: channel.sessions, send: async () => { throw new Error("boom") } }
    const broken = createStickyNotes({ key: "/broken", storage: fakeStorage(), channel: failing, root: document.body }).mount()
    broken.setAutoShot(false)
    await tick()

    await expect(broken.send()).rejects.toThrow("boom")

    const last = [...document.querySelectorAll(".sticky-notes-toast")].at(-1)
    expect(last.textContent).toBe("send failed: boom")
    expect(last.dataset.kind).toBe("error")
    expect([...document.querySelectorAll('[data-command="send"]')].at(-1).disabled).toBe(false)
    broken.unmount()
  })
})
