# sticky-notes — design contract

In-place review layer for any web page. Click an element in "Notes" mode, a
yellow note pins to it; export gives every note as CSS path · quoted text ·
nearest heading · comment. Reviewer's notes persist in localStorage.


## Package

- name `@hakubjozak/sticky-notes`, ESM, `"type": "module"`, no runtime deps.
- `@hotwired/stimulus` is an optional peer dependency (only `./stimulus`).
- exports:
  - `.`            → `dist/sticky-notes.js` (ESM, core)
  - `./stimulus`   → `dist/stimulus.js` (ESM, controller class, imports core)
  - `./turbo`      → `dist/turbo.js` (ESM, `attach()` for Turbo hosts without
                     Stimulus, imports core)
  - `./iife`       → `dist/sticky-notes.iife.js` (self-contained, defines
                     `window.StickyNotes`; for `<script>`, bookmarklet, artifacts)
- CSS is a string bundled into the JS (`import css from "./style.css?inline"`)
  and injected once at mount as `<style id="sticky-notes-style">`. One
  behaviour everywhere; no separate stylesheet to wire.
- `dist/` is committed (importmap and gem consumers pull prebuilt files).

## Public API (`src/index.js`)

```js
export function createStickyNotes(options = {}) // → instance, not mounted
export function mount(options = {})             // singleton convenience, returns the instance
export default { createStickyNotes, mount }

options = {
  key: location.pathname,   // storage bucket; artifacts pass a fixed slug
  root: document.body,      // where bar/notes/leaders are appended
  storage: localStorage,    // anything with getItem/setItem/removeItem
  anchors: ["data-testid", "data-test"],   // attributes that count as strong anchors
}

instance = {
  mount(), unmount(), refresh(),   // refresh = re-anchor after the host swapped DOM
  toggle(on?),                     // picking mode
  export(format)                   // "markdown" | "json" → string (also copies + shows pane)
  clear(),
  get notes()                      // readonly array of note records
}
```

Storage key `sticky-notes:<key>`. On first read, migrate from legacy
`kz-notes:<key>` (read, write under the new key, remove the old).

Note record: `{ id, path, anchored, text, ctx, note, created, dx, dy, w, h, collapsed?, orphan? }`.

## Modules (`src/`)

| file | owns |
|---|---|
| `index.js` | API above; wires the modules; singleton for `mount()` |
| `path.js` | `cssPath(el, { anchors }) → { path, anchored }`, `contextOf(el)`, `excerpt(el)` — pure, DOM-in/string-out |
| `store.js` | `createStore(storage, key) → { load(), save(notes) }` + legacy migration |
| `exporter.js` | `toMarkdown(rows, { title, url })`, `toJson(...)`; every continuation line indented to the bullet width |
| `layer.js` | DOM: bar, export pane, leaders SVG, note boxes, badges; drag/resize; picking mode listeners (AbortController) |
| `geometry.js` | `anchorOf`, `initialOffset`, `placeNote`, `placeBadge`, leader endpoints |
| `stimulus.js` | `export default class StickyNotesController extends Controller` (see below) |
| `turbo.js` | `attach(selector)` — mount into `[data-sticky-notes]`, re-mount on `turbo:load`, unmount on `turbo:before-cache`; listeners registered once per page |
| `style.css` | all styles, classes below |

Keep functions small, early returns, a one-line *why* comment where the
reason is not obvious. No `kz`, no `KZ`, no `T()` lookup tables — plain
string constants.

## CSS classes (BEM, namespace `sticky-notes`)

| element | class |
|---|---|
| bar (fixed, bottom-right) | `.sticky-notes-bar`, buttons `.sticky-notes-bar__button` (`[aria-pressed=true]` while picking), `.sticky-notes-bar__count`, `.sticky-notes-bar__message` |
| export pane | `.sticky-notes-export` |
| leaders svg | `.sticky-notes-leaders` |
| note | `.sticky-note`, `.sticky-note--dragging`, `.sticky-note__header`, `.sticky-note__index`, `.sticky-note__path`, `.sticky-note__button` (`data-command="collapse"` / `"remove"`), `.sticky-note__text` (textarea) |
| badge | `.sticky-note-badge` |
| host states | `body.sticky-notes-picking` (crosshair), `.sticky-notes-hover` (dashed outline), `.sticky-notes-anchor` (solid outline on noted element) |

Bar buttons carry `data-command="toggle" | "export-markdown" | "export-json" | "clear"`.
Never use `data-action` (Stimulus parses it inside the controller element).
All layer nodes carry `data-turbo-temporary`. Use `all: unset` on buttons and
textarea so host CSS cannot leak in; z-index near the max; `[hidden]` must
really hide (`display:none !important`), host pages may lack that reset.

## Stimulus controller (`src/stimulus.js`)

```js
import { Controller } from "@hotwired/stimulus"
import { createStickyNotes } from "./index.js"

export default class extends Controller {
  static values = { key: String }
  connect()    { mount into this.element with key; listen turbo:frame-render + turbo:morph → refresh; turbo:before-cache → unmount }
  disconnect() { remove listeners; unmount }
}
```

The host registers it: `application.register("sticky-notes", StickyNotesController)`.
The controller element must NOT be `data-turbo-temporary` (Turbo would drop it
from the restoration snapshot).

## Turbo adapter (`src/turbo.js`)

```js
import { attach } from "@hakubjozak/sticky-notes/turbo"
attach()                       // default selector "[data-sticky-notes]"
```

Mounts the singleton into the element with `key: el.dataset.key`. Turbo
re-evaluates inline body module scripts on every visit, so `attach()` runs many
times per page: a module-level flag registers the listeners once, and every call
just re-mounts (the host element is a new node after each visit). Without Turbo
it is a plain `mount()`.

## Rails gem (`sticky-notes-rails`, files at the repo root)

Gemspec next to `package.json`, turbo-rails layout. No `isolate_namespace` — the
engine's `app/helpers` is then prepended to the host's `helpers_paths`, so
`sticky_notes_tag` reaches controllers inheriting `ActionController::Base`
directly. An initializer does `app.routes.append { mount ... => "/sticky-notes",
as: "sticky_notes" }` when enabled, so a host edits nothing but its layout.

- `StickyNotes::Rails.enabled?` — `config.sticky_notes.enabled` if set, else
  development or staging.
- `StickyNotes::AssetsController` (< `ActionController::Base`, CSRF skipped)
  serves `dist/*.js` from the gem with `fresh_when`; route named `script`
  (never `asset` — `asset_path` is an ActionView helper).
- `sticky_notes_tag(key: nil)` → the `[data-sticky-notes]` div plus an inline
  `<script type="module">` calling `attach()`. Not `data-turbo-temporary`.

## Scripts (`scripts/`, node, no deps)

- `inject-html.js PAGE.html KEY` — inline `dist/sticky-notes.iife.js` + `StickyNotes.mount({ key })` before `</body>` (or append for body-less fragments), idempotent via a marker comment.
- `bookmarklet.js [KEY]` — print a `javascript:` URL of the iife bundle.

## Tooling

- `vite` lib build producing the four dist files (two configs: an ESM pass with a `build.lib.entry` map, plus an iife pass).
- `eslint` flat config (`@eslint/js` recommended + browser globals), `npm run lint` clean.
- `vitest` + `jsdom`: unit tests for `path.js`, `store.js` (incl. migration), `exporter.js` (multi-line indent, unanchored/orphan flags).
- `npm test`, `npm run build`, `npm run lint` all green.
