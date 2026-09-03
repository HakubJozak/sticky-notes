/* Screenshot files. The page never names a file: session id comes from the
   live table, the key is slugged, the number is ours. Validation is by magic
   bytes, not by declared type. */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { slug } from "../src/slug.js"

export const MAX_BYTES = 2 * 1024 * 1024
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const EXTENSION = ".jpg"
const HTTP_TOO_LARGE = 413
const HTTP_UNSUPPORTED_TYPE = 415

export class ShotError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createShots(dir) {
  function store(session, key, base64) {
    const bytes = Buffer.from(base64, "base64")
    if (bytes.length > MAX_BYTES) throw new ShotError(HTTP_TOO_LARGE, `screenshot over ${MAX_BYTES} bytes`)
    if (!bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) throw new ShotError(HTTP_UNSUPPORTED_TYPE, "not a JPEG")

    const folder = join(dir, session)
    mkdirSync(folder, { recursive: true })

    const prefix = `${slug(key)}-`
    const n = readdirSync(folder).filter((name) => name.startsWith(prefix) && name.endsWith(EXTENSION)).length + 1
    const file = join(folder, `${prefix}${n}${EXTENSION}`)
    writeFileSync(file, bytes)

    return file
  }

  return { store }
}
