/* Turns a POST /notes body into the channel event: the same Markdown the
   overlay exports, with stored screenshot paths per note, plus string meta. */
import { toMarkdown } from "../src/exporter.js"

export function buildEvent({ url = "", key = "", title = "", notes = [] }, pathsByNote) {
  const rows = notes.map((note, index) => ({ ...note, shots: pathsByNote[index] ?? [] }))

  return {
    content: toMarkdown(rows, { title, url }),
    meta: { url, key, count: String(notes.length) },
  }
}
