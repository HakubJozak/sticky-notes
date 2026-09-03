# @hakubjozak/sticky-notes

In-place review layer for any web page. Turn on Notes mode, click an element,
a yellow note pins itself to it — dragged, resized, persisted in
`localStorage`. Export gives every note as CSS path · quoted text · nearest
heading · comment, ready to paste back to whoever has to fix it.

No runtime dependencies. Works from a `<script>` tag, an ESM import, a
Stimulus controller, a bookmarklet, or inlined into a standalone HTML file.

Built for the review loop between a person and a coding agent: the agent
puts the layer on the page, the person pins comments, the export goes back
to the agent — see [Use with AI agents](#use-with-ai-agents) and
[`skill/SKILL.md`](skill/SKILL.md).

## Install

```sh
npm install @hakubjozak/sticky-notes
```

`dist/` is committed, so importmap and gem consumers can pull the prebuilt
files straight from the package.

## Usage

### Script tag (iife)

```html
<script src="node_modules/@hakubjozak/sticky-notes/dist/sticky-notes.iife.js"></script>
<script>StickyNotes.mount({ key: "checkout-v3" })</script>
```

`window.StickyNotes` exposes `mount`, `createStickyNotes`. CSS ships inside
the bundle — nothing else to wire.

### ESM

```js
import { mount } from "@hakubjozak/sticky-notes"

const notes = mount({ key: "checkout-v3" })
notes.toggle(true)          // enter picking mode
notes.export("markdown")    // string, also copied to the clipboard
```

`createStickyNotes(options)` returns an unmounted instance if you want to
control the lifecycle yourself.

### Stimulus

```js
import { Application } from "@hotwired/stimulus"
import StickyNotesController from "@hakubjozak/sticky-notes/stimulus"

const application = Application.start()
application.register("sticky-notes", StickyNotesController)
```

```erb
<%# app/views/shared/_sticky_notes.html.erb %>
<div data-controller="sticky-notes" data-sticky-notes-key-value="<%= request.path %>"></div>
```

The layer mounts into the controller element, and notes are positioned in
document coordinates — keep that element a direct child of `<body>`, outside any
positioned ancestor, or every note lands offset.

The controller re-anchors on `turbo:frame-render` / `turbo:morph` and unmounts
on `turbo:before-cache`. Do **not** mark the controller element
`data-turbo-temporary` — Turbo would drop it from the restoration snapshot and
the layer would not come back. Everything the layer itself creates already
carries that attribute.

### Turbo without Stimulus

```html
<div data-sticky-notes data-key="checkout-v3"></div>
<script type="module">
  import { attach } from "/path/to/dist/turbo.js"
  attach()
</script>
```

`attach(selector = "[data-sticky-notes]")` mounts the layer into the element and
follows the Turbo lifecycle: re-mount on `turbo:load`, unmount on
`turbo:before-cache`, re-anchor on `turbo:frame-render` / `turbo:morph`. Calling
it repeatedly is safe — Turbo re-runs inline module scripts on every visit — and
without Turbo it is just a `mount()`.

### Rails gem

`sticky-notes-rails` ships this repo as a Rails engine: prebuilt JS served from
the gem, no asset pipeline entry, no npm.

```ruby
# Gemfile
gem "sticky-notes-rails", github: "HakubJozak/sticky-notes"
```

```erb
<%# app/views/layouts/application.html.erb, immediately before </body> %>
<%= sticky_notes_tag %>
```

That is the whole integration — the engine mounts itself at `/sticky-notes` and
serves `turbo.js`, which the tag imports. Notes are positioned in document
coordinates, so keep the tag a direct child of `<body>`, outside any positioned
ancestor.

On in development and staging; elsewhere `sticky_notes_tag` renders nothing and
no route is mounted. Override:

```ruby
config.sticky_notes.enabled = true
```

Pass a fixed bucket with `sticky_notes_tag(key: "checkout-v3")`; the default
buckets notes under `location.pathname`.

### Artifacts and standalone HTML files

Run from a clone of this repo (`scripts/` is repo tooling, not shipped in the
npm package):

```sh
node scripts/inject-html.js report.html checkout-v3
```

Inlines the iife bundle plus `StickyNotes.mount({ key })` before `</body>`
(appends for body-less fragments). Idempotent — re-running after a rebuild
replaces the block between the `<!-- sticky-notes:begin/end -->` markers.

### Bookmarklet

Also repo tooling:

```sh
node scripts/bookmarklet.js checkout-v3 > bookmarklet.txt
```

Prints a `javascript:` URL carrying the whole bundle. Drag it onto the
bookmarks bar; clicking it mounts the layer on whatever page is open. Omit the
key to bucket notes under `location.pathname`.

## Export format

Markdown (`export("markdown")`):

```markdown
# Notes on Order 90667
https://shop.example.com/orders/90667

1. `#order-summary > tbody > tr:nth-of-type(3) > td:nth-of-type(2)`
   > 1 240,00 Kč
   under: Billing summary
   VAT is computed on the gross amount here.

2. `form[name="delivery"] > div:nth-of-type(2)` (unanchored — give the container an id)
   > Delivery date
   pre-fill from the order date
```

Continuation lines are indented to the bullet width. A note whose element is
gone on this version of the page is flagged `(element not found on this
version of the page)`.

JSON (`export("json")`):

```json
{
  "page": "https://shop.example.com/orders/90667",
  "title": "Order 90667",
  "key": "sticky-notes:checkout-v3",
  "notes": [
    {
      "n": 1,
      "path": "#order-summary > tbody > tr:nth-of-type(3) > td:nth-of-type(2)",
      "anchored": true,
      "text": "1 240,00 Kč",
      "ctx": "Billing summary",
      "note": "VAT is computed on the gross amount here.",
      "orphan": false
    }
  ]
}
```

## Options

| option | default | meaning |
|---|---|---|
| `key` | `location.pathname` | storage bucket; pass a fixed slug where paths change between versions |
| `root` | `document.body` | where the bar, notes and leader lines are appended |
| `storage` | `localStorage` | anything with `getItem` / `setItem` / `removeItem` |
| `anchors` | `["data-testid", "data-test"]` | attributes that count as strong anchors when building the CSS path |

Notes live under `sticky-notes:<key>`; a legacy `kz-notes:<key>` bucket is
migrated on first read.

## Instance API

| call | does |
|---|---|
| `mount()` / `unmount()` | add / remove the layer |
| `refresh()` | re-anchor after the host swapped DOM |
| `toggle(on?)` | picking mode |
| `export(format)` | `"markdown"` \| `"json"` → string, copies to clipboard, shows the pane |
| `screenshot(rect?)` | capture `{ x, y, w, h }` (page px) → `Promise<Blob>`, copied to the clipboard; without `rect` the reviewer drags a marquee. **Download** in the bar saves the last capture. DOM re-render via modern-screenshot, so fonts/cross-origin images can differ from the screen |
| `clear()` | drop every note in this bucket |
| `notes` | readonly array of note records |

## Use with AI agents

The export format exists so an agent can act on review comments without a
screenshot: each note carries a CSS path that resolves on the current page,
the quoted element text (the robust half — paths drift when markup changes),
the nearest heading, and the comment. Multi-line comments stay indented under
their bullet, unanchored and orphaned notes are flagged.

The loop:

1. The agent puts the layer on the page — `scripts/inject-html.js` for a
   standalone HTML file or artifact, `page.addScriptTag` + `StickyNotes.mount()`
   through a browser automation tool for a running app, or the Rails gem once
   per project.
2. The person switches on ✎ Notes, clicks the spots that need changing, types.
3. Copy Markdown, paste it into the chat.
4. The agent resolves each path against the current source (or greps for the
   quoted text), applies the change, republishes. Notes re-attach where the
   path still resolves; the rest export as "element not found" on the next
   round.

[`skill/SKILL.md`](skill/SKILL.md) is a ready-made
[Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills)
that teaches the agent all of the above, including how to read the export and
when to add an `id` instead of more markup. Install it by symlinking or copying
the `skill/` directory into your skills folder (Claude Code:
`~/.claude/skills/sticky-notes`); other agent runtimes can use the file as a
plain instruction document. The skill ships inside both the npm package and
the gem, so a project that depends on either has it at hand.

## Live delivery to Claude Code

**Send** pushes the notes and screenshots into a live Claude Code session.

```sh
ln -sf ~/projects/sticky-notes/contrib/claude-review.fish ~/.config/fish/functions/
claude-review                                        # a session that receives notes
node ~/projects/sticky-notes/server/daemon.js stop   # the daemon outlives the sessions
```

`claude-review` is `claude` plus the two flags that arm the channel; a session
started with plain `claude` never shows up in the picker. Upgrade a running one
with `claude-review --resume <id>` (id printed at exit), not `--continue`. The
daemon (one per machine) is spawned by the first session that needs it.

Bar controls, once a channel answers: **Send** (→ the picked session, or
`queue` for the next one), the **session picker** (live sessions, this app's
first), **auto-shot** (a JPEG of every noted element rides along; on by
default) and a count of manually attached ▭ Screenshots.

Rails hosts proxy through the app — remote browsing works, the daemon token
stays on the machine. The tag always renders the channel in development and the
page discovers the daemon state itself ("no daemon" and no Send when it is
down); **Connect** is never offered there. The proxy is development-only (`config.sticky_notes.channel
= true` opts a staging box in) and every call must carry the per-boot page token
the tag renders as `data-channel-token`. On a `file://` or static page, **Connect** takes the token from
`~/.cache/sticky-notes/daemon.json` and posts to the daemon directly.

Design and protocol: [`docs/live-delivery.html`](docs/live-delivery.html).

## Dev

```sh
npm run build   # dist/sticky-notes.js, dist/stimulus.js, dist/turbo.js, dist/sticky-notes.iife.js
npm run lint
npm test
```

MIT © 2026 Jakub Hozák
