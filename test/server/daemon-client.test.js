// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { start } from "../../server/daemon.js"
import { sockPath } from "../../server/paths.js"
import { connectDaemon, spawnDaemon } from "../../server/daemon-client.js"

const POLL_MS = 50
const TIMEOUT_MS = 5000
const RETRY_MS = 100
const META = { cwd: "/home/dev/projects/krouzitko", pid: 99, label: "krouzitko" }

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out")
    await wait(POLL_MS)
  }
}

const api = (info, path, method = "GET", body) =>
  fetch(`http://127.0.0.1:${info.port}${path}`, { method, headers: { authorization: `Bearer ${info.token}` }, body: body && JSON.stringify(body) }).then((r) => r.json())

const infoFile = (homeDir) => join(homeDir, "daemon.json")
const readInfo = (homeDir) => JSON.parse(readFileSync(infoFile(homeDir), "utf8"))

// Safety net for every test below: a real (detached) daemon can end up spawned
// on a failure path (assertion throws, timeout) before the test's own cleanup
// runs. Stop it here too so a failing test never leaks a background process.
async function stopIfRunning(homeDir) {
  if (!existsSync(infoFile(homeDir))) return
  try {
    const info = readInfo(homeDir)
    await fetch(`http://127.0.0.1:${info.port}/stop`, { method: "POST", headers: { authorization: `Bearer ${info.token}` } })
  } catch {
    // best-effort: the test already failed for its own reason, don't mask it
  }
}

const restoreEnv = (key, previous) => (previous === undefined ? delete process.env[key] : (process.env[key] = previous))

describe("connectDaemon", () => {
  let home, previousHome, previousPort

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sn-"))
    previousHome = process.env.STICKY_NOTES_HOME
    previousPort = process.env.STICKY_NOTES_PORT
    process.env.STICKY_NOTES_HOME = home
    process.env.STICKY_NOTES_PORT = "0"
  })

  afterEach(async () => {
    await stopIfRunning(home)
    restoreEnv("STICKY_NOTES_HOME", previousHome)
    restoreEnv("STICKY_NOTES_PORT", previousPort)
    rmSync(home, { recursive: true, force: true })
  })

  it("registers, receives events, and re-registers after the daemon restarts", async () => {
    let daemon = await start()
    let client

    try {
      const events = []
      client = connectDaemon({ meta: META, onEvent: (event) => events.push(event), log: () => {}, retryMs: RETRY_MS })

      await until(async () => (await api(daemon.info, "/sessions")).length === 1)
      expect((await api(daemon.info, "/sessions"))[0]).toMatchObject(META)

      await api(daemon.info, "/notes", "POST", { session: "s1", url: "u", key: "k", title: "t", notes: [] })
      await until(() => events.length === 1)
      expect(events[0].content).toContain("# Notes on t")

      daemon.stopServers() // close listeners without exiting the test process
      daemon = await start() // same tick: must rebind before the client's 100ms retry timer can fire and spawn a real daemon
      expect(daemon, "start() lost the bind race — a spawned daemon already owns the socket").not.toBeNull()

      await until(async () => (await api(daemon.info, "/sessions")).length === 1)
    } finally {
      client?.close()
      daemon?.stopServers()
    }
  })

  it("spawns a detached daemon when the socket is missing", async () => {
    spawnDaemon()

    try {
      await until(() => existsSync(infoFile(home)))
      const info = readInfo(home)

      expect(info.pid).not.toBe(process.pid)
      await fetch(`http://127.0.0.1:${info.port}/stop`, { method: "POST", headers: { authorization: `Bearer ${info.token}` } })
      await until(() => !existsSync(infoFile(home)))
    } finally {
      await stopIfRunning(home)
    }
  })

  it("spawns a daemon when the socket file is stale", async () => {
    writeFileSync(sockPath(), "") // simulates a crash: the file survives, nothing listens behind it
    let client

    try {
      client = connectDaemon({ meta: META, onEvent: () => {}, log: () => {}, retryMs: RETRY_MS })

      await until(() => existsSync(infoFile(home)))
      await until(async () => (await api(readInfo(home), "/sessions")).length === 1)
    } finally {
      client?.close()
      await stopIfRunning(home)
    }
  })
})
