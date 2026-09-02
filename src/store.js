/* Note persistence. Any object with getItem/setItem/removeItem works, so a host
   can hand us sessionStorage or a stub. Every access is guarded: private mode
   and quota errors must never take the review layer down. */

const KEY_PREFIX = "sticky-notes:"

// The prototype wrote under this prefix; adopt those notes once, then let it go.
const LEGACY_KEY_PREFIX = "kz-notes:"

export function createStore(storage, key) {
  const storageKey = KEY_PREFIX + key
  const legacyKey = LEGACY_KEY_PREFIX + key

  const load = () => read(storage, storageKey) ?? migrate(storage, legacyKey, storageKey)

  const save = (notes) => write(storage, storageKey, notes)

  return { load, save }
}

// Only when nothing lives under the new key: fresh notes must never be
// overwritten by a stale legacy bucket, and we drop the old key only after
// the new one is safely written.
function migrate(storage, legacyKey, storageKey) {
  const legacy = read(storage, legacyKey)
  if (!legacy) return []

  write(storage, storageKey, legacy)
  remove(storage, legacyKey)

  return legacy
}

function read(storage, key) {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null

    const parsed = JSON.parse(raw)

    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function write(storage, key, notes) {
  try {
    storage.setItem(key, JSON.stringify(notes))
  } catch {
    // nothing to do: the notes stay in memory for this page view
  }
}

function remove(storage, key) {
  try {
    storage.removeItem(key)
  } catch {
    // see write()
  }
}
