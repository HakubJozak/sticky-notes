import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createStickyNotes } from "../src/index.js"

const KEY = "/kids/12"
const JPEG = "/9j/4AAQ" // any base64; the overlay never inspects it

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

function memoryChannel(sessions = [{ id: "s1", cwd: "/p", label: "p" }]) {
  const sent = []
  return { sent, sessions: async () => sessions, send: async (payload) => (sent.push(payload), { delivered: true }) }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("send", () => {
  let storage, channel, instance

  beforeEach(async () => {
    document.body.innerHTML = '<main><h2 id="title">Kid 12</h2><button id="save">Save</button></main>'
    storage = fakeStorage()
    channel = memoryChannel()
    instance = createStickyNotes({ key: KEY, storage, channel }).mount()
    instance.setAutoShot(false) // jsdom has no canvas
    await tick() // sessions() resolved, picker filled
  })

  afterEach(() => instance.unmount())

  it("shows the send controls only when a channel exists", () => {
    expect(document.querySelector('[data-command="send"]').hidden).toBe(false)

    const without = createStickyNotes({ key: "/other", storage, channel: null, root: document.body }).mount()
    expect(document.querySelectorAll('[data-command="send"]')[1].hidden).toBe(true)
    expect(document.querySelectorAll('[data-command="connect"]')[1].hidden).toBe(false)
    without.unmount()
  })

  it("sends the export rows with attached screenshots to the picked session", async () => {
    instance.toggle(true)
    document.getElementById("save").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    const [note] = instance.notes
    instance.attachScreenshot(note.id, JPEG)

    expect(document.querySelector(".sticky-notes-bar__shots").textContent).toBe("1 shot")

    const result = await instance.send()

    expect(result).toEqual({ delivered: true })
    expect(channel.sent[0]).toEqual({
      session: "s1",
      url: location.href,
      key: KEY,
      title: document.title,
      notes: [expect.objectContaining({ n: 1, path: "#save", text: "Save", shots: [JPEG] })],
    })
    expect(document.querySelector(".sticky-notes-bar__shots").textContent).toBe("")
  })

  it("refuses to send while no session is picked", async () => {
    const multi = memoryChannel([{ id: "s1", cwd: "/a", label: "a" }, { id: "s2", cwd: "/b", label: "b" }])
    const other = createStickyNotes({ key: "/multi", storage, channel: multi }).mount()
    await tick()

    expect(await other.send()).toBeNull()
    expect(multi.sent).toEqual([])
    other.unmount()
  })

  it("warns about screenshots lost on reload", () => {
    storage.setItem("sticky-notes:pending:/lost", "2")
    const lost = createStickyNotes({ key: "/lost", storage, channel }).mount()

    // the last bar on the page belongs to the instance mounted last
    expect([...document.querySelectorAll(".sticky-notes-toast")].at(-1).textContent).toBe("2 screenshots lost")
    expect(storage.data.get("sticky-notes:pending:/lost")).toBe("0")
    lost.unmount()
  })

  it("reports a failed capture instead of sending half a payload", async () => {
    const shooting = memoryChannel()
    const auto = createStickyNotes({ key: "/auto", storage, channel: shooting }).mount()
    auto.setAutoShot(true) // jsdom has no canvas, so the capture throws for real
    await tick()

    auto.toggle(true)
    document.getElementById("save").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))

    await expect(auto.send()).rejects.toThrow()
    expect(shooting.sent).toEqual([])
    expect([...document.querySelectorAll(".sticky-notes-toast")].at(-1).textContent).toMatch(/^send failed: /)
    auto.unmount()
  })

  it("forgets the screenshots of notes that are gone", async () => {
    instance.toggle(true)
    document.getElementById("save").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    const [note] = instance.notes
    instance.attachScreenshot(note.id, JPEG)

    const confirm = window.confirm
    window.confirm = () => true
    try {
      instance.clear()
    } finally {
      window.confirm = confirm
    }

    expect(document.querySelector(".sticky-notes-bar__shots").textContent).toBe("")

    instance.attachScreenshot(note.id, JPEG) // stale id: that note is gone
    expect(document.querySelector(".sticky-notes-bar__shots").textContent).toBe("")

    await instance.send()
    expect(channel.sent[0].notes).toEqual([])
  })

  it("never offers Connect where the page was mounted by a Rails adapter", () => {
    const railsPage = createStickyNotes({ key: "/rails", storage, channel: null, connect: false, root: document.body }).mount()

    const bar = [...document.querySelectorAll(".sticky-notes-bar")].at(-1)
    expect(bar.querySelector('[data-command="send"]').hidden).toBe(true)
    expect(bar.querySelector('[data-command="connect"]').hidden).toBe(true)
    railsPage.unmount()
  })

  // The engine renders the channel whether or not a daemon answers, and its
  // daemon is not the browser's — Connect would send the reviewer nowhere.
  it("hides Send and Connect on an engine page with no daemon", async () => {
    const engine = createStickyNotes({
      key: "/engine", storage, channel: "/sticky-notes", channelToken: "page-token",
      fetch: async () => new Response("", { status: 503 }),
    }).mount()
    await tick()

    const bar = [...document.querySelectorAll(".sticky-notes-bar")].at(-1)
    expect(bar.querySelector('[data-command="send"]').hidden).toBe(true)
    expect(bar.querySelector('[data-command="connect"]').hidden).toBe(true)
    expect([...document.querySelectorAll(".sticky-notes-toast")].at(-1).textContent).toMatch(/^no daemon: /)
    engine.unmount()
  })

  it("sends one payload at a time", async () => {
    let release
    const deferred = {
      sent: [],
      sessions: async () => [{ id: "s1", cwd: "/p", label: "p" }],
      send: async (payload) => {
        deferred.sent.push(payload)
        await new Promise((resolve) => (release = resolve))
        return { delivered: true }
      },
    }
    const one = createStickyNotes({ key: "/one", storage, channel: deferred }).mount()
    one.setAutoShot(false)
    await tick()

    const first = one.send()

    expect(await one.send()).toBeNull()
    expect([...document.querySelectorAll(".sticky-notes-toast")].at(-1).textContent).toBe("sending…")

    release()
    expect(await first).toEqual({ delivered: true })
    expect(deferred.sent).toHaveLength(1)
    one.unmount()
  })

  it("connects the direct path from a pasted token", () => {
    const bare = createStickyNotes({ key: "/file", storage, channel: null, fetch: async () => new Response("[]") }).mount()
    bare.connect("t0ken")

    expect(storage.data.get("sticky-notes:daemon-token")).toBe("t0ken")
    expect(bare.channel).not.toBeNull()
    bare.unmount()
  })
})
