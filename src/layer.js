/* Everything that touches the DOM: bar, export pane, leader overlay, note boxes
   and badges, plus picking, dragging and resizing. The note records live in
   index.js — this module renders them and reports interactions back. */
import css from "./style.css?inline"
import { LAYER_SELECTOR } from "./path.js"
import { MARKDOWN, JSON_FORMAT } from "./exporter.js"
import { DEFAULT_BOX, placeNote, placeBadge, leaderEnds } from "./geometry.js"
import { selectRect, captureRect, screenshotFileName, download, copyImage } from "./screenshot.js"

const STYLE_ID = "sticky-notes-style"
const SVG_NS = "http://www.w3.org/2000/svg"
const MESSAGE_MS = 1500
const ESCAPE_KEY = "Escape"

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

const LEADER_COLOR = "#c9a227"
const LEADER_WIDTH = 1.5
const LEADER_DASH = "2 4"
const ANCHOR_DOT_RADIUS = 2.5

export function createLayer({ root, key, onPick, onChange, onRemove, onClear, onExport }) {
  const doc = root.ownerDocument
  const view = doc.defaultView
  const live = new Map() // note id → { el, box, badge, observer }

  let notes = []
  let controller = null
  let bar = null
  let toggleButton = null
  let countEl = null
  let messageEl = null
  let exportPane = null
  let leaders = null
  let picking = false
  let hovered = null
  let messageTimer = 0
  let screenshotCount = 0
  let lastScreenshot = null // { blob, name } — Download saves it
  let downloadButton = null

  function mount() {
    injectStyle()
    buildChrome()
    listen()
  }

  function unmount() {
    setPicking(false)
    controller.abort()
    clearNodes()
    for (const node of [bar, exportPane, leaders]) node.remove()
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
    bar = doc.createElement("div")
    bar.className = "sticky-notes-bar"
    bar.innerHTML = `
      <button class="sticky-notes-bar__button" type="button" data-command="${TOGGLE_COMMAND}" aria-pressed="false">${TOGGLE_LABEL}</button>
      <span class="sticky-notes-bar__count">0</span>
      <button class="sticky-notes-bar__button" type="button" data-command="${SCREENSHOT_COMMAND}">${SCREENSHOT_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${DOWNLOAD_COMMAND}" disabled>${DOWNLOAD_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${EXPORT_MARKDOWN_COMMAND}">${MARKDOWN_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${EXPORT_JSON_COMMAND}">${JSON_LABEL}</button>
      <button class="sticky-notes-bar__button" type="button" data-command="${CLEAR_COMMAND}">${CLEAR_LABEL}</button>
      <span class="sticky-notes-bar__message"></span>`
    toggleButton = bar.querySelector(`[data-command="${TOGGLE_COMMAND}"]`)
    downloadButton = bar.querySelector(`[data-command="${DOWNLOAD_COMMAND}"]`)
    countEl = bar.querySelector(".sticky-notes-bar__count")
    messageEl = bar.querySelector(".sticky-notes-bar__message")

    exportPane = doc.createElement("pre")
    exportPane.className = "sticky-notes-export"
    exportPane.hidden = true

    leaders = doc.createElementNS(SVG_NS, "svg")
    leaders.setAttribute("class", "sticky-notes-leaders")

    // data-turbo-temporary: keep our DOM out of Turbo's snapshot cache
    for (const node of [bar, exportPane, leaders]) {
      node.setAttribute("data-turbo-temporary", "")
      root.appendChild(node)
    }

    bar.addEventListener("click", onBarClick)
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

    if (!on) unhover()
  }

  function message(text) {
    messageEl.textContent = text
    view.clearTimeout(messageTimer)
    messageTimer = view.setTimeout(() => (messageEl.textContent = ""), MESSAGE_MS)
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
      const blob = await captureRect(doc, area)
      lastScreenshot = { blob, name: screenshotFileName(key, ++screenshotCount) }
      downloadButton.disabled = false
      const copied = await copyImage(view, blob)
      message(copied ? COPIED_MESSAGE : NOT_COPIED_MESSAGE)

      return blob
    } catch (error) {
      message(SCREENSHOT_FAILED_MESSAGE)
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
    clearNodes()
    notes.forEach(renderNote)
    countEl.textContent = notes.length
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
    live.get(id)?.box.querySelector(".sticky-note__text")?.focus()
  }

  return {
    mount,
    unmount,
    render,
    setPicking,
    focusNote,
    message,
    showExport,
    screenshot,
    get picking() {
      return picking
    },
  }
}
