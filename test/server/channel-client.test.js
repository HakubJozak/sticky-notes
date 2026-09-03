// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PassThrough } from "node:stream"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createChannel, detectChannel, ChannelError, saveToken, readToken, TOKEN_KEY } from "../../src/channel.js"
import { createHttpServer } from "../../server/http.js"
import { createSessions } from "../../server/sessions.js"
import { createShots } from "../../server/shots.js"

const TOKEN = "abc"
const META = { cwd: "/p", pid: 1, label: "p" }

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

describe("browser channel client", () => {
  let dir, server, base, sessions

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "chan-"))
    sessions = createSessions()
    server = createHttpServer({ token: TOKEN, sessions, shots: createShots(dir), onStop: () => {}, log: () => {} })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })

  it("lists sessions and sends notes with the bearer token", async () => {
    const socket = new PassThrough()
    const { id } = sessions.register(socket, META)
    const channel = createChannel({ base, token: TOKEN, fetch })

    expect(await channel.sessions()).toEqual([{ id, ...META, claudeSession: null, startedAt: expect.any(String) }])
    expect(await channel.send({ session: id, url: "u", key: "k", title: "t", notes: [] })).toEqual({ delivered: true })
    expect(JSON.parse(String(socket.read())).type).toBe("event")
  })

  it("throws a ChannelError carrying status and daemon message", async () => {
    const channel = createChannel({ base, token: TOKEN, fetch })

    await expect(channel.send({ session: "s9", url: "u", key: "k", title: "t", notes: [] })).rejects.toMatchObject({ status: 404, message: "unknown session" })
    await expect(createChannel({ base, token: "wrong", fetch }).sessions()).rejects.toBeInstanceOf(ChannelError)
  })

  it("detects the rails path first, then a stored token, else nothing", () => {
    const storage = fakeStorage()

    expect(detectChannel({ base: "/sticky-notes", storage, fetch })).not.toBeNull()
    expect(detectChannel({ base: undefined, storage, fetch })).toBeNull()

    saveToken(storage, TOKEN)
    expect(readToken(storage)).toBe(TOKEN)
    expect(storage.getItem(TOKEN_KEY)).toBe(TOKEN)
    expect(detectChannel({ base: undefined, storage, fetch })).not.toBeNull()
  })
})
