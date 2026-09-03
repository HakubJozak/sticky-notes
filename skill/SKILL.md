---
name: sticky-notes
description: Use when the user wants to review a page in place — an HTML artifact, a running web app, or a Rails view — by pinning comments to specific elements (diagram labels, table rows, form fields) instead of describing them, or when they paste back "# Notes on …" Markdown with CSS paths to act on.
---

# Sticky notes

In-place review layer for any web page: a "✎ Notes" mode where clicking an
element pins a draggable, resizable yellow note to it; export gives every note
as **CSS path · quoted element text · nearest heading · comment**. Notes live in
the reviewer's localStorage under `sticky-notes:<key>` (legacy `kz-notes:<key>`
migrated automatically on first read) and re-attach by path on reload.

**Addressing.** Paths climb to the nearest anchor the page already has —
`data-testid`/`data-test` (configurable) › unique `id` › field `name` / form `action` — then
`tag:nth-of-type` below it. No extra markup scheme: a note that finds no
anchor exports as "(unanchored — give the container an id)". Fix those on
demand, on the container only (form, table, card, section); rows and fields
are usually already covered by stable ids and names.

**Source of truth.** The repo checkout (assumed at `~/projects/sticky-notes`;
this skill is its `skill/` directory, symlinked into the skills folder). If
missing: `git clone https://github.com/HakubJozak/sticky-notes.git ~/projects/sticky-notes && npm ci && npm run build`.

Global API: `window.StickyNotes.mount({ key, root })` → instance with
`.unmount()` `.refresh()` `.export("markdown"|"json")`. `key` defaults to
`location.pathname`.

## Three ways in

| target | do |
|---|---|
| HTML file / artifact | `node ~/projects/sticky-notes/scripts/inject-html.js PAGE.html <page-key>`. Idempotent — replaces the marked block on re-run, appends for body-less fragments. |
| any running app, ad hoc | Playwright: `page.addScriptTag({ path: "~/projects/sticky-notes/dist/sticky-notes.iife.js" })` then `page.evaluate(() => StickyNotes.mount())`. Chrome MCP: paste the iife file into `javascript_tool`, then `StickyNotes.mount()`. For the user's own clicks: `node scripts/bookmarklet.js [key] \| wl-copy` → paste as a bookmark URL. |
| Rails app | Gemfile: `gem "sticky-notes-rails", github: "HakubJozak/sticky-notes"` — no group, it no-ops outside development/staging. Then `<%= sticky_notes_tag %>` before `</body>` in each layout (optional `key:`, e.g. `"#{controller_path}##{action_name}"`, for per-template notes across records). Engine serves `dist/` at `/sticky-notes/*.js`, mounts via a Turbo adapter — no Stimulus needed. npm consumers who prefer Stimulus: `import StickyNotesController from "@hakubjozak/sticky-notes/stimulus"`. |

**Page key.** Artifacts: fixed slug `<project>-<page>` (`shop-domain-model`)
— the artifact viewer changes paths per version, so never key by path. Existing
page → reuse its key (`grep -o 'mount({ key: "[^"]*"' PAGE.html`). Apps:
default pathname is right (notes per record page).

**Turbo.** The tag mounts into its own element on every visit, unmounts on
`turbo:before-cache` so outlines never land in the snapshot, and re-anchors on
`turbo:frame-render` / `turbo:morph`. Note mode swallows clicks in the capture
phase, so links and submit buttons do not fire while picking an element.

## Reading the export

The user pastes:

```
# Notes on Events
https://app.example.test/events/12

1. `#event_12 > td:nth-of-type(3)`
   > 14:00–15:30
   under: Events
   show duration, not end time
```

A path line may carry the "(unanchored — give the container an id)" flag;
below it a `> quoted text` line, an optional `under: <heading>` line, then the
comment — all continuation lines indented to the bullet width. The URL line
says which page. Resolve each path against the *current* source (for Rails:
find the view/partial that renders the quoted text — the quote is the
reliable part; nth-of-type paths shift when markup changes). Apply, then
redeploy/republish; notes re-attach where the path still resolves and export
as "(element not found …)" where it does not — mention those.

## What the layer does (so you don't re-implement it)

| action | behaviour |
|---|---|
| ✎ Notes → click element | note anchored at the element's top-left; opens to its left, flips right/below near the viewport edge; mode turns off |
| header drag / corner drag | move / resize; offset and size persisted |
| dotted leader | from note border to the element's top-left dot + numbered badge |
| badge click · – | collapse / expand |
| ✕ | remove (one click); **Clear** removes all (confirm) |
| Copy Markdown / JSON | clipboard + preview pane; URL + title in header; orphaned notes flagged |
| ▭ Snap → drag rectangle | DOM re-render (not a screenshot) of the area, downloaded as `<key-slug>-snap-<n>.png` and copied to the clipboard; look in `~/Downloads` when the user mentions a snap. Programmatic: `instance.snap({ x, y, w, h })` → Blob |
| Esc | leave note mode |

Namespace `.sticky-notes-bar`, `.sticky-note`, `.sticky-note-badge`, etc. —
no `kz` anywhere. `all: unset` on controls so host CSS (Tailwind, Bootstrap)
does not leak in, z-index near max. Edit `src/`, never `dist/` — rebuild with
`npm run build`.

## Common mistakes

- Injecting an artifact with a key that differs from the previous publish → reviewer's notes "vanish". Look up the key first.
- Wrapping `sticky-notes-rails` in a Gemfile group to keep it out of prod — don't; it already no-ops itself outside development/staging.
- Rebuilding a page so IDs/order change → notes orphaned. Prefer stable ids on things that get reviewed.
- Sprinkling `data-testid`/ids everywhere up front → drift and noise. Add an id only where an export said "unanchored".
- Editing `dist/sticky-notes.iife.js` directly → lost on next build. Change `src/`, run `npm run build`, re-inject/re-bookmarklet.
- Answering the export in prose only → apply the changes and redeploy; the export is a change request, not a discussion.
