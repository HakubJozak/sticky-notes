/* Browser side of live delivery. Two transports, one interface:
   - Rails path: same-origin `${base}/sessions|notes` with the page token the
     engine rendered; the engine adds the daemon token
   - direct path: loopback daemon with a token the reviewer pasted once (file:// pages) */
const SESSIONS_PATH = "/sessions"
const NOTES_PATH = "/notes"
const JSON_TYPE = "application/json"

export const DIRECT_BASE = "http://127.0.0.1:47391"
export const TOKEN_KEY = "sticky-notes:daemon-token"

export class ChannelError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createChannel({ base, token = null, fetch }) {
  const headers = { "content-type": JSON_TYPE, ...(token ? { authorization: `Bearer ${token}` } : {}) }

  const sessions = () => call(SESSIONS_PATH)

  const send = (payload) => call(NOTES_PATH, { method: "POST", body: JSON.stringify(payload) })

  async function call(path, init = {}) {
    const response = await fetch(base + path, { ...init, headers })
    const body = await response.json().catch(() => ({})) // 503 from the engine has no body

    if (!response.ok) throw new ChannelError(response.status, body.error ?? `daemon answered ${response.status}`)

    return body
  }

  return { sessions, send }
}

export function detectChannel({ base, token: pageToken = null, storage, fetch }) {
  if (base) return createChannel({ base, token: pageToken, fetch })

  const token = readToken(storage)
  if (token) return createChannel({ base: DIRECT_BASE, token, fetch })

  return null
}

export function readToken(storage) {
  try {
    return storage.getItem(TOKEN_KEY)
  } catch {
    return null // private mode: no token, no direct path
  }
}

export function saveToken(storage, token) {
  try {
    storage.setItem(TOKEN_KEY, token)
  } catch {
    // the token still works for this page view
  }
}
