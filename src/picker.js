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
  el.addEventListener("change", () => remember(el.value))

  function refresh(sessions) {
    const chosen = choose(sessions)
    el.innerHTML = ""

    if (!chosen) el.append(option(NONE, PICK_LABEL, { disabled: true }))
    for (const session of sessions) el.append(option(session.id, session.label + SEPARATOR + session.cwd))
    el.append(option(QUEUE, QUEUE_LABEL))

    el.value = chosen ?? NONE
  }

  function choose(sessions) {
    if (sessions.length === 1) return sessions[0].id

    const remembered = recall()
    return sessions.some((session) => session.id === remembered) ? remembered : null
  }

  function option(value, text, { disabled = false } = {}) {
    const node = doc.createElement("option")
    node.value = value
    node.textContent = text
    node.disabled = disabled

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
  }
}
