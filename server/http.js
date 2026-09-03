/* The daemon's loopback API. Callers: the Rails engine (with the token from
   daemon.json) and, for local file:// pages, the overlay itself — hence CORS
   with "*": the bearer token is the gate, not the origin. */
import { createServer } from "node:http"
import { QUEUE } from "./sessions.js"
import { ShotError } from "./shots.js"
import { buildEvent } from "./event.js"

const MAX_BODY = 16 * 1024 * 1024 // notes plus a handful of 2 MB screenshots
const JSON_TYPE = "application/json"
const BEARER = "Bearer "

const HTTP_OK = 200
const HTTP_NO_CONTENT = 204
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404
const HTTP_METHOD_NOT_ALLOWED = 405
const HTTP_TOO_LARGE = 413

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createHttpServer({ token, sessions, shots, onStop, log }) {
  const routes = {
    "GET /sessions": () => sessions.list(),
    "POST /notes": (body) => postNotes(body),
    "POST /stop": () => {
      onStop()
      return { stopping: true }
    },
  }

  function postNotes(raw) {
    const body = parse(raw)
    const { session, key, notes = [] } = body
    if (session !== QUEUE && !sessions.has(session)) throw new HttpError(HTTP_NOT_FOUND, "unknown session")

    const paths = notes.map((note) => (note.shots ?? []).map((shot) => shots.store(session, key, shot)))

    return sessions.deliver(session, buildEvent(body, paths))
  }

  return createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return reply(res, HTTP_NO_CONTENT)
      if (req.headers.authorization !== BEARER + token) throw new HttpError(HTTP_UNAUTHORIZED, "bad token")

      const route = routes[`${req.method} ${req.url}`]
      if (!route) throw new HttpError(HTTP_METHOD_NOT_ALLOWED, "no such route")

      reply(res, HTTP_OK, route(await readBody(req)))
    } catch (error) {
      const status = error instanceof HttpError || error instanceof ShotError ? error.status : HTTP_BAD_REQUEST
      log(`${req.method} ${req.url} → ${status} ${error.message}`)
      reply(res, status, { error: error.message })
    }
  })
}

function parse(raw) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new HttpError(HTTP_BAD_REQUEST, `invalid json: ${error.message}`)
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    req.on("data", (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError(HTTP_TOO_LARGE, "body too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function reply(res, status, body) {
  res.writeHead(status, { ...CORS, ...(body === undefined ? {} : { "content-type": JSON_TYPE }) })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}
