# sticky-notes — design contract

In-place review layer for any web page. Click an element in "Notes" mode, a
yellow note pins to it; export gives every note as CSS path · quoted text ·
nearest heading · comment. Reviewer's notes persist in localStorage.


## Package

- name `@hakubjozak/sticky-notes`, ESM, `"type": "module"`. One runtime dep,
  `modern-screenshot` (rectangle capture), bundled into dist.
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
- `files`: `dist`, `src`, `server`; `bin.sticky-notes-daemon` → `server/daemon.js`
  (the daemon is plain node, it needs no build).

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
  channel: undefined,       // base URL of the channel ("/sticky-notes" under the engine) or an
                            // object { sessions(), send(payload) }; unset = the direct daemon
                            // when a token is stored, else no channel and no Send
  channelToken: undefined,  // page token for the engine channel (data-channel-token)
  connect: true,            // false hides Connect for good (the Rails adapters pass it)
  fetch: globalThis.fetch,  // injected in tests
}

instance = {
  mount(), unmount(), refresh(),   // refresh = re-anchor after the host swapped DOM
  toggle(on?),                     // picking mode
  export(format)                   // "markdown" | "json" → string (also copies + shows pane)
  screenshot(rect?)                // { x, y, w, h } page px → Promise<Blob>; no rect = drag a marquee
  clear(),
  send()                           // notes + pending shots → the picked session; { delivered } | { queued } | null
  attachScreenshot(id, jpeg)       // base64 JPEG waits with note `id` until the next send()
  setAutoShot(on)                  // capture every noted element on send (default on)
  connect(token?)                  // direct daemon path; no token = prompt(), then stored
  get notes()                      // readonly array of note records
  get channel()                    // the channel object, or null
}
```

| storage key | holds |
|---|---|
| `sticky-notes:<key>` | the notes; on first read migrated from legacy `kz-notes:<key>` (read, write under the new key, remove the old) |
| `sticky-notes:session:<key>` | the session id picked for this page |
| `sticky-notes:pending:<key>` | count of attached but unsent screenshots, so the next mount can say "N screenshots lost" |
| `sticky-notes:auto-shot` | global; `"0"` = off, anything else on |
| `sticky-notes:daemon-token` | global; the token pasted into **Connect** for the direct path |

Every read and write is wrapped — private mode must cost the page view, not the layer.

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
| `screenshot.js` | `selectRect(doc)` marquee → page rect; `captureRect(doc, rect)` → canvas, DOM re-render via modern-screenshot (document shifted by `translate(-x,-y)`, clipped to w×h); `captureElement(doc, el, padding)` via `paddedRect`; `toPng` / `toJpeg` (`jpegSize` downscales to `JPEG_MAX_EDGE` 1568 px at `JPEG_QUALITY` 0.85 — token cost follows pixel area); `download`, `copyImage` |
| `channel.js` | `createChannel({ base, token, fetch })` → `{ sessions(), send(payload) }`, `ChannelError(status)`; `detectChannel({ base, token, storage, fetch })` picks the engine base with the page token, else a stored token + `DIRECT_BASE` (`http://127.0.0.1:47391`), else null; `readToken` / `saveToken` |
| `picker.js` | the session `<select>`: one live session picks itself, otherwise the remembered id, otherwise "pick a session…"; `queue` is always offered and never automatic |
| `slug.js` | `slug(key)` — file-name-safe page key, shared with the daemon so both name shots alike |
| `stimulus.js` | `export default class StickyNotesController extends Controller` (see below) |
| `turbo.js` | `attach(selector)` — mount into `[data-sticky-notes]`, re-mount on `turbo:load`, unmount on `turbo:before-cache`; listeners registered once per page |
| `style.css` | all styles, classes below |

Keep functions small, early returns, a one-line *why* comment where the
reason is not obvious. No `kz`, no `KZ`, no `T()` lookup tables — plain
string constants.

## Modules (`server/`)

