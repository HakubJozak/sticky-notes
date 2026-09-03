// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PassThrough } from "node:stream"
import { createSessions, QUEUE } from "../../server/sessions.js"

const META = { cwd: "/home/dev/projects/krouzitko", pid: 4242, label: "krouzitko" }
const EVENT = { content: "# Notes", meta: { count: "1" } }

const socket = () => new PassThrough()
const lastLine = (stream) => JSON.parse(String(stream.read()).trim().split("\n").pop())

describe("createSessions", () => {
  it("registers a session and lists it without the socket", () => {
    const sessions = createSessions()
    const session = sessions.register(socket(), META)

    expect(session.id).toMatch(/^s[a-z0-9]+$/)
    expect(sessions.list()).toEqual([{ id: session.id, ...META, claudeSession: null, startedAt: expect.any(String) }])
    expect(sessions.has(session.id)).toBe(true)
  })

  it("forgets a session when its socket closes", () => {
    const sessions = createSessions()
    const stream = socket()
    const { id } = sessions.register(stream, META)

    stream.emit("close")

    expect(sessions.has(id)).toBe(false)
    expect(sessions.list()).toEqual([])
  })

  it("delivers an event as one ndjson line on the session socket", () => {
    const sessions = createSessions()
    const stream = socket()
    const { id } = sessions.register(stream, META)

    expect(sessions.deliver(id, EVENT)).toEqual({ delivered: true })
    expect(lastLine(stream)).toEqual({ type: "event", ...EVENT })
  })

  it("returns null for an unknown session", () => {
    expect(createSessions().deliver("s9", EVENT)).toBeNull()
  })

  it("queues events and flushes them to the next session that registers", () => {
    const sessions = createSessions()

    expect(sessions.deliver(QUEUE, EVENT)).toEqual({ queued: true })
    expect(sessions.queued).toBe(1)

    const stream = socket()
    sessions.register(stream, META)

    expect(sessions.queued).toBe(0)
    expect(lastLine(stream)).toEqual({ type: "event", ...EVENT })
  })
})
