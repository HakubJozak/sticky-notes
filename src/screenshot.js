/* Rectangle capture. Drag a marquee over the page, the area is re-rendered
   through modern-screenshot (DOM → SVG foreignObject → canvas). It is a
   re-render, not a screenshot: fonts, cross-origin images and exotic CSS can
   differ from the screen. Good enough to hand an agent visual context. */
import { domToCanvas } from "modern-screenshot"
import { slug } from "./slug.js"

const OVERLAY_CLASS = "sticky-notes-screenshot"
const RECT_CLASS = "sticky-notes-screenshot__rect"
const ESCAPE_KEY = "Escape"
const MIN_SIZE = 8 // px; anything smaller was a click, not a drag
const PNG = "image/png"
const JPEG = "image/jpeg"
const FILE_PREFIX = "screenshot"
const MIN_EDGE = 1 // px; a canvas dimension of 0 makes toBlob resolve null
export const JPEG_MAX_EDGE = 1568 // px; Claude's token cost follows pixel area
export const JPEG_QUALITY = 0.85

// Our own chrome must not show up in the picture; notes and badges stay.
const EXCLUDED = ["sticky-notes-bar", "sticky-notes-export", OVERLAY_CLASS]

// Resolves with the dragged rectangle in page coordinates, or null on Escape.
export function selectRect(doc) {
  const view = doc.defaultView

  return new Promise((resolve) => {
    const overlay = doc.createElement("div")
    overlay.className = OVERLAY_CLASS
    const rect = doc.createElement("div")
    rect.className = RECT_CLASS
    rect.hidden = true
    overlay.append(rect)
    doc.body.append(overlay)

    let start = null

    const finish = (result) => {
      doc.removeEventListener("keydown", onKey, true)
      overlay.remove()
      resolve(result)
    }

    const onKey = (event) => {
      if (event.key !== ESCAPE_KEY) return

      event.stopPropagation()
      finish(null)
    }

    const bounds = (event) => ({
      left: Math.min(start.x, event.clientX),
      top: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    })

    overlay.addEventListener("pointerdown", (event) => {
      event.preventDefault()
      start = { x: event.clientX, y: event.clientY }
      overlay.setPointerCapture(event.pointerId)
      rect.hidden = false
    })

    overlay.addEventListener("pointermove", (event) => {
      if (!start) return

      const box = bounds(event)
      Object.assign(rect.style, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      })
    })

    overlay.addEventListener("pointerup", (event) => {
      if (!start) return

      const box = bounds(event)
      if (box.width < MIN_SIZE || box.height < MIN_SIZE) return finish(null)

      finish({
        x: Math.round(box.left + view.scrollX),
        y: Math.round(box.top + view.scrollY),
        w: Math.round(box.width),
        h: Math.round(box.height),
      })
    })

    doc.addEventListener("keydown", onKey, true)
  })
}

// Renders the whole document shifted by (-x, -y) into a w×h viewport — the
// library clips to width/height, so only the rectangle gets rasterised.
export function captureRect(doc, { x, y, w, h }) {
  const view = doc.defaultView

  return domToCanvas(doc.documentElement, {
    width: w,
    height: h,
    scale: view.devicePixelRatio || 1,
    style: { transform: `translate(${-x}px, ${-y}px)`, transformOrigin: "top left" },
    filter: (node) => !EXCLUDED.some((cls) => node.classList?.contains(cls)),
  })
}

// The padded box in page coordinates, clamped to the document on every edge —
// a box starting above/left of the origin shrinks instead of sliding into
// unrelated content. Pure so the clamping math is testable without a DOM.
export function paddedRect(box, scroll, page, padding) {
  const left = clamp(box.left + scroll.x - padding, 0, page.scrollWidth)
  const top = clamp(box.top + scroll.y - padding, 0, page.scrollHeight)
  const right = clamp(box.left + scroll.x + box.width + padding, 0, page.scrollWidth)
  const bottom = clamp(box.top + scroll.y + box.height + padding, 0, page.scrollHeight)

  return {
    x: Math.round(left),
    y: Math.round(top),
    w: Math.max(MIN_EDGE, Math.round(right - left)),
    h: Math.max(MIN_EDGE, Math.round(bottom - top)),
  }
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

// The element's box plus padding, clamped to the document — auto-shot uses it.
export function captureElement(doc, el, padding = 0) {
  const view = doc.defaultView
  const page = doc.documentElement
  const box = el.getBoundingClientRect()
  const rect = paddedRect(box, { x: view.scrollX, y: view.scrollY }, { scrollWidth: page.scrollWidth, scrollHeight: page.scrollHeight }, padding)

  return captureRect(doc, rect)
}

export const toPng = (canvas) => canvasToBlob(canvas, PNG)

// Scaled output size for the long-edge cap — both edges floored at MIN_EDGE
// so an extreme aspect ratio never rounds a dimension down to 0.
export function jpegSize(cssWidth, cssHeight, maxEdge) {
  const factor = Math.min(1, maxEdge / Math.max(cssWidth, cssHeight))

  return {
    width: Math.max(MIN_EDGE, Math.round(cssWidth * factor)),
    height: Math.max(MIN_EDGE, Math.round(cssHeight * factor)),
  }
}

// CSS scale (device pixels divided by dpr), long edge capped, JPEG → base64.
export async function toJpeg(canvas, { maxEdge = JPEG_MAX_EDGE, quality = JPEG_QUALITY } = {}) {
  const doc = canvas.ownerDocument
  const view = doc.defaultView
  const dpr = view.devicePixelRatio || 1
  const { width, height } = jpegSize(canvas.width / dpr, canvas.height / dpr, maxEdge)

  const out = doc.createElement("canvas")
  out.width = width
  out.height = height
  out.getContext("2d").drawImage(canvas, 0, 0, width, height)

  const blob = await canvasToBlob(out, JPEG, quality)
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new view.FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

  return dataUrl.slice(dataUrl.indexOf(",") + 1)
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas produced no image"))), type, quality)
  })
}

export const screenshotFileName = (key, n) => `${slug(key)}-${FILE_PREFIX}-${n}.png`

export function download(doc, blob, name) {
  const view = doc.defaultView
  const url = view.URL.createObjectURL(blob)
  const link = doc.createElement("a")
  link.href = url
  link.download = name
  link.click()
  view.setTimeout(() => view.URL.revokeObjectURL(url), 0)
}

// Best effort: lets the reviewer paste the picture straight into a chat.
export async function copyImage(view, blob) {
  const clipboard = view.navigator?.clipboard
  if (!clipboard?.write || !view.ClipboardItem) return false

  try {
    await clipboard.write([new view.ClipboardItem({ [PNG]: blob })])
    return true
  } catch {
    return false // permission denied or unfocused document
  }
}
