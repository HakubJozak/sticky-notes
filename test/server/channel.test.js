// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PassThrough } from "node:stream"
import { createChannelServer } from "../../server/channel.js"

const PROTOCOL = "2025-06-18"
const request = (id, method, params = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
const notification = (method) => JSON.stringify({ jsonrpc: "2.0", method }) + "\n"
const tick = () => new Promise((resolve) => setImmediate(resolve))

function boot() {
  const input = new PassThrough()
  const output = new PassThrough()
  const out = []
  output.on("data", (chunk) => out.push(...String(chunk).split("\n").filter(Boolean).map(JSON.parse)))
  const server = createChannelServer({ input, output, instructions: "review notes", version: "0.2.0" })

  return { input, out, server }
}

describe("createChannelServer", () => {
  it("declares the channel capability and instructions on initialize", async () => {
    const { input, out } = boot()
    input.write(request(1, "initialize", { protocolVersion: PROTOCOL }))
    await tick()

    expect(out[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { experimental: { "claude/channel": {} }, tools: {} },
        serverInfo: { name: "sticky-notes", version: "0.2.0" },
        instructions: "review notes",
      },
    })
  })

  it("answers ping and an empty tools/list, rejects the rest", async () => {
    const { input, out } = boot()
    input.write(request(2, "ping") + request(3, "tools/list") + request(4, "resources/list"))
    await tick()

    expect(out).toEqual([
      { jsonrpc: "2.0", id: 2, result: {} },
      { jsonrpc: "2.0", id: 3, result: { tools: [] } },
      { jsonrpc: "2.0", id: 4, error: { code: -32601, message: "method not found: resources/list" } },
    ])
  })

  it("holds events until initialized, then pushes channel notifications", async () => {
    const { input, out, server } = boot()
    server.notify("# Notes", { count: "1" })
    await tick()
    expect(out).toEqual([])

    input.write(request(1, "initialize", { protocolVersion: PROTOCOL }) + notification("notifications/initialized"))
    await tick()
    server.notify("# More", { count: "2" })
    await tick()

    expect(out.slice(1)).toEqual([
      { jsonrpc: "2.0", method: "notifications/claude/channel", params: { content: "# Notes", meta: { count: "1" } } },
      { jsonrpc: "2.0", method: "notifications/claude/channel", params: { content: "# More", meta: { count: "2" } } },
    ])
  })
})