Plain node, no build, no npm deps. State lives under `~/.cache/sticky-notes/`
(`STICKY_NOTES_HOME` overrides): `daemon.json` (mode 0600), `daemon.sock`,
`daemon.log`, `shots/<session>/<key-slug>-<n>.jpg`.

| file | owns |
|---|---|
| `daemon.js` | one per machine. `start()` binds `daemon.sock` and `127.0.0.1:47391` (`STICKY_NOTES_PORT`), writes `daemon.json`; a second daemon that finds a live socket exits 0, a stale socket file is unlinked. `node server/daemon.js stop` POSTs `/stop` |
| `mcp.js` | one per review session, spawned by Claude Code over stdio (`mcp.json`). Registers `{ cwd, pid, label, claudeSession }` and forwards every daemon event to the channel. Holds no state |
| `channel.js` | the MCP half: hand-rolled JSON-RPC over stdio, `claude/channel` capability, `notifications/claude/channel`. Buffers events until `READY_DELAY_MS` (3 s) after `notifications/initialized` — Claude Code drops what arrives before that |
| `daemon-client.js` | the socket to the daemon: spawns it detached when the socket file is missing, retries every 2 s on close, respawns on `ECONNREFUSED` (only a fresh daemon can replace a stale socket file) |
| `http.js` | the loopback API: `GET /sessions`, `POST /notes`, `POST /stop`, all behind `Authorization: Bearer <token>`; CORS `*` because the token is the gate; 16 MB body cap |
| `socket.js` | the unix-socket server: one connection is one session, its first line registers it, its close ends it |
| `sessions.js` | the live table (id → `cwd`, `pid`, `label`, `claudeSession`, socket) plus the `queue` buffer, drained by the next session that registers |
| `shots.js` | writes `shots/<session>/<key-slug>-<n>.jpg`; 2 MB cap (413) and JPEG magic bytes (415). The page never names a file |
| `event.js` | `POST /notes` body → `{ content, meta: { url, key, count } }`; `content` is the same Markdown as Copy Markdown, with a `screenshot: <path>` line per stored shot |
| `paths.js` | every path above, `STICKY_NOTES_HOME` / `STICKY_NOTES_PORT`, `DEFAULT_PORT = 47391` |
| `ndjson.js` | newline-delimited JSON framing; one bad line never kills a connection |

## CSS classes (BEM, namespace `sticky-notes`)

| element | class |
|---|---|
| bar (fixed, bottom-right) | `.sticky-notes-bar`, buttons `.sticky-notes-bar__button` (`[aria-pressed=true]` while picking), `.sticky-notes-bar__count`, `.sticky-notes-bar__message`, `.sticky-notes-bar__picker` (session `<select>`), `.sticky-notes-bar__auto` (auto-shot checkbox label), `.sticky-notes-bar__shots` (unsent shot count) |
| export pane | `.sticky-notes-export` |
| leaders svg | `.sticky-notes-leaders` |
| note | `.sticky-note`, `.sticky-note--dragging`, `.sticky-note__header`, `.sticky-note__index`, `.sticky-note__path`, `.sticky-note__button` (`data-command="collapse"` / `"remove"`), `.sticky-note__text` (textarea) |
| badge | `.sticky-note-badge` |
| host states | `body.sticky-notes-picking` (crosshair), `.sticky-notes-hover` (dashed outline), `.sticky-notes-anchor` (solid outline on noted element) |
| screenshot marquee | `.sticky-notes-screenshot` (fixed full-viewport overlay), `.sticky-notes-screenshot__rect` (dims outside via box-shadow) |

Bar buttons carry `data-command="toggle" | "screenshot" | "download" | "send" | "auto-shot" | "connect" | "export-markdown" | "export-json" | "clear"`.
The channel controls (Send, picker, auto-shot, shots) carry `data-send` and
Connect carries `data-connect`; `setChannel(on)` shows one set and hides the
other, so a page without a daemon shows neither Send nor a picker.
`setConnectAllowed(false)` keeps Connect hidden as well — every page mounted by
the Rails adapters, whose daemon is the app's, not the browser's.
Screenshot copies the image to the clipboard when the browser allows it and
enables Download, which saves the last capture as `<key-slug>-screenshot-<n>.png`.
Bar, export pane and overlay are filtered out of the render; notes and badges
stay in the picture on purpose.
Never use `data-action` (Stimulus parses it inside the controller element).
All layer nodes carry `data-turbo-temporary`. Use `all: unset` on buttons and
textarea so host CSS cannot leak in; z-index near the max; `[hidden]` must
really hide (`display:none !important`), host pages may lack that reset.

