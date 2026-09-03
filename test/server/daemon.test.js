// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawn } from "node:child_process"
import { connect } from "node:net"
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { daemonPath } from "../../server/paths.js"
import { readLines, writeLine } from "../../server/ndjson.js"

const STARTUP_MS = 5000
const POLL_MS = 50
const MODE_MASK = 0o777
const OWNER_ONLY = 0o600

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check, timeout = STARTUP_MS) {
  const deadline = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out")
    await wait(POLL_MS)
  }
}

describe("daemon process", () => {
  let home, child

  beforeEach(() => (home = mkdtempSync(join(tmpdir(), "sn-"))))
  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM")
      await new Promise((resolve) => child.on("exit", resolve))
    }
    rmSync(home, { recursive: true, force: true })
  })

  const env = () => ({ ...process.env, STICKY_NOTES_HOME: home, STICKY_NOTES_PORT: "0" })
  const infoFile = () => join(home, "daemon.json")
  const readInfo = () => JSON.parse(readFileSync(infoFile(), "utf8"))
  const startChild = () => (child = spawn(process.execPath, [daemonPath()], { env: env(), stdio: "ignore" }))

  const api = (info, path, method = "GET", body) =>
    fetch(`http://127.0.0.1:${info.port}${path}`, { method, headers: { authorization: `Bearer ${info.token}` }, body: body && JSON.stringify(body) })

  it("writes daemon.json (0600) after listening and serves the socket", async () => {
    startChild()
    await until(() => existsSync(infoFile()))
    const info = readInfo()

    expect(info).toEqual({ port: expect.any(Number), token: expect.stringMatching(/^[0-9a-f]{48}$/), pid: child.pid, startedAt: expect.any(String) })
    expect(statSync(infoFile()).mode & MODE_MASK).toBe(OWNER_ONLY)

    const socket = connect(join(home, "daemon.sock"))
    await new Promise((resolve) => socket.on("connect", resolve))
    writeLine(socket, { type: "register", cwd: "/x", pid: 7, label: "x" })
    const sessions = async () => (await api(info, "/sessions")).json()
    await until(async () => (await sessions()).length === 1)

    expect(await sessions()).toEqual([{ id: "s1", cwd: "/x", pid: 7, label: "x", claudeSession: null, startedAt: expect.any(String) }])

    const events = []
    readLines(socket, (msg) => events.push(msg), () => {})
    await api(info, "/notes", "POST", { session: "s1", url: "u", key: "k", title: "t", notes: [] })
    await until(() => events.length === 1)

    expect(events[0].type).toBe("event")
    socket.destroy()
  })

  it("stops on POST /stop and cleans up its files", async () => {
    startChild()
    await until(() => existsSync(infoFile()))
    const info = readInfo()

    expect((await api(info, "/stop", "POST")).status).toBe(200)
    await new Promise((resolve) => child.on("exit", resolve))

    expect(existsSync(infoFile())).toBe(false)
    expect(existsSync(join(home, "daemon.sock"))).toBe(false)
  })

  it("`stop` subcommand stops a running daemon", async () => {
    startChild()
    await until(() => existsSync(infoFile()))

    const stopper = spawn(process.execPath, [daemonPath(), "stop"], { env: env(), stdio: "ignore" })
    await new Promise((resolve) => stopper.on("exit", resolve))
    await new Promise((resolve) => child.on("exit", resolve))

    expect(stopper.exitCode).toBe(0)
    expect(existsSync(infoFile())).toBe(false)
  })

  it("exits 0 when another daemon already owns the socket", async () => {
    startChild()
    await until(() => existsSync(infoFile()))

    const second = spawn(process.execPath, [daemonPath()], { env: env(), stdio: "ignore" })
    await new Promise((resolve) => second.on("exit", resolve))

    expect(second.exitCode).toBe(0)
    expect(existsSync(infoFile())).toBe(true)
  })
})
