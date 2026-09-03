/* Public API. Owns the note records, wires storage, path extraction and the DOM
   layer together; every module below this one stays free of shared state. */
import { cssPath, contextOf, excerpt } from "./path.js"
import { createStore } from "./store.js"
import { toMarkdown, toJson, JSON_FORMAT } from "./exporter.js"
import { createLayer } from "./layer.js"
import { DEFAULT_BOX, initialOffset } from "./geometry.js"

const DEFAULT_ANCHORS = ["data-testid", "data-test"]
const ID_RADIX = 36
const COPIED_MESSAGE = "copied"
const COPY_FAILED_MESSAGE = "select & copy"

export function createStickyNotes(options = {}) {
  const key = options.key ?? location.pathname
  const anchors = options.anchors ?? DEFAULT_ANCHORS
  const store = createStore(options.storage ?? localStorage, key)

  let notes = []
  let layer = null
  let root = null

  const save = () => store.save(notes)

  const rerender = () => layer?.render(notes)

  function mount() {
    if (layer) unmount()

    root = options.root ?? document.body
    notes = store.load()
    layer = createLayer({ root, key, onPick, onChange: save, onRemove, onClear: clear, onExport: exportNotes })
    layer.mount()
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
    rerender()
  }

  function clear() {
    if (!notes.length) return

    // no confirm() to ask with (headless host) → refuse rather than lose notes
    const view = (root ?? document.body).ownerDocument.defaultView
    if (!view?.confirm?.(`Delete ${notes.length} notes?`)) return

    notes = []
    save()
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
      () => layer?.message(COPIED_MESSAGE),
      () => layer?.message(COPY_FAILED_MESSAGE),
    )
  }

  // rect = { x, y, w, h } in page px; omit it for the interactive marquee. → Blob | null
  const screenshot = (rect) => layer?.screenshot(rect) ?? Promise.resolve(null)

  const instance = {
    mount,
    unmount,
    refresh,
    toggle,
    screenshot,
    export: exportNotes,
    clear,
    get notes() {
      return notes.slice()
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
