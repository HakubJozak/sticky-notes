/* The MCP side of the sticky-notes MCP server: a minimal stdio JSON-RPC
   server whose only job is to declare the claude/channel capability and push
   notifications/claude/channel. No tools, no resources, no SDK. */
import { readLines, writeLine } from "./ndjson.js"

const JSONRPC = "2.0"
const SERVER_NAME = "sticky-notes"
const CHANNEL_CAPABILITY = "claude/channel"
const CHANNEL_NOTIFICATION = "notifications/claude/channel"
const INITIALIZED = "notifications/initialized"
const METHOD_NOT_FOUND = -32601

export function createChannelServer({ input, output, instructions, version }) {
  const pending = [] // events that arrived before Claude Code finished the handshake
  let ready = false

  const handlers = {
    initialize: (params) => ({
      protocolVersion: params.protocolVersion,
      capabilities: { experimental: { [CHANNEL_CAPABILITY]: {} }, tools: {} },
      serverInfo: { name: SERVER_NAME, version },
      instructions,
    }),
    ping: () => ({}),
    "tools/list": () => ({ tools: [] }),
  }

  readLines(input, onMessage, (error) => console.error(`channel: ${error.message}`))

  function onMessage(message) {
    if (message.method === INITIALIZED) return flush()
    if (message.id === undefined) return // other notifications need no answer

    const handler = handlers[message.method]
    if (!handler) {
      return writeLine(output, { jsonrpc: JSONRPC, id: message.id, error: { code: METHOD_NOT_FOUND, message: `method not found: ${message.method}` } })
    }

    writeLine(output, { jsonrpc: JSONRPC, id: message.id, result: handler(message.params ?? {}) })
  }

  function flush() {
    ready = true
    for (const event of pending.splice(0)) push(event)
  }

  const push = ({ content, meta }) => writeLine(output, { jsonrpc: JSONRPC, method: CHANNEL_NOTIFICATION, params: { content, meta } })

  function notify(content, meta) {
    if (!ready) return pending.push({ content, meta })

    push({ content, meta })
  }

  return { notify }
}
