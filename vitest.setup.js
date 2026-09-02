/* jsdom implements no CSS interface, but CSS.escape has been baseline in every
   browser since 2015 and path.js relies on it. A naive stand-in would diverge
   on leading digits and control characters and could quietly make a wrong test
   pass, so this follows the CSSOM "serialize an identifier" algorithm.
   https://drafts.csswg.org/cssom/#serialize-an-identifier */
const REPLACEMENT = "�"

const isDigit = (code) => code >= 0x30 && code <= 0x39
const hexEscape = (code) => `\\${code.toString(16)} `

function escapeIdentifier(value) {
  const s = String(value)
  let out = ""

  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)

    if (code === 0x0000) { out += REPLACEMENT; continue }

    // control characters, and a digit that would start the identifier
    if ((code >= 0x0001 && code <= 0x001f) || code === 0x007f ||
        (i === 0 && isDigit(code)) ||
        (i === 1 && isDigit(code) && s.charCodeAt(0) === 0x002d)) {
      out += hexEscape(code)
      continue
    }

    // a lone "-" is not a valid identifier on its own
    if (i === 0 && code === 0x002d && s.length === 1) { out += "\\-"; continue }

    const safe = code >= 0x0080 || code === 0x002d || code === 0x005f ||
      isDigit(code) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)

    out += safe ? s[i] : `\\${s[i]}`
  }

  return out
}

if (!globalThis.CSS) globalThis.CSS = {}
if (typeof globalThis.CSS.escape !== "function") globalThis.CSS.escape = escapeIdentifier
