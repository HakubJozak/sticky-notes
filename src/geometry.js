/* Placement maths in document coordinates: where a note, its badge and its
   leader line sit relative to the element they annotate. */

const NOTE_WIDTH = 240
const NOTE_HEIGHT = 110
const GAP = 24 // breathing room between the element and a note pushed aside
const NOTE_RISE = 8 // notes start slightly above the element's top edge
const BADGE_OFFSET = 8 // badge straddles the element's top-left corner
const EDGE_MARGIN = 4 // never let a note hang off the right edge of the document

// Offset from the element's top-left corner: the note sits to its left.
export const DEFAULT_BOX = { dx: -(NOTE_WIDTH + GAP), dy: -NOTE_RISE, w: NOTE_WIDTH, h: NOTE_HEIGHT }

export function anchorOf(el) {
  const view = el.ownerDocument.defaultView
  const rect = el.getBoundingClientRect()

  return { x: view.scrollX + rect.left, y: view.scrollY + rect.top }
}

/* The note sits left of the element; near the left edge it would clamp on top of
   the element itself, so flip it to the right — or drop it below when that
   overflows too. */
export function initialOffset(el) {
  const anchor = anchorOf(el)
  const rect = el.getBoundingClientRect()
  const page = el.ownerDocument.documentElement

  if (anchor.x + DEFAULT_BOX.dx >= 0) return {}

  if (anchor.x + rect.width + GAP + DEFAULT_BOX.w <= page.clientWidth) return { dx: rect.width + GAP }

  return { dx: 0, dy: rect.height + GAP / 2 }
}

export function placeNote(note, el, box) {
  const anchor = anchorOf(el)
  const page = el.ownerDocument.documentElement
  const maxLeft = Math.max(0, page.scrollWidth - (note.w || DEFAULT_BOX.w) - EDGE_MARGIN)

  box.style.left = `${Math.min(Math.max(0, anchor.x + note.dx), maxLeft)}px`
  box.style.top = `${Math.max(0, anchor.y + note.dy)}px`
  box.style.width = `${note.w}px`
  box.style.height = `${note.h}px`
}

export function placeBadge(el, badge) {
  const anchor = anchorOf(el)

  badge.style.left = `${anchor.x - BADGE_OFFSET}px`
  badge.style.top = `${anchor.y - BADGE_OFFSET}px`
}

// Nearest point on the note's border to the anchor; null when the anchor already
// lies inside the note, where a leader would be noise.
export function leaderEnds(el, box) {
  const anchor = anchorOf(el)
  const left = box.offsetLeft
  const top = box.offsetTop
  const x = Math.min(Math.max(anchor.x, left), left + box.offsetWidth)
  const y = Math.min(Math.max(anchor.y, top), top + box.offsetHeight)

  if (x === anchor.x && y === anchor.y) return null

  return { from: anchor, to: { x, y } }
}
