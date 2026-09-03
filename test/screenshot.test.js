import { describe, it, expect } from "vitest"
import { paddedRect, jpegSize } from "../src/screenshot.js"

describe("jpegSize", () => {
  it("caps the long edge and floors the short edge at 1px for extreme ratios", () => {
    expect(jpegSize(3000, 1, 1568)).toEqual({ width: 1568, height: 1 })
  })

  it("leaves a canvas under the cap untouched", () => {
    expect(jpegSize(800, 600, 1568)).toEqual({ width: 800, height: 600 })
  })
})

describe("paddedRect", () => {
  it("shrinks, rather than shifts, a box starting above/left of the origin", () => {
    const box = { left: -50, top: -30, width: 100, height: 40 }
    const scroll = { x: 0, y: 0 }
    const page = { scrollWidth: 1000, scrollHeight: 800 }

    expect(paddedRect(box, scroll, page, 20)).toEqual({ x: 0, y: 0, w: 70, h: 30 })
  })

  it("pads symmetrically when the padded box stays inside the document", () => {
    const box = { left: 100, top: 50, width: 200, height: 80 }
    const scroll = { x: 0, y: 0 }
    const page = { scrollWidth: 2000, scrollHeight: 2000 }

    expect(paddedRect(box, scroll, page, 10)).toEqual({ x: 90, y: 40, w: 220, h: 100 })
  })

  it("clamps the far edge at the document's scroll size", () => {
    const box = { left: 900, top: 700, width: 200, height: 200 }
    const scroll = { x: 0, y: 0 }
    const page = { scrollWidth: 1000, scrollHeight: 800 }

    expect(paddedRect(box, scroll, page, 10)).toEqual({ x: 890, y: 690, w: 110, h: 110 })
  })
})
