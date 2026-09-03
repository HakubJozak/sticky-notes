/* File-name-safe form of a page key. Shared by the overlay (Download names)
   and the daemon (shots/<session>/<slug>-<n>.jpg), so both sides agree. */
const FALLBACK = "page"

export const slug = (key) => String(key).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || FALLBACK
