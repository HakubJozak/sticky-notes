/* Which Claude Code session gets the notes. The daemon lists them (already
   ordered by the engine for this app); the reviewer decides. One live session
   picks itself; "queue" is always an explicit choice. */
export const QUEUE = "queue"
export const QUEUE_LABEL = "queue for next review session"
export const PICK_LABEL = "pick a session…"

const CLASS = "sticky-notes-bar__picker"
const STORAGE_PREFIX = "sticky-notes:session:"
const SEPARATOR = " · "
const NONE = ""

export function createPicker({ doc, storage, key, onOpen }) {
  const el = doc.createElement("select")
  el.className = CLASS
  el.setAttribute("aria-label", PICK_LABEL)

  el.addEventListener("focus", onOpen)
  el.addEventListener("mousedown", onOpen)
  el.addEventListener("change", () => remember(identity(rows.find((session) => session.id === el.value)) ?? el.value))

  let rows = [] // the last list shown, to look the picked session up on change

  function refresh(sessions) {
    rows = sessions
    const chosen = choose(sessions)
    el.innerHTML = ""

    if (!chosen) el.append(option(NONE, PICK_LABEL, { disabled: true }))
    const folders = new Set(sessions.map((session) => session.cwd)) // one folder: the name is all that differs
    for (const session of sessions) el.append(option(session.id, folders.size > 1 ? session.label + SEPARATOR + session.cwd : session.label, { label: session.label }))
    el.append(option(QUEUE, QUEUE_LABEL))

    el.value = chosen ?? NONE
  }

  function choose(sessions) {
    if (sessions.length === 1) return sessions[0].id

    const remembered = recall()
    return sessions.find((session) => identity(session) === remembered)?.id ?? null
  }

  // The daemon id is per socket: a Claude Code restart (resume) reconnects the
  // MCP server under a new one, and a daemon restart reuses old ones for other
  // sessions. The Claude Code session id survives both.
  const identity = (session) => session?.claudeSession ?? session?.id

  function option(value, text, { disabled = false, label = text } = {}) {
    const node = doc.createElement("option")
    node.value = value
    node.textContent = text
    node.disabled = disabled
    node.dataset.label = label // the short name, for "sent to <label>"

    return node
  }

  function remember(id) {
    try {
      storage.setItem(STORAGE_PREFIX + key, id)
    } catch {
      // private mode: the choice lasts for this page view
    }
  }

  function recall() {
    try {
      return storage.getItem(STORAGE_PREFIX + key)
    } catch {
      return null
    }
  }

  return {
    el,
    refresh,
    get value() {
      return el.value
    },
    // "sent to <label>" reads better than a session id or the full option text
    get label() {
      return el.selectedOptions[0]?.dataset.label ?? ""
    },
  }
}
