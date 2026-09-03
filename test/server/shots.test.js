// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createShots, ShotError, MAX_BYTES } from "../../server/shots.js"

// smallest bytes that pass the magic check; the daemon never decodes images
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64")
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")

describe("createShots", () => {
  let dir

  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "shots-"))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("writes the jpeg under the session, numbered per key", () => {
    const shots = createShots(dir)

    expect(shots.store("s1", "/kids/12", JPEG)).toBe(join(dir, "s1", "kids-12-1.jpg"))
    expect(shots.store("s1", "/kids/12", JPEG)).toBe(join(dir, "s1", "kids-12-2.jpg"))
    expect(shots.store("s1", "/kids/13", JPEG)).toBe(join(dir, "s1", "kids-13-1.jpg"))
    expect(readFileSync(join(dir, "s1", "kids-12-1.jpg")).toString("base64")).toBe(JPEG)
  })

  it("continues numbering after a restart", () => {
    createShots(dir).store("s1", "/kids/12", JPEG)

    expect(createShots(dir).store("s1", "/kids/12", JPEG)).toBe(join(dir, "s1", "kids-12-2.jpg"))
  })

  it("rejects anything that is not a jpeg with 415", () => {
    const shots = createShots(dir)

    expect(() => shots.store("s1", "/k", PNG)).toThrow(ShotError)
    expect(() => shots.store("s1", "/k", PNG)).toThrow(expect.objectContaining({ status: 415 }))
    expect(existsSync(join(dir, "s1"))).toBe(false)
  })

  it("rejects oversized images with 413", () => {
    const big = Buffer.alloc(MAX_BYTES + 1, 0xff).toString("base64")

    expect(() => createShots(dir).store("s1", "/k", big)).toThrow(expect.objectContaining({ status: 413 }))
  })

  it("never lets the key become a path", () => {
    expect(createShots(dir).store("s1", "../../etc/passwd", JPEG)).toBe(join(dir, "s1", "etc-passwd-1.jpg"))
  })
})
