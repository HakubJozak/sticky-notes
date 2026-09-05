/* Public API. Owns the note records, wires storage, path extraction and the DOM
   layer together; every module below this one stays free of shared state. */
import { cssPath, contextOf, excerpt } from "./path.js"
import { createStore } from "./store.js"
import { toMarkdown, toJson, JSON_FORMAT } from "./exporter.js"
import { createLayer, OK, ERROR } from "./layer.js"
import { DEFAULT_BOX, initialOffset } from "./geometry.js"
import { createChannel, detectChannel, saveToken, DIRECT_BASE } from "./channel.js"
import { captureElement, toJpeg } from "./screenshot.js"

const DEFAULT_ANCHORS = ["data-testid", "data-test"]
const ID_RADIX = 36
const COPIED_MESSAGE = "copied"
const COPY_FAILED_MESSAGE = "select & copy"
const PENDING_PREFIX = "sticky-notes:pending:"
const AUTO_SHOT_KEY = "sticky-notes:auto-shot"
const AUTO_SHOT_OFF = "0"
const AUTO_SHOT_PADDING = 16 // px around the noted element
const SENT_MESSAGE = (label) => (label ? `sent to ${label}` : "sent")
const SENDING_MESSAGE = "sending…"
const QUEUED_MESSAGE = "queued for the next review session"
const PICK_SESSION_MESSAGE = "pick a session first"
const NO_DAEMON_MESSAGE = "no daemon"
const SEND_FAILED_MESSAGE = "send failed"
const LOST_MESSAGE = (n) => `${n} screenshots lost`
const MESSAGE_MS = 1500
const ERROR_MESSAGE_MS = 4000 // failures stay up long enough to read
const TOKEN_PROMPT = "sticky-notes daemon token (from ~/.cache/sticky-notes/daemon.json)"

