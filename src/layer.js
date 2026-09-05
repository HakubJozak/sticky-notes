/* Everything that touches the DOM: bar, export pane, leader overlay, note boxes
   and badges, plus picking, dragging and resizing. The note records live in
   index.js — this module renders them and reports interactions back. */
import css from "./style.css?inline"
import { LAYER_SELECTOR } from "./path.js"
import { MARKDOWN, JSON_FORMAT } from "./exporter.js"
import { DEFAULT_BOX, placeNote, placeBadge, leaderEnds } from "./geometry.js"
import { selectRect, captureRect, toPng, toJpeg, screenshotFileName, download, copyImage } from "./screenshot.js"
import { createPicker } from "./picker.js"

const STYLE_ID = "sticky-notes-style"
const SVG_NS = "http://www.w3.org/2000/svg"
const MESSAGE_MS = 1500
const ESCAPE_KEY = "Escape"
const BAR_STATE_KEY = "sticky-notes:bar" // per browser, not per page: the reviewer opened the toolbar
const BAR_OPEN = "open"
const BAR_CLOSED = "closed"

// toast kinds — the colour says how it went before the text is read
export const INFO = "info"
export const OK = "ok"
export const ERROR = "error"

const PICKING_CLASS = "sticky-notes-picking"
const HOVER_CLASS = "sticky-notes-hover"
const ANCHOR_CLASS = "sticky-notes-anchor"
const NOTE_CLASS = "sticky-note"
const BADGE_CLASS = "sticky-note-badge"
const DRAGGING_CLASS = "sticky-note--dragging"

const TOGGLE_COMMAND = "toggle"
const SCREENSHOT_COMMAND = "screenshot"
const DOWNLOAD_COMMAND = "download"
const EXPORT_MARKDOWN_COMMAND = "export-markdown"
const EXPORT_JSON_COMMAND = "export-json"
const CLEAR_COMMAND = "clear"
const COLLAPSE_COMMAND = "collapse"
const REMOVE_COMMAND = "remove"
const SEND_COMMAND = "send"
const AUTO_SHOT_COMMAND = "auto-shot"
const CONNECT_COMMAND = "connect"
const PIN_COMMAND = "pin"

const TOGGLE_LABEL = "✎ Notes"
const SCREENSHOT_LABEL = "▭ Screenshot"
const DOWNLOAD_LABEL = "Download"
const SCREENSHOT_HINT = "drag a rectangle · Esc cancels"
const RENDERING_MESSAGE = "rendering…"
const SCREENSHOT_FAILED_MESSAGE = "screenshot failed"
const COPIED_MESSAGE = "copied"
const NOT_COPIED_MESSAGE = "captured (clipboard blocked)"
const MARKDOWN_LABEL = "Copy Markdown"
const JSON_LABEL = "Copy JSON"
const CLEAR_LABEL = "Clear"
const COLLAPSE_LABEL = "collapse"
const REMOVE_LABEL = "remove note"
const DRAG_HINT = "drag to move"
const NOTE_PLACEHOLDER = "note…"
const SEND_LABEL = "Send"
const PIN_LABEL = "sticky notes"
const CAPTURING_LABEL = (done, total) => `capturing ${done}/${total}`
const SENDING_LABEL = "sending…"
const AUTO_SHOT_LABEL = "auto-shot"
const CONNECT_LABEL = "Connect"
const ATTACHED_MESSAGE = (n) => `attached to #${n}`
const SHOTS_LABEL = (n) => (n ? `${n} shot${n === 1 ? "" : "s"}` : "")
const SEND_ATTRIBUTE = "data-send"
const CONNECT_ATTRIBUTE = "data-connect"
const BUSY_CLASS = "sticky-notes-bar__button--busy"

// A pushpin: the one thing left on the page while the toolbar is folded away.
const PIN_ICON = `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9.5 1.5 14.5 6.5l-1.4 1.4-.7-.7L9.6 10l.2 2.8L8.4 14.2 5.7 11.5 2 15.2l-1.2-1.2 3.7-3.7L1.8 7.6l1.4-1.4 2.8.2 2.8-2.8-.7-.7z"/></svg>`

const LEADER_COLOR = "#c9a227"
const LEADER_WIDTH = 1.5
const LEADER_DASH = "2 4"
const ANCHOR_DOT_RADIUS = 2.5