## Stimulus controller (`src/stimulus.js`)

```js
import { Controller } from "@hotwired/stimulus"
import { createStickyNotes } from "./index.js"

export default class extends Controller {
  static values = { key: String, channel: String, channelToken: String }
  connect()    { mount into this.element with key and connect: false; listen turbo:frame-render + turbo:morph → refresh; turbo:before-cache → unmount }
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

Mounts the singleton into the element with `key: el.dataset.key`,
`channel: el.dataset.channel`, `channelToken: el.dataset.channelToken` and
`connect: false` (the engine renders both attributes whenever the channel is on;
Connect belongs to `file://` pages only). Turbo
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
- `StickyNotes::Rails.channel?` — live delivery, `enabled?` and development,
  unless `config.sticky_notes.channel = true` opts a staging box in.
- `StickyNotes::Rails.channel_token` — first 32 hex of
  `SHA256("sticky-notes:" + secret_key_base)`, rendered into the page and required
  on every channel call. Derived, not random: every puma worker must accept it.
- `StickyNotes::AssetsController` (< `ActionController::Base`, CSRF skipped)
  serves `dist/*.js` from the gem with `fresh_when`; route named `script`
  (never `asset` — `asset_path` is an ActionView helper).
- `sticky_notes_tag(key: nil, anchors: nil)` → the `[data-sticky-notes]` div plus
  an inline `<script type="module">` calling `attach()`. Not `data-turbo-temporary`.
  Adds `data-channel="/sticky-notes"` and `data-channel-token` whenever
  `channel?`, with no daemon probe in the render path: the page calls
  `/sessions` itself, hides Send on failure and shows it again when a later
  call succeeds. Connect is never offered on such a page.
- `StickyNotes::Rails::Daemon` — http.rb (gem dep `http >= 5`), 2 s global
  timeout so a wedged daemon cannot stall a page render, `Unreachable` for
  every transport error. `sessions(root:)` orders the daemon's list for this
  `Rails.root`: exact cwd, then ancestors closest first, then the rest. A
  half-written `daemon.json` reads as "no daemon", never as an exception.
- `StickyNotes::ChannelController` (< `ActionController::Base`, CSRF skipped) —
  `GET /sticky-notes/sessions` returns the ordered list, `POST
  /sticky-notes/notes` forwards the raw body and returns the daemon's status and
  JSON unchanged (401/404/413/415 pass through). Both answer 503 when the daemon
  is unreachable. Every call must carry `Authorization: Bearer <channel_token>`
  or it is 401 — a hostile page can guess the URL but not the token, and the
  header forces a CORS preflight the engine never answers. Routed only when
  `StickyNotes::Rails.channel?`.

## Scripts (`scripts/`, node, no deps)

- `inject-html.js PAGE.html KEY` — inline `dist/sticky-notes.iife.js` + `StickyNotes.mount({ key })` before `</body>` (or append for body-less fragments), idempotent via a marker comment.
- `bookmarklet.js [KEY]` — print a `javascript:` URL of the iife bundle.

## Tooling

- `vite` lib build producing the four dist files (two configs: an ESM pass with a `build.lib.entry` map, plus an iife pass).
- `eslint` flat config (`@eslint/js` recommended + browser globals), `npm run lint` clean.
- `vitest` + `jsdom`: unit tests for `src/` and `server/` (`npm test`). jsdom has no canvas, so JPEG conversion and auto-shot are covered by browser checks, not units.
- Ruby: `bundle exec ruby -Itest test/rails/channel_test.rb` (Gemfile at the repo root, lock not committed).
- `npm test`, `npm run build`, `npm run lint` all green.
