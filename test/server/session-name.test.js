// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSessionNamer, projectDir } from "../../server/session-name.js"

const ID = "688bda45-2c95-40a2-8faf-5ff535c8f4ec"
const CWD = "/home/dev/projects/krouzitko"

describe("session name", () => {
  let home

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "claude-"))
    mkdirSync(join(home, "sessions"))
    mkdirSync(join(home, "projects", projectDir(CWD)), { recursive: true })
  })

  afterEach(() => rmSync(home, { recursive: true, force: true }))

  const session = (file, info) => writeFileSync(join(home, "sessions", file), JSON.stringify(info))
  const transcript = (...lines) => appendFileSync(join(home, "projects", projectDir(CWD), `${ID}.jsonl`), lines.map((l) => JSON.stringify(l) + "\n").join(""))

  it("maps a cwd to Claude Code's project folder", () => {
    expect(projectDir("/home/dev")).toBe("-home-dev")
    expect(projectDir("/home/dev/Sync/Documents/hostetin-prihlaska")).toBe("-home-dev-Sync-Documents-hostetin-prihlaska")
  })

  it("prefers the user's name, then the auto title, then Claude Code's derived name", () => {
    const namer = createSessionNamer({ sessionId: ID, cwd: CWD, home })
    expect(namer.resolve()).toBeNull()

    session("2.json", { sessionId: "other", name: "portal", nameSource: "user" })
    expect(namer.resolve()).toBeNull()

    session("1.json", { sessionId: ID, name: "dev-2f", nameSource: "derived" })
    expect(namer.resolve()).toBe("dev-2f")

    transcript({ type: "user", message: "hi" }, { type: "ai-title", aiTitle: "Krouzitko catalogue review", sessionId: ID })
    expect(namer.resolve()).toBe("Krouzitko catalogue review")

    session("1.json", { sessionId: ID, name: "kz review", nameSource: "user" })
    expect(namer.resolve()).toBe("kz review")
  })

  it("survives a half-written sessions file and a missing home", () => {
    writeFileSync(join(home, "sessions", "3.json"), "{")
    expect(createSessionNamer({ sessionId: ID, cwd: CWD, home }).resolve()).toBeNull()
    expect(createSessionNamer({ sessionId: ID, cwd: CWD, home: join(home, "nope") }).resolve()).toBeNull()
    expect(createSessionNamer({ sessionId: null, cwd: CWD, home }).resolve()).toBeNull()
  })
})