export function createStickyNotes(options = {}) {
  const key = options.key ?? location.pathname
  const anchors = options.anchors ?? DEFAULT_ANCHORS
  const storage = options.storage ?? localStorage
  const store = createStore(storage, key)
  const fetchFn = options.fetch ?? globalThis.fetch?.bind(globalThis)
  const pending = new Map() // note id → [jpeg base64], until sent
  const engineChannel = typeof options.channel === "string" // the app proxies to its own machine's daemon
  const connectAllowed = options.connect !== false // false from the Rails adapters: not the browser's daemon

  let notes = []
  let layer = null
  let root = null
  let channel = resolveChannel(options.channel)
  let autoShot = readAutoShot()
  let sending = false

  function resolveChannel(given) {
    if (given && typeof given === "object") return given

    return detectChannel({ base: given, token: options.channelToken, storage, fetch: fetchFn })
  }

  const save = () => store.save(notes)

  const rerender = () => layer?.render(notes)

  function mount() {
    if (layer) unmount()

    root = options.root ?? document.body
    notes = store.load()
    layer = createLayer({
      root, key, storage,
      onPick, onChange: save, onRemove, onClear: clear, onExport: exportNotes,
      onSend: send, onShot: attachScreenshot, onAutoShot: setAutoShot, onConnect: () => connect(), onSessionsOpen: refreshSessions,
    })
    layer.mount()
    layer.setConnectAllowed(connectAllowed) // before setChannel, or Connect flashes into view
    layer.setChannel(!!channel)
    layer.setAutoShot(autoShot)
    reportLost()
    refreshSessions()
    rerender()

    return instance
  }

  function unmount() {
    layer?.unmount()
    layer = null
  }

  // The host swapped DOM (Turbo frame, morph, SPA re-render): re-anchor everything.
  const refresh = () => rerender()

  function toggle(on = !layer?.picking) {
    layer?.setPicking(!!on)
  }

  function onPick(el) {
    const note = {
      id: Date.now().toString(ID_RADIX),
      ...cssPath(el, { anchors }),
      text: excerpt(el),
      ctx: contextOf(el),
      note: "",
      created: new Date().toISOString(),
      ...DEFAULT_BOX,
      ...initialOffset(el),
    }

    notes.push(note)
    save()
    rerender()
    layer.focusNote(note.id)
    layer.setPicking(false)
  }

  function onRemove(note) {
    notes = notes.filter((candidate) => candidate !== note)
    save()
    prunePending()
    rerender()
  }

  function clear() {
    if (!notes.length) return

    // no confirm() to ask with (headless host) → refuse rather than lose notes
    const view = (root ?? document.body).ownerDocument.defaultView
    if (!view?.confirm?.(`Delete ${notes.length} notes?`)) return

    notes = []
    save()
    prunePending()
    rerender()
  }

  function exportNotes(format) {
    const doc = (root ?? document.body).ownerDocument
    const meta = { title: doc.title, url: doc.defaultView.location.href, key }
    const rows = notes.map(toRow)
    const text = format === JSON_FORMAT ? toJson(rows, meta) : toMarkdown(rows, meta)

    layer?.showExport(text)
    copy(doc.defaultView, text)

    return text
  }

  // Notes from the first prototype have no `anchored` key — treat them as anchored.
  const toRow = (note, index) => ({
    n: index + 1,
    path: note.path,
    anchored: note.anchored !== false,
    text: note.text,
    ctx: note.ctx || "",
    note: note.note,
    orphan: !!note.orphan,
  })

  function copy(view, text) {
    const clipboard = view.navigator?.clipboard
    if (!clipboard) return layer?.message(COPY_FAILED_MESSAGE)

    clipboard.writeText(text).then(
      () => layer?.message(COPIED_MESSAGE, MESSAGE_MS, OK),
      () => layer?.message(COPY_FAILED_MESSAGE, MESSAGE_MS, ERROR),
    )
  }

  // rect = { x, y, w, h } in page px; omit it for the interactive marquee. → Blob | null
  const screenshot = (rect) => layer?.screenshot(rect) ?? Promise.resolve(null)

  // Screenshots live in memory only; a reload drops them, so say how many went.
  function reportLost() {
    const lost = Number(read(PENDING_PREFIX + key)) || 0
    write(PENDING_PREFIX + key, "0")
    if (lost) layer.message(LOST_MESSAGE(lost), ERROR_MESSAGE_MS, ERROR)
  }

  // The engine renders its channel unconditionally; this is where the page
  // finds out whether a daemon is behind it, and says so.
  async function refreshSessions() {
    if (!channel) return

    try {
      const sessions = await channel.sessions()
      layer?.refreshSessions(sessions) // the host may have unmounted us meanwhile
      if (engineChannel) layer?.setChannel(true) // a daemon came back: Send returns
    } catch (error) {
      // the bar message and the hidden controls are the report; every caller
      // (mount, picker focus, connect) drops the promise, so a rethrow here
      // could only ever surface as an unhandled rejection
      layer?.message(`${NO_DAEMON_MESSAGE}: ${error.message}`, ERROR_MESSAGE_MS, ERROR)
      if (!engineChannel) return // file:// page: Connect is still the way back

      layer?.setConnectAllowed(false) // before setChannel, or Connect flashes into view
      layer?.setChannel(false)
    }
  }

  function attachScreenshot(id, jpeg) {
    if (!channel || !notes.some((note) => note.id === id)) return // a cleared note takes its shots with it

    pending.set(id, [...(pending.get(id) ?? []), jpeg])
    countPending()
  }

  function prunePending() {
    for (const id of pending.keys()) {
      if (!notes.some((note) => note.id === id)) pending.delete(id)
    }

    countPending()
  }

  function countPending() {
    const count = [...pending.values()].reduce((sum, shots) => sum + shots.length, 0)
    write(PENDING_PREFIX + key, String(count))
    layer?.setShots(count)
  }

  async function send() {
    if (!channel || !layer) return null

    // A second Send while the first is in flight would capture and post the
    // same notes twice — the daemon has no idea they are the same batch.
    if (sending) {
      layer.message(SENDING_MESSAGE)
      return null
    }

    const session = layer.session()
    if (!session) {
      layer.message(PICK_SESSION_MESSAGE)
      return null
    }

    // capture and payload building are inside the try: a failed auto-shot must
    // reach the reviewer as "send failed", not as a silent rejected promise
    sending = true

    try {
      const doc = (root ?? document.body).ownerDocument
      const rows = notes.map((note, index) => ({ ...toRow(note, index), shots: pending.get(note.id) ?? [] }))

      if (autoShot) await autoShots(doc, rows) // capturing every noted element takes seconds

      layer.setSending({})
      const payload = { session, url: doc.defaultView.location.href, key, title: doc.title, notes: rows }
      const result = await channel.send(payload)
      pending.clear()
      countPending()
      layer?.message(result.queued ? QUEUED_MESSAGE : SENT_MESSAGE(layer.sessionLabel()), MESSAGE_MS, OK)

      return result
    } catch (error) {
      layer?.message(`${SEND_FAILED_MESSAGE}: ${error.message}`, ERROR_MESSAGE_MS, ERROR)
      throw error
    } finally {
      sending = false
      layer?.setSending(null)
    }
  }

  // Every noted element without a manual screenshot gets one, so Claude sees
  // what the note points at. Progress goes to the Send button: n of total.
  async function autoShots(doc, rows) {
    // snapshot: capturing awaits, and a note pinned meanwhile has no row here
    const todo = notes.slice().map((note, index) => [index, layer?.elementOf(note.id)]).filter(([index, el]) => el && rows[index] && !rows[index].shots.length)

    for (const [done, [index, el]] of todo.entries()) {
      layer.setSending({ done, total: todo.length })
      rows[index].shots = [await toJpeg(await captureElement(doc, el, AUTO_SHOT_PADDING))]
    }
  }

  function setAutoShot(on) {
    autoShot = on
    write(AUTO_SHOT_KEY, on ? "" : AUTO_SHOT_OFF)
    layer?.setAutoShot(on)
  }

  // function declaration on purpose: `let autoShot = readAutoShot()` runs before this line
  function readAutoShot() {
    return read(AUTO_SHOT_KEY) !== AUTO_SHOT_OFF
  }

  function connect(token = promptToken()) {
    if (!token) return

    saveToken(storage, token)
    channel = createChannel({ base: DIRECT_BASE, token, fetch: fetchFn })
    layer?.setChannel(true)
    refreshSessions()
  }

  const promptToken = () => (root ?? document.body).ownerDocument.defaultView.prompt?.(TOKEN_PROMPT)

  function read(name) {
    try {
      return storage.getItem(name)
    } catch {
      return null
    }
  }

  function write(name, value) {
    try {
      storage.setItem(name, value)
    } catch {
      // private mode: state lasts for this page view
    }
  }

  const instance = {
    mount,
    unmount,
    refresh,
    toggle,
    screenshot,
    export: exportNotes,
    clear,
    send,
    attachScreenshot,
    setAutoShot,
    connect,
    get notes() {
      return notes.slice()
    },
    get channel() {
      return channel
    },
  }

  return instance
}

let singleton = null

// Convenience for pages that only ever want one layer (bookmarklet, artifacts).
export function mount(options = {}) {
  singleton?.unmount()
  singleton = createStickyNotes(options)
  singleton.mount()

  return singleton
}

export default { createStickyNotes, mount }
