/* Unix-socket side of the daemon: every connection is one MCP server; its
   first message registers it and the connection itself is its liveness. */
import { createServer } from "node:net"
import { readLines } from "./ndjson.js"

const REGISTER = "register"
const RENAME = "rename"

export function createSocketServer({ sessions, log }) {
  return createServer((socket) => {
    let id = null

    readLines(
      socket,
      (message) => {
        if (message.type === RENAME && id) {
          sessions.rename(id, message.label)
          return log(`session ${id} renamed: ${message.label}`)
        }
        if (message.type !== REGISTER || id) return log(`socket: ignored ${message.type}`)

        id = sessions.register(socket, message).id
        log(`session ${id} registered: ${message.label} (${message.cwd}, pid ${message.pid})`)
        socket.on("close", () => log(`session ${id} gone`))
      },
      (error) => log(`socket: ${error.message}`),
    )
    socket.on("error", (error) => log(`socket: ${error.message}`))
  })
}
