#!/usr/bin/env node
// Inline the self-contained bundle into an HTML file so the page carries its
// own review layer — artifacts, exported reports, static mockups.
//
//   node scripts/inject-html.js PAGE.html KEY
//
// Idempotent: the block between the markers is replaced, so re-running after
// a rebuild swaps in the new bundle instead of stacking copies.
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const BEGIN = "<!-- sticky-notes:begin -->"
const END = "<!-- sticky-notes:end -->"
const EXIT_USAGE = 1

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, "../dist/sticky-notes.iife.js")

const [page, key] = process.argv.slice(2)

if (!page || !key) {
  console.error("usage: inject-html.js PAGE.html KEY\n\n  PAGE.html  file to modify in place\n  KEY        storage bucket, e.g. the artifact slug")
  process.exit(EXIT_USAGE)
}

let bundle
try {
  bundle = readFileSync(bundlePath, "utf8")
} catch {
  console.error(`missing ${bundlePath} — run \`npm run build\` first`)
  process.exit(EXIT_USAGE)
}

// a stray "</script" anywhere in the bundle would close the tag early
const inlined = bundle.replace(/<\/script/gi, "<\\/script")
const boot = `;window.StickyNotes.mount({ key: ${JSON.stringify(key)} })`
const block = `${BEGIN}\n<script>\n${inlined}\n${boot}\n</script>\n${END}`

const html = readFileSync(page, "utf8")
const existing = new RegExp(`${BEGIN}[\\s\\S]*?${END}`)

let out
if (existing.test(html)) {
  out = html.replace(existing, () => block)
} else {
  const close = html.lastIndexOf("</body>")
  // body-less fragments (artifact partials) just get it appended
  out = close === -1 ? `${html}\n${block}\n` : html.slice(0, close) + block + "\n" + html.slice(close)
}

writeFileSync(page, out)
console.error(`sticky-notes injected into ${page} (key: ${key})`)
