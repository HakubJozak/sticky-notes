#!/usr/bin/env node
/* The sticky-notes daemon: one per machine.

     page ──POST /notes──▶ Rails engine ──▶ 127.0.0.1:47391 (this) ──daemon.sock──▶ MCP server ──▶ Claude Code

   Holds the live session table, stores screenshots, buffers "queue" sends.
   Spawned detached by the first MCP server that finds no socket; stays until
   `sticky-notes-daemon stop`, POST /stop or a signal. */
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs"
import { connect } from "node:net"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { infoPath, sockPath, shotsDir, port } from "./paths.js"
import { createSessions } from "./sessions.js"
import { createShots } from "./shots.js"
import { createHttpServer } from "./http.js"
import { createSocketServer } from "./socket.js"

const LOOPBACK = "127.0.0.1"
const TOKEN_BYTES = 24
const OWNER_ONLY = 0o600
const STOP_COMMAND = "stop"
const STOP_PATH = "/stop"
const EXIT_OK = 0
const EXIT_FAILURE = 1
const EXIT_GRACE_MS = 50
const EADDRINUSE = "EADDRINUSE"

const log = (line) => console.log(`${new Date().toISOString()} ${line}`)

export async function start() {
  mkdirSync(shotsDir(), { recursive: true })
  if (await socketAlive()) return null

  if (existsSync(sockPath())) unlinkSync(sockPath()) // stale: nobody answered

  const sessions = createSessions()
  const shots = createShots(shotsDir())
  const token = randomBytes(TOKEN_BYTES).toString("hex")
  const socketServer = createSocketServer({ sessions, log })
  const httpServer = createHttpServer({ token, sessions, shots, onStop: () => setImmediate(stop), log })

  try {
    await listen(socketServer, sockPath())
  } catch (error) {
    if (error.code !== EADDRINUSE) throw error
    if (await socketAlive()) return null // lost the bind race: a peer got there first
    throw error
  }
  await listen(httpServer, port(), LOOPBACK)

  const info = { port: httpServer.address().port, token, pid: process.pid, startedAt: new Date().toISOString() }
  writeFileSync(infoPath(), JSON.stringify(info), { mode: OWNER_ONLY })
  log(`listening on ${LOOPBACK}:${info.port} and ${sockPath()}`)

  // Tests run the daemon in-process: process.exit() isn't there to make the OS
  // hang up on peers, so do it ourselves — a stopped daemon has no sessions.
  function stopServers() {
    httpServer.close()
    socketServer.close()
    sessions.closeAll()
    for (const file of [infoPath(), sockPath()]) if (existsSync(file)) unlinkSync(file)
  }

  function stop() {
    log("stopping")
    stopServers()
    setTimeout(() => process.exit(EXIT_OK), EXIT_GRACE_MS) // let the /stop reply flush first
  }

  return { info, stop, stopServers }
}

// A socket file with a listener behind it means a daemon is already running.
function socketAlive() {
  if (!existsSync(sockPath())) return Promise.resolve(false)

  return new Promise((resolve) => {
    const probe = connect(sockPath())
    probe.on("connect", () => {
      probe.destroy()
      resolve(true)
    })
    probe.on("error", () => resolve(false))
  })
}

const listen = (server, ...args) =>
  new Promise((resolve, reject) => {
    server.on("error", reject)
    server.listen(...args, resolve)
  })

async function requestStop() {
  if (!existsSync(infoPath())) return log("no daemon.json — not running")

  const { port: daemonPort, token } = JSON.parse(readFileSync(infoPath(), "utf8"))
  const response = await fetch(`http://${LOOPBACK}:${daemonPort}${STOP_PATH}`, { method: "POST", headers: { authorization: `Bearer ${token}` } })
  log(`stop → ${response.status}`)
}

async function main() {
  if (process.argv[2] === STOP_COMMAND) return requestStop()

  const daemon = await start()
  if (!daemon) return log("already running")

  process.on("SIGTERM", daemon.stop)
  process.on("SIGINT", daemon.stop)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log(error.stack)
    process.exit(EXIT_FAILURE)
  })
}
