// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PassThrough } from "node:stream"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHttpServer } from "../../server/http.js"
import { createSessions } from "../../server/sessions.js"
import { createShots } from "../../server/shots.js"

const TOKEN = "t0ken"
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")
const META = { cwd: "/home/dev/projects/krouzitko", pid: 1, label: "krouzitko" }
const note = (shots = []) => ({ n: 1, path: "#a", text: "A", ctx: "", note: "fix", shots })

describe("daemon http api", () => {
  let dir, server, base, sessions, stopped

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-"))
    sessions = createSessions()
    stopped = false
    server = createHttpServer({ token: TOKEN, sessions, shots: createShots(dir), onStop: () => (stopped = true), log: () => {} })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })

  const call = (path, { method = "GET", body, token = TOKEN } = {}) =>
    fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body && JSON.stringify(body),
    })

  it("answers preflight without a token", async () => {
    const response = await fetch(base + "/notes", { method: "OPTIONS" })

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("access-control-allow-headers")).toMatch(/authorization/i)
  })

  it("rejects a wrong token", async () => {
    expect((await call("/sessions", { token: "nope" })).status).toBe(401)
  })

  it("lists sessions", async () => {
    const { id } = sessions.register(new PassThrough(), META)
    const response = await call("/sessions")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id, ...META, claudeSession: null, startedAt: expect.any(String) }])
  })

  it("stores screenshots, builds the event and delivers it", async () => {
    const socket = new PassThrough()
    const { id } = sessions.register(socket, META)

    const response = await call("/notes", { method: "POST", body: { session: id, url: "http://x/kids/1", key: "/kids/1", title: "Kid", notes: [note([JPEG])] } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ delivered: true })
    const event = JSON.parse(String(socket.read()).trim())
    expect(event.content).toContain(`screenshot: ${join(dir, id, "kids-1-1.jpg")}`)
    expect(event.meta).toEqual({ url: "http://x/kids/1", key: "/kids/1", count: "1" })
  })

  it("queues when asked to", async () => {
    const response = await call("/notes", { method: "POST", body: { session: "queue", url: "u", key: "k", title: "t", notes: [note()] } })

    expect(await response.json()).toEqual({ queued: true })
    expect(sessions.queued).toBe(1)
  })

  it("is 404 for an unknown session and stores nothing", async () => {
    const response = await call("/notes", { method: "POST", body: { session: "s99", url: "u", key: "k", title: "t", notes: [note([JPEG])] } })

    expect(response.status).toBe(404)
    expect(existsSync(join(dir, "s99"))).toBe(false)
  })

  it("forwards screenshot validation as 415", async () => {
    const { id } = sessions.register(new PassThrough(), META)
    const png = Buffer.from([0x89, 0x50]).toString("base64")
    const response = await call("/notes", { method: "POST", body: { session: id, url: "u", key: "k", title: "t", notes: [note([png])] } })

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: "not a JPEG" })
  })

  it("is 400 for a body that is not json", async () => {
    const response = await fetch(base + "/notes", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{" })

    expect(response.status).toBe(400)
  })

  it("stops on request", async () => {
    expect((await call("/stop", { method: "POST" })).status).toBe(200)
    expect(stopped).toBe(true)
  })
})
