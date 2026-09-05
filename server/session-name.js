/* What Claude Code calls the session this MCP server belongs to. Two sources,
   both written by Claude Code itself:
     ~/.claude/sessions/<pid>.json   — `name` (a /rename gives nameSource "user")
     ~/.claude/projects/<cwd>/<id>.jsonl — `ai-title` lines, the auto-generated title
   A user's name wins; the derived name ("dev-2f") is noise and never used. */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const SESSIONS_DIR = "sessions"
const PROJECTS_DIR = "projects"
const USER_NAMED = "user"
const AI_TITLE = "ai-title"
const AI_TITLE_LINE = /"type":"ai-title"/

export const claudeHome = () => join(homedir(), ".claude")

// Claude Code's project folder for a cwd: every non-alphanumeric byte → "-"
export const projectDir = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-")

export function createSessionNamer({ sessionId, cwd, home = claudeHome() }) {
  let aiTitle = null // titles do not change once given; found once, kept
  let scannedSize = -1

  function userName() {
    let files = []
    try {
      files = readdirSync(join(home, SESSIONS_DIR)).filter((f) => f.endsWith(".json"))
    } catch {
      return null // no sessions dir: an older Claude Code, or not Claude Code at all
    }

    for (const file of files) {
      try {
        const info = JSON.parse(readFileSync(join(home, SESSIONS_DIR, file), "utf8"))
        if (info.sessionId === sessionId && info.nameSource === USER_NAMED && info.name) return info.name
      } catch {
        // a file mid-write or from another version: skip it
      }
    }

    return null
  }

  // The transcript grows for the life of the session; it is read only while
  // no title has been found and only when it grew since the last look.
  function title() {
    if (aiTitle) return aiTitle

    const path = join(home, PROJECTS_DIR, projectDir(cwd), `${sessionId}.jsonl`)
    try {
      const { size } = statSync(path)
      if (size === scannedSize) return null
      scannedSize = size

      const lines = readFileSync(path, "utf8").split("\n").filter((line) => AI_TITLE_LINE.test(line))
      for (const line of lines.reverse()) {
        const entry = JSON.parse(line)
        if (entry.type === AI_TITLE && entry.aiTitle) return (aiTitle = entry.aiTitle)
      }
    } catch {
      // no transcript yet
    }

    return null
  }

  // → string | null; null means "nothing better than the cwd"
  const resolve = () => (sessionId ? userName() ?? title() : null)

  return { resolve }
}
