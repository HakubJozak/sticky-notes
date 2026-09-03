import { describe, it, expect } from "vitest"
import { toMarkdown, toJson, MARKDOWN, JSON_FORMAT } from "../src/exporter.js"

const row = (overrides = {}) => ({
  n: 1,
  path: "#report > h2",
  anchored: true,
  text: "Quarterly report",
  ctx: "",
  note: "typo",
  orphan: false,
  ...overrides,
})

const META = { title: "Review page", url: "https://example.test/report" }

describe("toMarkdown", () => {
  it("writes a heading, the url and one block per note", () => {
    const lines = toMarkdown([row()], META).split("\n")

    expect(lines.slice(0, 3)).toEqual(["# Notes on Review page", "https://example.test/report", ""])
    expect(lines.slice(3)).toEqual(["1. `#report > h2`", "   > Quarterly report", "   typo", ""])
  })

  it("adds the heading context only when there is one", () => {
    expect(toMarkdown([row({ ctx: "Summary" })], META)).toContain("   under: Summary")
    expect(toMarkdown([row()], META)).not.toContain("under:")
  })

  it("indents every line of a multi-line comment", () => {
    const markdown = toMarkdown([row({ note: "first\nsecond\nthird" })], META)

    expect(markdown).toContain("   first\n   second\n   third")
  })

  it("widens the indent for notes past nine", () => {
    const markdown = toMarkdown([row({ n: 10, note: "a\nb" })], META)

    expect(markdown).toContain("10. `#report > h2`")
    expect(markdown).toContain("    > Quarterly report")
    expect(markdown).toContain("    a\n    b")
  })

  it("marks orphans and unanchored paths", () => {
    const flagged = toMarkdown([row({ orphan: true, anchored: false })], META)

    expect(flagged).toContain("(element not found on this version of the page)")
    expect(flagged).toContain("(unanchored — give the container an id)")
  })

  it("does not flag notes saved before `anchored` existed", () => {
    expect(toMarkdown([row({ anchored: undefined })], META)).not.toContain("unanchored")
  })

  it("fills in placeholders for empty text and comment", () => {
    const markdown = toMarkdown([row({ text: "", note: "" })], META)

    expect(markdown).toContain("   > —")
    expect(markdown).toContain("   (no comment)")
  })

  it("returns just the header for an empty list", () => {
    expect(toMarkdown([], META)).toBe("# Notes on Review page\nhttps://example.test/report\n")
  })

  it("lists attached screenshots after the comment, indented like it", () => {
    const lines = toMarkdown([row({ shots: ["/home/dev/.cache/sticky-notes/shots/s2/kids-12-1.jpg"] })], META).split("\n")

    expect(lines.slice(3)).toEqual([
      "1. `#report > h2`",
      "   > Quarterly report",
      "   typo",
      "   screenshot: /home/dev/.cache/sticky-notes/shots/s2/kids-12-1.jpg",
      "",
    ])
  })
})

describe("toJson", () => {
  it("wraps the rows in page metadata", () => {
    const parsed = JSON.parse(toJson([row()], { ...META, key: "/report" }))

    expect(parsed).toEqual({
      page: "https://example.test/report",
      title: "Review page",
      key: "/report",
      notes: [row()],
    })
  })

  it("pretty-prints", () => {
    expect(toJson([], META)).toContain('\n  "page"')
  })
})

describe("format names", () => {
  it("are the public option values", () => {
    expect([MARKDOWN, JSON_FORMAT]).toEqual(["markdown", "json"])
  })
})