export function createLayer({ root, key, storage, onPick, onChange, onRemove, onClear, onExport, onSend, onShot, onAutoShot, onConnect, onSessionsOpen }) {
  const doc = root.ownerDocument
  const view = doc.defaultView
  const live = new Map() // note id → { el, box, badge, observer }

  let notes = []
  let controller = null
  let bar = null
  let pin = null
  let pinCountEl = null
  let toast = null
  let sendButton = null
  let toggleButton = null
  let countEl = null
  let exportPane = null
  let leaders = null
  let picking = false
  let hovered = null
  let messageTimer = 0
  let screenshotCount = 0
  let lastScreenshot = null // { blob, name } — Download saves it
  let downloadButton = null
  let picker = null
  let shotsEl = null
  let autoShotInput = null
  let lastFocusedId = null // the note a fresh screenshot belongs to
  let channelOn = false // no channel → screenshots go to the clipboard, as before
  let connectAllowed = true // false on engine pages: their daemon is not the browser's

  function mount() {
    injectStyle()
    buildChrome()
    listen()
  }

  function unmount() {
    setPicking(false)
    controller.abort()
    clearNodes()
    view.clearTimeout(messageTimer)
    for (const node of [pin, bar, toast, exportPane, leaders]) node.remove()
    unhover()
    doc.getElementById(STYLE_ID)?.remove()
  }

  function injectStyle() {
    if (doc.getElementById(STYLE_ID)) return

    const style = doc.createElement("style")
    style.id = STYLE_ID
    style.textContent = css
    doc.head.appendChild(style)
  }

  function buildChrome() {
    pin = doc.createElement("button")
    pin.className = "sticky-notes-pin"
    pin.type = "button"
    pin.dataset.command = PIN_COMMAND
    pin.title = PIN_LABEL
    pin.setAttribute("aria-label", PIN_LABEL)
    pin.innerHTML = `${PIN_ICON}<span class="sticky-notes-pin__count" hidden></span>`
    pinCountEl = pin.querySelector(".sticky-notes-pin__count")

    toast = doc.createElement("div")
    toast.className = "sticky-notes-toast"
    toast.hidden = true
    toast.setAttribute("role", "status")

    bar = doc.createElement("div")
    bar.className = "sticky-notes-bar"
    bar.hidden = readItem(BAR_STATE_KEY) !== BAR_OPEN // folded away until the reviewer wants it
    bar.innerHTML = `
      <button class="sticky-notes-bar__button" type="button" data-command="${TOGGLE_COMMAND}" aria-pressed="false">${TOGGLE_LABEL}</button>
      <span class="sticky-notes-bar__count">0</span>
      <button class="sticky-notes-bar__button" type="button" data-command="${SCREENSHOT_COMMAND}">${SCREENSHOT_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${DOWNLOAD_COMMAND}" disabled>${DOWNLOAD_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${SEND_COMMAND}" ${SEND_ATTRIBUTE} hidden>${SEND_LABEL}</button>
      <label class="sticky-notes-bar__auto" ${SEND_ATTRIBUTE} hidden><input type="checkbox" data-command="${AUTO_SHOT_COMMAND}"> ${AUTO_SHOT_LABEL}</label>
      <span class="sticky-notes-bar__shots" ${SEND_ATTRIBUTE} hidden></span>
      <button class="sticky-notes-bar__button" type="button" data-command="${CONNECT_COMMAND}" ${CONNECT_ATTRIBUTE}>${CONNECT_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${EXPORT_MARKDOWN_COMMAND}">${MARKDOWN_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${EXPORT_JSON_COMMAND}">${JSON_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${CLEAR_COMMAND}">${CLEAR_LABEL}</button>`
    picker = createPicker({ doc, storage, key, onOpen: onSessionsOpen })
    picker.el.setAttribute(SEND_ATTRIBUTE, "")
    picker.el.hidden = true
    bar.querySelector(`[data-command="${SEND_COMMAND}"]`).before(picker.el)
    shotsEl = bar.querySelector(".sticky-notes-bar__shots")
    autoShotInput = bar.querySelector(`[data-command="${AUTO_SHOT_COMMAND}"]`)
    toggleButton = bar.querySelector(`[data-command="${TOGGLE_COMMAND}"]`)
    downloadButton = bar.querySelector(`[data-command="${DOWNLOAD_COMMAND}"]`)
    countEl = bar.querySelector(".sticky-notes-bar__count")
    sendButton = bar.querySelector(`[data-command="${SEND_COMMAND}"]`)

    exportPane = doc.createElement("pre")
    exportPane.className = "sticky-notes-export"
    exportPane.hidden = true

    leaders = doc.createElementNS(SVG_NS, "svg")
    leaders.setAttribute("class", "sticky-notes-leaders")

    // data-turbo-temporary: keep our DOM out of Turbo's snapshot cache
    for (const node of [pin, bar, toast, exportPane, leaders]) {
      node.setAttribute("data-turbo-temporary", "")
      root.appendChild(node)
    }

    bar.addEventListener("click", onBarClick)
    pin.addEventListener("click", () => setOpen(bar.hidden))
    updatePin()
  }

  // Folding the bar ends picking too: the pressed ✎ would be out of sight.
  function setOpen(open) {
    bar.hidden = !open
    pin.setAttribute("aria-expanded", String(open))
    writeItem(BAR_STATE_KEY, open ? BAR_OPEN : BAR_CLOSED)
    if (!open) setPicking(false)
  }

  function updatePin() {
    pinCountEl.textContent = notes.length
    pinCountEl.hidden = !notes.length
  }

  function onBarClick(event) {
    const command = event.target.closest("[data-command]")?.dataset.command
    if (!command) return

    if (command === TOGGLE_COMMAND) setPicking(!picking)
    if (command === SCREENSHOT_COMMAND) screenshot()
    if (command === DOWNLOAD_COMMAND) downloadLast()
    if (command === EXPORT_MARKDOWN_COMMAND) onExport(MARKDOWN)
    if (command === EXPORT_JSON_COMMAND) onExport(JSON_FORMAT)
    if (command === CLEAR_COMMAND) onClear()
    if (command === SEND_COMMAND) onSend()
    if (command === AUTO_SHOT_COMMAND) onAutoShot(event.target.checked)
    if (command === CONNECT_COMMAND) onConnect()
  }

  function listen() {
    controller = new AbortController()
    const signal = controller.signal

    doc.addEventListener("keydown", (event) => event.key === ESCAPE_KEY && setPicking(false), { signal })
    doc.addEventListener("mouseover", onMouseOver, { signal })
    doc.addEventListener("mouseout", unhover, { signal })

    // capture phase: the click must never reach host links, submits or SPA routers
    doc.addEventListener("click", onDocumentClick, { signal, capture: true })

    view.addEventListener("resize", () => render(notes), { signal })
  }

  function onMouseOver(event) {
    if (!picking || event.target.closest(LAYER_SELECTOR)) return

    unhover()
    hovered = event.target
    hovered.classList.add(HOVER_CLASS)
  }

  function unhover() {
    hovered?.classList.remove(HOVER_CLASS)
    hovered = null
  }

  function onDocumentClick(event) {
    if (!picking || event.target.closest(LAYER_SELECTOR)) return

    event.preventDefault()
    event.stopPropagation()
    onPick(event.target)
  }

  function setPicking(on) {
    picking = on
    doc.body.classList.toggle(PICKING_CLASS, on)
    toggleButton.setAttribute("aria-pressed", String(on))
    exportPane.hidden = true

    if (on && bar.hidden) setOpen(true) // toggled from outside (keyboard, host) while folded
    if (!on) unhover()
  }

  // ms: callers pass a longer time for anything the reviewer must actually read.
  // The toast lives outside the bar, so it shows while the bar is folded too.
  function message(text, ms = MESSAGE_MS, kind = INFO) {
    toast.textContent = text
    toast.dataset.kind = kind
    toast.hidden = false
    view.clearTimeout(messageTimer)
    messageTimer = view.setTimeout(() => (toast.hidden = true), ms)
  }

  // null → idle; { done, total } → capturing; {} → posting. Send stays disabled
  // throughout so the state is visible where the click happened.
  function setSending(state) {
    sendButton.disabled = !!state
    sendButton.classList.toggle(BUSY_CLASS, !!state)
    sendButton.textContent = !state ? SEND_LABEL : state.total ? CAPTURING_LABEL(state.done, state.total) : SENDING_LABEL
  }

  function readItem(name) {
    try {
      return storage.getItem(name)
    } catch {
      return null
    }
  }

  function writeItem(name, value) {
    try {
      storage.setItem(name, value)
    } catch {
      // private mode: the bar state lasts for this page view
    }
  }

  // rect omitted → interactive marquee; given → capture straight away (agents, tests).
  // Copies to the clipboard; saving to disk is the Download button's job.
  async function screenshot(rect = null) {
    setPicking(false)
    if (!rect) message(SCREENSHOT_HINT)

    const area = rect ?? (await selectRect(doc))
    if (!area) return null

    message(RENDERING_MESSAGE)

    try {
      const canvas = await captureRect(doc, area)
      const blob = await toPng(canvas)
      lastScreenshot = { blob, name: screenshotFileName(key, ++screenshotCount) }
      downloadButton.disabled = false

      if (channelOn && lastFocusedId) {
        onShot(lastFocusedId, await toJpeg(canvas))
        message(ATTACHED_MESSAGE(indexOf(lastFocusedId)), MESSAGE_MS, OK)
      } else {
        const copied = await copyImage(view, blob)
        message(copied ? COPIED_MESSAGE : NOT_COPIED_MESSAGE, MESSAGE_MS, copied ? OK : INFO)
      }

      return blob
    } catch (error) {
      message(SCREENSHOT_FAILED_MESSAGE, MESSAGE_MS, ERROR)
      throw error
    }
  }

  function downloadLast() {
    if (!lastScreenshot) return

    download(doc, lastScreenshot.blob, lastScreenshot.name)
    message(lastScreenshot.name)
  }

  function showExport(text) {
    exportPane.textContent = text
    exportPane.hidden = false
  }

  function render(nextNotes) {
    notes = nextNotes
    if (!notes.some((note) => note.id === lastFocusedId)) lastFocusedId = null // removed, cleared or never there
    clearNodes()
    notes.forEach(renderNote)
    countEl.textContent = notes.length
    updatePin()
    drawLeaders()
  }

  function renderNote(note, index) {
    const el = findElement(note)
    note.orphan = !el // export reports what the last render could resolve
    if (!el) return

    backfill(note)
    el.classList.add(ANCHOR_CLASS)

    const box = buildNote(note, index)
    const badge = buildBadge(note, index)
    root.append(box, badge)
    placeNote(note, el, box)
    placeBadge(el, badge)

    live.set(note.id, { el, box, badge, observer: observeResize(note, box) })
    makeDraggable(note, el, box)
  }

  function findElement(note) {
    try {
      return doc.querySelector(note.path)
    } catch {
      return null // a stored path can be an invalid selector
    }
  }

  // Notes saved by the first prototype carry no box geometry.
  function backfill(note) {
    for (const [key, value] of Object.entries(DEFAULT_BOX)) {
      if (typeof note[key] !== "number") note[key] = value
    }
  }

  function buildNote(note, index) {
    const box = doc.createElement("div")
    box.className = NOTE_CLASS
    box.dataset.id = note.id
    box.hidden = !!note.collapsed
    box.setAttribute("data-turbo-temporary", "")
    box.innerHTML = `
      <header class="sticky-note__header" title="${DRAG_HINT}">
        <b class="sticky-note__index">${index + 1}</b>
        <code class="sticky-note__path"></code>
        <button class="sticky-note__button" type="button" data-command="${COLLAPSE_COMMAND}" title="${COLLAPSE_LABEL}" aria-label="${COLLAPSE_LABEL}">–</button>
        <button class="sticky-note__button" type="button" data-command="${REMOVE_COMMAND}" title="${REMOVE_LABEL}" aria-label="${REMOVE_LABEL}">✕</button>
      </header>
      <textarea class="sticky-note__text" placeholder="${NOTE_PLACEHOLDER}"></textarea>`

    // textContent, not interpolation: the path comes from the host page
    const path = box.querySelector(".sticky-note__path")
    path.textContent = note.path
    path.title = note.path

    const text = box.querySelector(".sticky-note__text")
    text.value = note.note
    text.addEventListener("input", (event) => {
      note.note = event.target.value
      onChange()
    })
    text.addEventListener("focus", () => (lastFocusedId = note.id))

    box.querySelector(`[data-command="${REMOVE_COMMAND}"]`).addEventListener("click", () => onRemove(note))
    box.querySelector(`[data-command="${COLLAPSE_COMMAND}"]`).addEventListener("click", () => {
      note.collapsed = true
      onChange()
      render(notes)
    })

    return box
  }

  function buildBadge(note, index) {
    const badge = doc.createElement("span")
    badge.className = BADGE_CLASS
    badge.textContent = index + 1
    badge.title = note.note || note.path
    badge.setAttribute("data-turbo-temporary", "")

    // the badge is the only way back from a collapsed note
    badge.addEventListener("click", () => {
      note.collapsed = !note.collapsed
      onChange()
      render(notes)
    })

    return badge
  }

  function makeDraggable(note, el, box) {
    const header = box.querySelector(".sticky-note__header")

    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return

      event.preventDefault()
      const start = { x: event.clientX, y: event.clientY, dx: note.dx, dy: note.dy }
      box.classList.add(DRAGGING_CLASS)

      try {
        header.setPointerCapture(event.pointerId)
      } catch {
        // synthetic events have no live pointer to capture
      }

      const move = (moveEvent) => {
        note.dx = start.dx + (moveEvent.clientX - start.x)
        note.dy = start.dy + (moveEvent.clientY - start.y)
        placeNote(note, el, box)
        drawLeaders()
      }

      const up = () => {
        header.removeEventListener("pointermove", move)
        box.classList.remove(DRAGGING_CLASS)
        onChange()
      }

      header.addEventListener("pointermove", move)
      header.addEventListener("pointerup", up, { once: true })
      header.addEventListener("pointercancel", up, { once: true })
    })
  }

  // css `resize: both` does the resizing; we only persist the result
  function observeResize(note, box) {
    const observer = new ResizeObserver(() => {
      if (box.hidden || box.classList.contains(DRAGGING_CLASS)) return

      const w = box.offsetWidth
      const h = box.offsetHeight
      if (w === note.w && h === note.h) return

      note.w = w
      note.h = h
      onChange()
      drawLeaders()
    })

    observer.observe(box)

    return observer
  }

  function drawLeaders() {
    const page = doc.documentElement
    leaders.setAttribute("width", page.scrollWidth)
    leaders.setAttribute("height", page.scrollHeight)
    leaders.innerHTML = ""

    for (const { el, box } of live.values()) {
      if (box.hidden) continue

      const ends = leaderEnds(el, box)
      if (!ends) continue

      leaders.insertAdjacentHTML(
        "beforeend",
        `<line x1="${ends.from.x}" y1="${ends.from.y}" x2="${ends.to.x}" y2="${ends.to.y}" stroke="${LEADER_COLOR}" stroke-width="${LEADER_WIDTH}" stroke-dasharray="${LEADER_DASH}" stroke-linecap="round"/>` +
          `<circle cx="${ends.from.x}" cy="${ends.from.y}" r="${ANCHOR_DOT_RADIUS}" fill="${LEADER_COLOR}"/>`,
      )
    }
  }

  function clearNodes() {
    live.forEach(({ observer }) => observer.disconnect())
    live.clear()
    root.querySelectorAll(`.${NOTE_CLASS}, .${BADGE_CLASS}`).forEach((node) => node.remove())
    doc.querySelectorAll(`.${ANCHOR_CLASS}`).forEach((node) => node.classList.remove(ANCHOR_CLASS))
  }

  function focusNote(id) {
    lastFocusedId = id
    live.get(id)?.box.querySelector(".sticky-note__text")?.focus()
  }

  // Send is useless without a daemon; Connect is the way to get one, except
  // where the daemon lives on the app's machine rather than the browser's.
  function setChannel(on) {
    channelOn = on
    for (const node of bar.querySelectorAll(`[${SEND_ATTRIBUTE}]`)) node.hidden = !on
    for (const node of bar.querySelectorAll(`[${CONNECT_ATTRIBUTE}]`)) node.hidden = on || !connectAllowed
  }

  function setConnectAllowed(allowed) {
    connectAllowed = allowed
    setChannel(channelOn)
  }

  const indexOf = (id) => notes.findIndex((note) => note.id === id) + 1
  const session = () => picker.value
  const sessionLabel = () => picker.label
  const refreshSessions = (list) => picker.refresh(list)
  const elementOf = (id) => live.get(id)?.el ?? null
  const setShots = (count) => (shotsEl.textContent = SHOTS_LABEL(count))
  const setAutoShot = (on) => (autoShotInput.checked = on)

  return {
    mount,
    unmount,
    render,
    setPicking,
    focusNote,
    message,
    showExport,
    screenshot,
    setChannel,
    setConnectAllowed,
    setSending,
    session,
    sessionLabel,
    refreshSessions,
    elementOf,
    setShots,
    setAutoShot,
    get picking() {
      return picking
    },
  }
}
