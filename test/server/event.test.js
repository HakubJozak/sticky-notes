// @vitest-environment node
import { describe, it, expect } from "vitest"
import { buildEvent } from "../../server/event.js"

const BODY = {
  url: "https://krouzitko.oak.hozak.dev/kids/12",
  key: "/kids/12",
  title: "Kid 12",
  notes: [
    { n: 1, path: '#kid-form [name="kid[name]"]', text: "Name", ctx: "Details", note: "Label is cut off", shots: ["ignored-base64"] },
    { n: 2, path: "#kid-form button", text: "Save", ctx: "", note: "" },
  ],
}

describe("buildEvent", () => {
  it("renders the export markdown with stored screenshot paths and string meta", () => {
    const event = buildEvent(BODY, [["/shots/s2/kids-12-1.jpg"], []])

    expect(event.meta).toEqual({ url: BODY.url, key: "/kids/12", count: "2" })
    expect(event.content.split("\n")).toEqual([
      "# Notes on Kid 12",
      BODY.url,
      "",
      '1. `#kid-form [name="kid[name]"]`',
      "   > Name",
      "   under: Details",
      "   Label is cut off",
      "   screenshot: /shots/s2/kids-12-1.jpg",
      "",
      "2. `#kid-form button`",
      "   > Save",
      "   (no comment)",
      "",
    ])
  })

  it("tolerates a body without notes", () => {
    expect(buildEvent({ url: "u", key: "k", title: "t" }, []).meta.count).toBe("0")
  })
})
