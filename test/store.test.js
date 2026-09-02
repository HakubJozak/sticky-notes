import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "../src/store.js"

const KEY = "/review"
const STORAGE_KEY = "sticky-notes:/review"
const LEGACY_KEY = "kz-notes:/review"

// Minimal Storage stand-in: the store only needs these three methods.
function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))

  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
}

describe("createStore", () => {
  let storage

  beforeEach(() => (storage = fakeStorage()))

  it("loads an empty list when nothing is stored", () => {
    expect(createStore(storage, KEY).load()).toEqual([])
  })

  it("round-trips notes under the prefixed key", () => {
    const store = createStore(storage, KEY)
    const notes = [{ id: "a", path: "main", note: "hi" }]

    store.save(notes)

    expect(JSON.parse(storage.data.get(STORAGE_KEY))).toEqual(notes)
    expect(createStore(storage, KEY).load()).toEqual(notes)
  })

  it("returns an empty list for corrupt json", () => {
    storage.setItem(STORAGE_KEY, "{not json")

    expect(createStore(storage, KEY).load()).toEqual([])
  })

  it("returns an empty list when the stored value is not an array", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ notes: [] }))

    expect(createStore(storage, KEY).load()).toEqual([])
  })

  it("migrates legacy notes on first read and drops the old key", () => {
    const legacy = [{ id: "old", path: "main", note: "from the prototype" }]
    storage.setItem(LEGACY_KEY, JSON.stringify(legacy))

    expect(createStore(storage, KEY).load()).toEqual(legacy)
    expect(JSON.parse(storage.data.get(STORAGE_KEY))).toEqual(legacy)
    expect(storage.getItem(LEGACY_KEY)).toBeNull()
  })

  it("prefers existing notes over a legacy bucket and leaves it alone", () => {
    const current = [{ id: "new" }]
    storage.setItem(STORAGE_KEY, JSON.stringify(current))
    storage.setItem(LEGACY_KEY, JSON.stringify([{ id: "old" }]))

    expect(createStore(storage, KEY).load()).toEqual(current)
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull()
  })

  it("survives a storage that throws", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("quota")
      },
      removeItem: () => {
        throw new Error("blocked")
      },
    }
    const store = createStore(hostile, KEY)

    expect(store.load()).toEqual([])
    expect(() => store.save([{ id: "a" }])).not.toThrow()
  })

  it("keys buckets per page", () => {
    createStore(storage, "/one").save([{ id: "1" }])
    createStore(storage, "/two").save([{ id: "2" }])

    expect(createStore(storage, "/one").load()).toEqual([{ id: "1" }])
    expect(createStore(storage, "/two").load()).toEqual([{ id: "2" }])
  })
})
