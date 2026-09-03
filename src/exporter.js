/* Export formats. Rows are plain records — { n, path, anchored, text, ctx, note,
   orphan, shots? } — so this module is pure and testable without a DOM. */

export const MARKDOWN = "markdown"
export const JSON_FORMAT = "json"

const EMPTY_TEXT = "—"
const EMPTY_NOTE = "(no comment)"
const ORPHAN_FLAG = "(element not found on this version of the page)"
const UNANCHORED_FLAG = "(unanchored — give the container an id)"
const SCREENSHOT_LINE = "screenshot: "
const JSON_INDENT = 2

export function toMarkdown(rows, { title = "", url = "" } = {}) {
  return [`# Notes on ${title}`, url, "", ...rows.flatMap(markdownRow)].join("\n")
}

export function toJson(rows, { title = "", url = "", key = "" } = {}) {
  return JSON.stringify({ page: url, title, key, notes: rows }, null, JSON_INDENT)
}

function markdownRow(row) {
  const pad = " ".repeat(`${row.n}. `.length) // continuation lines align under the bullet text
  const comment = row.note || EMPTY_NOTE

  return [
    `${row.n}. \`${row.path}\`${flagsOf(row)}`,
    `${pad}> ${row.text || EMPTY_TEXT}`,
    ...(row.ctx ? [`${pad}under: ${row.ctx}`] : []),
    ...comment.split("\n").map((line) => pad + line),
    ...(row.shots ?? []).map((path) => `${pad}${SCREENSHOT_LINE}${path}`),
    "",
  ]
}

function flagsOf(row) {
  let flags = ""
  if (row.orphan) flags += ` ${ORPHAN_FLAG}`

  // Notes saved before `anchored` existed carry no flag — only an explicit false counts.
  if (row.anchored === false) flags += ` ${UNANCHORED_FLAG}`

  return flags
}
