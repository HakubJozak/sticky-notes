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

import { groupRects, unionOf, renderScale } from "../src/screenshot.js"

describe("groupRects", () => {
  const near = [
    { x: 0, y: 0, w: 100, h: 50 },
    { x: 300, y: 40, w: 100, h: 50 },
    { x: 50, y: 500, w: 200, h: 60 },
  ]

  it("shares one render between rects whose union is small enough", () => {
    expect(groupRects(near, 1_000_000).map((g) => g.map(({ index }) => index))).toEqual([[0, 1, 2]])
  })

  it("opens a new group when the union would grow past the cap, keeping original indexes", () => {
    const groups = groupRects([...near, { x: 0, y: 9000, w: 100, h: 100 }], 300_000)

    expect(groups.map((g) => g.map(({ index }) => index))).toEqual([[0, 1, 2], [3]])
  })

  it("orders top to bottom regardless of note order", () => {
    const groups = groupRects([{ x: 0, y: 9000, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }], 1000)

    expect(groups.map((g) => g.map(({ index }) => index))).toEqual([[1], [0]])
  })
})

describe("unionOf", () => {
  it("is the bounding box of every rect", () => {
    expect(unionOf([{ x: 10, y: 20, w: 30, h: 40 }, { x: 0, y: 50, w: 5, h: 5 }])).toEqual({ x: 0, y: 20, w: 40, h: 40 })
  })
})

describe("renderScale", () => {
  it("keeps the screen ratio for a small union", () => {
    expect(renderScale({ w: 800, h: 600 }, 2, 16_000_000)).toBe(2)
  })

  it("lowers the ratio so the canvas stays under the device-pixel cap", () => {
    expect(renderScale({ w: 4000, h: 4000 }, 2, 16_000_000)).toBe(1)
  })
})
