/* Unix-socket side of the daemon: every connection is one MCP server; its
   first message registers it and the connection itself is its liveness. */
import { createServer } from "node:net"
import { readLines } from "./ndjson.js"

const REGISTER = "register"

export function createSocketServer({ sessions, log }) {
  return createServer((socket) => {
    readLines(
      socket,
      (message) => {
        if (message.type !== REGISTER) return log(`socket: ignored ${message.type}`)

        const { id } = sessions.register(socket, message)
        log(`session ${id} registered: ${message.label} (${message.cwd}, pid ${message.pid})`)
        socket.on("close", () => log(`session ${id} gone`))
      },
      (error) => log(`socket: ${error.message}`),
    )
    socket.on("error", (error) => log(`socket: ${error.message}`))
  })
}
