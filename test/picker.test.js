import { describe, it, expect, beforeEach } from "vitest"
import { createPicker, QUEUE, QUEUE_LABEL, PICK_LABEL } from "../src/picker.js"

const KEY = "/kids/12"
const STORAGE_KEY = "sticky-notes:session:/kids/12"
const A = { id: "s1", cwd: "/home/dev/projects/krouzitko", label: "krouzitko" }
const B = { id: "s2", cwd: "/home/dev", label: "home" }

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

describe("createPicker", () => {
  let storage, opened

  beforeEach(() => {
    storage = fakeStorage()
    opened = 0
  })

  const picker = () => createPicker({ doc: document, storage, key: KEY, onOpen: () => opened++ })
  const labels = (el) => [...el.options].map((o) => o.textContent)

  it("selects the only live session by itself", () => {
    const p = picker()
    p.refresh([A])

    expect(p.value).toBe("s1")
    expect(labels(p.el)).toEqual(["krouzitko · /home/dev/projects/krouzitko", QUEUE_LABEL])
  })

  it("keeps the order it is given and asks to pick when there are several", () => {
    const p = picker()
    p.refresh([B, A])

    expect(p.value).toBe("")
    expect(labels(p.el)).toEqual([PICK_LABEL, "home · /home/dev", "krouzitko · /home/dev/projects/krouzitko", QUEUE_LABEL])
  })

  it("remembers the choice per key and restores it while that session is live", () => {
    const p = picker()
    p.refresh([A, B])
    p.el.value = "s2"
    p.el.dispatchEvent(new Event("change"))

    expect(storage.data.get(STORAGE_KEY)).toBe("s2")

    const again = picker()
    again.refresh([A, B])
    expect(again.value).toBe("s2")

    again.refresh([A])
    expect(again.value).toBe("s1") // the remembered one is gone; single live session wins
  })

  it("offers only the queue when nothing is live, without preselecting it", () => {
    const p = picker()
    p.refresh([])

    expect(labels(p.el)).toEqual([PICK_LABEL, QUEUE_LABEL])
    expect(p.value).toBe("")

    p.el.value = QUEUE
    p.el.dispatchEvent(new Event("change"))
    expect(p.value).toBe(QUEUE)
  })

  it("reports when it is opened", () => {
    const p = picker()
    p.el.dispatchEvent(new Event("focus"))
    p.el.dispatchEvent(new Event("mousedown"))

    expect(opened).toBe(2)
  })
})
