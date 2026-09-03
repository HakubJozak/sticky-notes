/* Rectangle capture. Drag a marquee over the page, the area is re-rendered
   through modern-screenshot (DOM → SVG foreignObject → canvas). It is a
   re-render, not a screenshot: fonts, cross-origin images and exotic CSS can
   differ from the screen. Good enough to hand an agent visual context. */
import { domToBlob } from "modern-screenshot"

const OVERLAY_CLASS = "sticky-notes-snap"
const RECT_CLASS = "sticky-notes-snap__rect"
const ESCAPE_KEY = "Escape"
const MIN_SIZE = 8 // px; anything smaller was a click, not a drag
const PNG = "image/png"
const FILE_PREFIX = "snap"

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

  return domToBlob(doc.documentElement, {
    type: PNG,
    width: w,
    height: h,
    scale: view.devicePixelRatio || 1,
    style: { transform: `translate(${-x}px, ${-y}px)`, transformOrigin: "top left" },
    filter: (node) => !EXCLUDED.some((cls) => node.classList?.contains(cls)),
  })
}

export const snapFileName = (key, n) => `${slug(key)}-${FILE_PREFIX}-${n}.png`

const slug = (key) => String(key).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "page"

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
