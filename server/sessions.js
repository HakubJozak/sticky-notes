/* The session table is the set of open MCP-server sockets: a session that
   exits drops its socket and disappears. Events for "queue" wait here for the
   next session to register. */
import { writeLine } from "./ndjson.js"

export const QUEUE = "queue"
const ID_RADIX = 36
const ID_PREFIX = "s"

export function createSessions() {
  const live = new Map() // id → { id, cwd, pid, label, startedAt, socket }
  const queued = []
  let counter = 0

  function register(socket, { cwd, pid, label, claudeSession = null }) {
    const id = ID_PREFIX + (++counter).toString(ID_RADIX)
    const session = { id, cwd, pid, label, claudeSession, startedAt: new Date().toISOString(), socket }
    live.set(id, session)
    socket.on("close", () => live.delete(id))

    for (const event of queued.splice(0)) push(session, event)

    return session
  }

  const list = () => [...live.values()].map(({ socket, ...row }) => row) // eslint-disable-line no-unused-vars

  const has = (id) => live.has(id)

  function deliver(id, event) {
    if (id === QUEUE) {
      queued.push(event)
      return { queued: true }
    }

    const session = live.get(id)
    if (!session) return null

    push(session, event)
    return { delivered: true }
  }

  return {
    register,
    list,
    has,
    deliver,
    get queued() {
      return queued.length
    },
  }
}

const push = (session, event) => writeLine(session.socket, { type: "event", ...event })
