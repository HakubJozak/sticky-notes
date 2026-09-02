#!/usr/bin/env node
// Print a javascript: URL carrying the whole bundle — drag it to the bookmarks
// bar and it mounts the review layer on any page you are looking at.
//
//   node scripts/bookmarklet.js [KEY]
//
// Without KEY the layer buckets notes under location.pathname.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const EXIT_USAGE = 1

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, "../dist/sticky-notes.iife.js")

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error("usage: bookmarklet.js [KEY]\n\n  KEY  storage bucket; defaults to location.pathname")
  process.exit(EXIT_USAGE)
}

let bundle
try {
  bundle = readFileSync(bundlePath, "utf8")
} catch {
  console.error(`missing ${bundlePath} — run \`npm run build\` first`)
  process.exit(EXIT_USAGE)
}

const key = process.argv[2]
const options = key ? `{ key: ${JSON.stringify(key)} }` : "{}"
// the bundle attaches itself to `this`; .call(window) makes that deterministic
// inside the wrapper, so window.StickyNotes stays reachable from the console
const source = `(function(){${bundle}\n;window.StickyNotes.mount(${options})}).call(window)`

process.stdout.write("javascript:" + encodeURIComponent(source) + "\n")
