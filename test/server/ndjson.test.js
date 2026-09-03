// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PassThrough } from "node:stream"
import { readLines, writeLine } from "../../server/ndjson.js"

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe("ndjson", () => {
  it("emits one parsed object per line, across chunk boundaries", async () => {
    const stream = new PassThrough()
    const seen = []
    readLines(stream, (msg) => seen.push(msg), () => {})

    stream.write("{\"a\":1}\n{\"b\"")
    stream.write(":2}\n\n")
    await tick()

    expect(seen).toEqual([{ a: 1 }, { b: 2 }])
  })

  it("reports a bad line and keeps reading", async () => {
    const stream = new PassThrough()
    const seen = []
    const errors = []
    readLines(stream, (msg) => seen.push(msg), (error) => errors.push(error))

    stream.write("not json\n{\"ok\":true}\n")
    await tick()

    expect(errors).toHaveLength(1)
    expect(seen).toEqual([{ ok: true }])
  })

  it("writes one line per message", () => {
    const stream = new PassThrough()
    writeLine(stream, { type: "event", content: "x" })

    expect(stream.read().toString()).toBe("{\"type\":\"event\",\"content\":\"x\"}\n")
  })
})
