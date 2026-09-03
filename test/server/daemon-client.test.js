// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { start } from "../../server/daemon.js"
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

describe("connectDaemon", () => {
  let home, previousHome, previousPort

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sn-"))
    previousHome = process.env.STICKY_NOTES_HOME
    previousPort = process.env.STICKY_NOTES_PORT
    process.env.STICKY_NOTES_HOME = home
    process.env.STICKY_NOTES_PORT = "0"
  })

  afterEach(() => {
    process.env.STICKY_NOTES_HOME = previousHome
    process.env.STICKY_NOTES_PORT = previousPort
    rmSync(home, { recursive: true, force: true })
  })

  it("registers, receives events, and re-registers after the daemon restarts", async () => {
    let daemon = await start()
    const events = []
    const client = connectDaemon({ meta: META, onEvent: (event) => events.push(event), log: () => {}, retryMs: RETRY_MS })

    await until(async () => (await api(daemon.info, "/sessions")).length === 1)
    expect((await api(daemon.info, "/sessions"))[0]).toMatchObject(META)

    await api(daemon.info, "/notes", "POST", { session: "s1", url: "u", key: "k", title: "t", notes: [] })
    await until(() => events.length === 1)
    expect(events[0].content).toContain("# Notes on t")

    daemon.stopServers() // close listeners without exiting the test process
    daemon = await start()
    await until(async () => (await api(daemon.info, "/sessions")).length === 1)

    client.close()
    daemon.stopServers()
  })

  it("spawns a detached daemon when the socket is missing", async () => {
    spawnDaemon()
    await until(() => existsSync(join(home, "daemon.json")))
    const info = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8"))

    expect(info.pid).not.toBe(process.pid)
    await fetch(`http://127.0.0.1:${info.port}/stop`, { method: "POST", headers: { authorization: `Bearer ${info.token}` } })
    await until(() => !existsSync(join(home, "daemon.json")))
  })
})
