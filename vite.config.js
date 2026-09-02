import { defineConfig } from "vite"

// ESM library pass. index.js is a real entry, so stimulus.js and turbo.js
// import "./sticky-notes.js" instead of inlining the core a second time.
export default defineConfig({
  build: {
    target: "es2020",
    minify: false,
    lib: {
      entry: {
        "sticky-notes": "src/index.js",
        stimulus: "src/stimulus.js",
        turbo: "src/turbo.js"
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: ["@hotwired/stimulus"],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js"
      }
    }
  }
})
