/* Pure DOM → string helpers: CSS path, heading context, element excerpt.
   Imports nothing on purpose — unit tests load this module without a bundler. */

// Our own UI must never be picked, quoted, or used as heading context.
export const LAYER_SELECTOR =
  ".sticky-notes-bar, .sticky-notes-export, .sticky-notes-leaders, .sticky-note, .sticky-note-badge"

// Attributes the app puts on elements on purpose — the strongest anchor we can get.
const DEFAULT_ANCHORS = ["data-testid", "data-test"]

// Framework-minted ids change on the next render, so they are worthless in a path.
const GENERATED_ID = /^(?:[0-9a-f-]{20,}|radix-|headlessui-|mui-|react-|:)/i

// A segment that pinned itself to a real attribute, not to sibling order.
const WEAK_ANCHOR_SEGMENT = /\[(name|action)=/

const CONTEXT_TAGS = "h1,h2,h3,h4,caption,legend"
const CONTEXT_MAX = 80
const EXCERPT_MAX = 120
const ELEMENT_NODE = 1
const DOCUMENT_POSITION_FOLLOWING = 4

const attr = (name, value) => `[${name}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`

// jsdom has no innerText; textContent is the honest fallback.
const textOf = (el) => (el ? el.innerText ?? el.textContent ?? "" : "")

const condense = (text, max) => String(text).trim().replace(/\s+/g, " ").slice(0, max)

/* CSS path that climbs to the nearest strong anchor the page already has:
   anchor attribute > unique id, then tag:nth-of-type segments below it.
   `anchored: false` → pure sibling-order chain → tell the reviewer to add an id. */
export function cssPath(el, { anchors = DEFAULT_ANCHORS } = {}) {
  const doc = el.ownerDocument
  const parts = []
  let node = el
  let anchored = false

  while (node && node.nodeType === ELEMENT_NODE && node !== doc.body) {
    const strong = strongAnchor(node, anchors, doc)

    if (strong) {
      parts.unshift(strong)
      anchored = true
      break
    }

    const segment = segmentOf(node)
    anchored ||= WEAK_ANCHOR_SEGMENT.test(segment)
    parts.unshift(segment)
    node = node.parentNode
  }

  return { path: parts.join(" > "), anchored }
}

function strongAnchor(el, anchors, doc) {
  const name = anchors.find((a) => el.getAttribute(a))
  if (name) return attr(name, el.getAttribute(name))

  return uniqueId(el, doc)
}

function uniqueId(el, doc) {
  const id = el.id
  if (!id || GENERATED_ID.test(id)) return ""

  const escaped = CSS.escape(id)
  if (doc.querySelectorAll(`#${escaped}`).length !== 1) return ""

  return `#${escaped}`
}

// Weak attributes the page already carries; they keep the path readable and
// survive re-orderings that would break a bare nth-of-type chain.
function segmentOf(el) {
  const tag = el.tagName.toLowerCase()
  const siblings = [...el.parentNode.children].filter((c) => c.tagName === el.tagName)
  const unique = (selector) => siblings.filter((c) => c.matches(selector)).length === 1

  const weak = [
    ["name", el.name],
    ["action", el.getAttribute("action")],
    ["data-controller", el.dataset?.controller],
  ].find(([name, value]) => value && unique(tag + attr(name, value)))

  if (weak) return tag + attr(...weak)

  if (siblings.length === 1) return tag

  return `${tag}:nth-of-type(${siblings.indexOf(el) + 1})`
}

// Nearest preceding heading/caption/legend = the section the reviewer was reading.
export function contextOf(el) {
  const doc = el.ownerDocument
  let context = ""

  for (const heading of doc.querySelectorAll(CONTEXT_TAGS)) {
    if (heading.closest(LAYER_SELECTOR)) continue
    if (!(heading.compareDocumentPosition(el) & DOCUMENT_POSITION_FOLLOWING)) continue

    context = condense(textOf(heading), CONTEXT_MAX)
  }

  return context
}

// Form controls carry no text — fall back to whatever the reviewer actually sees.
export function excerpt(el) {
  const text =
    textOf(el) ||
    el.value ||
    labelOf(el) ||
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder") ||
    el.alt ||
    ""

  return condense(text, EXCERPT_MAX)
}

function labelOf(el) {
  const doc = el.ownerDocument
  const linked = el.id && doc.querySelector(`label[for="${CSS.escape(el.id)}"]`)

  return textOf(linked || el.closest("label"))
}
