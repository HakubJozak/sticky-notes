import { defineConfig } from "vite"

// Self-contained pass for <script>, bookmarklet and injected artifacts.
// CSS travels inside the JS (index.js imports ./style.css?inline), so no
// css-inject plugin. Readable on purpose — people paste this into pages.
export default defineConfig({
  build: {
    target: "es2020",
    minify: false,
    emptyOutDir: false, // keep the ESM pass that ran first
    lib: {
      entry: "src/index.js",
      formats: ["iife"],
      name: "StickyNotes",
      fileName: () => "sticky-notes.iife.js"
    },
    rollupOptions: {
      // named: window.StickyNotes.mount() as well as .default.mount()
      output: { exports: "named", extend: true }
    }
  }
})
