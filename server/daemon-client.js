/* Daemon side of the sticky-notes MCP server. Keeps one socket to the daemon
   open for the life of the session; the socket is the session's liveness. */
import { connect } from "node:net"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs"
import { daemonPath, home, logPath, sockPath } from "./paths.js"
import { readLines, writeLine } from "./ndjson.js"

const DEFAULT_RETRY_MS = 2000
const REGISTER = "register"
const EVENT = "event"

export function connectDaemon({ meta, onEvent, log, retryMs = DEFAULT_RETRY_MS }) {
  let socket = null
  let timer = null
  let closed = false

  function open() {
    if (closed) return
    if (!existsSync(sockPath())) spawnDaemon()

    socket = connect(sockPath())
    socket.on("connect", () => {
      log("connected to daemon")
      writeLine(socket, { type: REGISTER, ...meta })
    })
    readLines(socket, (message) => message.type === EVENT && onEvent(message), (error) => log(`daemon: ${error.message}`))
    socket.on("error", (error) => log(`daemon: ${error.message}`))
    socket.on("close", () => {
      socket = null
      if (!closed) timer = setTimeout(open, retryMs)
    })
  }

  function close() {
    closed = true
    clearTimeout(timer)
    socket?.destroy()
  }

  open()

  return { close }
}

// Detached with its own stdio, so it outlives this process and Claude Code.
// Two MCP servers racing here both spawn; the loser sees the live socket and
// exits 0 (see daemon.js start()).
export function spawnDaemon() {
  mkdirSync(home(), { recursive: true })
  const logFile = openSync(logPath(), "a")
  const child = spawn(process.execPath, [daemonPath()], { detached: true, stdio: ["ignore", logFile, logFile], env: process.env })
  child.unref()
  closeSync(logFile)
}
