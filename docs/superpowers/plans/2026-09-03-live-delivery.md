# Sticky Notes Live Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Send" button in the sticky-notes overlay delivers the notes (plus JPEG screenshots) straight into a running Claude Code session, chosen from a picker, without copy and paste.

**Architecture:** One per-machine **daemon** (node, loopback HTTP `127.0.0.1:47391` + token, unix socket) keeps the table of live review sessions and buffers notes. One **sticky-notes MCP server** per review session (stdio child of Claude Code, declares `claude/channel`) connects to the daemon and forwards its events as `notifications/claude/channel`. The **Rails engine** proxies the page's same-origin `POST /sticky-notes/notes` to the daemon, so remote browsing through caddy works unchanged. Review sessions are launched with `claude-review` (a fish function adding `--mcp-config` + `--dangerously-load-development-channels server:sticky-notes`).

**Tech Stack:** node 22 (no runtime deps for the server: `node:http`, `node:net`), vitest, `modern-screenshot` (already a dep), Rails engine (railties ≥ 7) + `http.rb`, minitest + rack-test, fish.

**Spec:** `docs/live-delivery.html` (copy of the "Sticky Notes Live Delivery" artifact, https://claude.ai/code/artifact/6d906f70-f8c9-43a0-ab02-01d717bf9cfa). Read the sections "Interfaces and files", "The Send flow", "Choosing the session", "Screenshots", "Failure modes", "Security" before starting.

## Global Constraints

- Naming: the per-session process is the **sticky-notes MCP server**, the shared one the **sticky-notes daemon**. Never "shim".
- Daemon port `47391`, loopback only; token in `~/.cache/sticky-notes/daemon.json` mode `0600`; `daemon.sock`, `daemon.log`, `shots/<session>/<key-slug>-<n>.jpg` next to it. `STICKY_NOTES_HOME` overrides the directory (tests, CI); `STICKY_NOTES_PORT` overrides the port (`0` = ephemeral, tests).
- Screenshots handed to Claude: JPEG, CSS scale 1, long edge ≤ 1568 px, quality 0.85, ≤ 2 MB. Daemon validates JPEG by magic bytes (`FF D8 FF`), names files itself. Download keeps the full-resolution PNG.
- Session picker: exactly one live session selects itself; otherwise last choice per page key from localStorage; otherwise the reviewer picks. "queue for next review session" is an explicit entry, never a default.
- Engine routes exist only when `StickyNotes::Rails.enabled?` (development/staging). The browser never sees port or token on the Rails path.
- Artifacts are out of v1 (Copy Markdown stays). Local `file://` pages use the direct loopback path with a pasted token.
- Code style: CLAUDE.md rules (constants, early return, one-line *why* comments, no swallowed errors, no mocks — tests run the real daemon in a temp `STICKY_NOTES_HOME`). Commits: Conventional Commits, no trailing period. Edit `src/`, never `dist/`; `npm run build` and commit `dist/` in the same commit as the source.
- Version bump to `0.2.0` (package.json + `lib/sticky_notes/rails/version.rb`) in the final task.
- Server tests are node-environment vitest files: first line `// @vitest-environment node`. They live in `test/server/`. Ruby tests in `test/rails/`, run with `bundle exec ruby -Itest test/rails/<file>_test.rb`.

## File structure

```
server/paths.js          cache dir, daemon.json/sock/log/shots paths, DEFAULT_PORT
server/ndjson.js         newline-delimited JSON over a stream (readLines / writeLine)
server/sessions.js       live session table (= open sockets) + queue for "queue" sends
server/shots.js          JPEG validation + file naming under shots/<session>/
server/event.js          POST /notes body + stored shot paths → { content, meta }
server/http.js           daemon HTTP API: GET /sessions, POST /notes, POST /stop, CORS, bearer auth
server/socket.js         unix-socket server: "register" messages → sessions
server/daemon.js         entry: start(), stale-socket handling, daemon.json, signals, `stop` CLI
server/daemon-client.js  MCP-server side: connect to daemon.sock, register, retry 2 s, spawn daemon if missing
server/channel.js        stdio JSON-RPC MCP server declaring claude/channel; notify(content, meta)
server/mcp.js            entry wiring channel.js + daemon-client.js
mcp.json                 Claude Code --mcp-config file (absolute path to server/mcp.js)
contrib/claude-review.fish   launch function (symlinked into ~/.config/fish/functions)
src/slug.js              slug(key) shared by browser and daemon
src/exporter.js          + "screenshot: <path>" lines per row
src/screenshot.js        captureRect → canvas; captureElement; toPng; toJpeg (cap + quality)
src/channel.js           browser client: sessions(), send(payload); Rails path or direct loopback + token
src/picker.js            session <select>: ordering as given, remembered per key, queue entry
src/layer.js             Send button, picker, auto-shot toggle, pending count, attach on focused note, Connect
src/index.js             send(), pending screenshots, auto-shot capture, connect(token)
src/turbo.js, src/stimulus.js   pass data-channel / channel value through
lib/sticky_notes/rails/daemon.rb          http.rb client for daemon.json + ordering for Rails.root
app/controllers/sticky_notes/channel_controller.rb   sessions / notes proxy
config/routes.rb, app/helpers/sticky_notes_helper.rb, app/views/sticky_notes/_tag.html.erb
Gemfile, test/rails/test_helper.rb, test/rails/channel_test.rb
```

## Spike findings

Verified 03.09.2026 against Claude Code 2.1.259 (Task 1 done).

- **cwd** of the MCP server process = Claude Code's cwd (`/home/dev` when launched from `~`). `CLAUDE_PROJECT_DIR` carries the same path.
- **env**: `CLAUDE_CODE_SESSION_ID` (uuid) is set; there is no session-name variable. Also present: `CLAUDE_CODE_MESSAGING_SOCKET` + `CLAUDE_CODE_MESSAGING_TOKEN` (undocumented, untouched), `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli`. → picker label = `basename(cwd)`; the uuid travels in `register` as `claudeSession` for the picker's tooltip.
- **eager spawn**: `initialize` arrives ~1 s after launch, `notifications/initialized` and `tools/list` follow at once; an event pushed 5 s later was rendered as `← sticky-notes: spike hello` and acted on with no user input. Client `protocolVersion` = `2025-11-25`; echoing it back works.
- **resume**: `claude --resume <id>` with both flags restores the conversation and spawns the MCP server (event delivered). **`--continue` is a trap**: it picks the most recent conversation *in the cwd*, which from `~` was a different session. The launcher documents `claude-review --resume <id>` (the id is printed at exit) and never suggests `--continue` from `~`.
- **detached child** (`spawn(..., { detached: true, stdio: "ignore" }).unref()`) survives `/exit` of Claude Code. The MCP server itself is killed (no `stdin end` in its log), so the daemon must never depend on its spawner.
- **Read** of `~/.cache/sticky-notes/shots/spike/test.jpg` from a session rooted at `~` ran without a permission prompt under the default auto mode; the image was understood (10×10 red → "Red.").
- Gotcha for automation: text typed into the prompt via `tmux send-keys` needs a second `Enter`; the prompt box also shows grey *suggested* prompts that look like typed input.

---

### Task 1: Spike the channel contract against Claude Code 2.1.259

**Files:**
- Create: `/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/spike/channel.js`
- Create: `/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/spike/mcp.json`
- Modify: `docs/superpowers/plans/2026-09-03-live-delivery.md` ("Spike findings")

**Interfaces:**
- Produces: the six facts in "Spike findings". Task 7 uses the env-var name for the picker label; Task 12 uses the cwd fact.

- [x] **Step 1: Write the throwaway channel server**

```js
// spike/channel.js — hand-rolled stdio MCP server that declares claude/channel,
// logs what Claude Code hands it, and pushes one event 5 s after initialize.
import { appendFileSync } from "node:fs"
import { spawn } from "node:child_process"

const LOG = "/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/spike/spike.log"
const EVENT_DELAY_MS = 5000
const log = (line) => appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`)
const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n")

log(`start cwd=${process.cwd()} pid=${process.pid}`)
log(`env ${JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("CLAUDE"))))}`)

// detached grandchild: does it survive Claude Code exiting?
const sleeper = spawn("sleep", ["900"], { detached: true, stdio: "ignore" })
sleeper.unref()
log(`sleeper pid=${sleeper.pid}`)

let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i)
    buffer = buffer.slice(i + 1)
    if (line.trim()) handle(JSON.parse(line))
  }
})

function handle(msg) {
  log(`in ${JSON.stringify(msg).slice(0, 300)}`)
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: msg.params.protocolVersion,
      capabilities: { experimental: { "claude/channel": {} }, tools: {} },
      serverInfo: { name: "sticky-notes", version: "spike" },
      instructions: "Events on this channel are review notes. Say 'channel event received' when one arrives.",
    } })
    setTimeout(() => write({ jsonrpc: "2.0", method: "notifications/claude/channel",
      params: { content: "spike hello", meta: { url: "spike://x", count: "1" } } }), EVENT_DELAY_MS)
    return
  }
  if (msg.method === "ping") return write({ jsonrpc: "2.0", id: msg.id, result: {} })
  if (msg.method === "tools/list") return write({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } })
  if (msg.id !== undefined) write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } })
}
```

```json
{ "mcpServers": { "sticky-notes": { "command": "node",
  "args": ["/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/spike/channel.js"] } } }
```

- [x] **Step 2: Launch a review session from `~` (the user runs this in a terminal)**

```fish
cd ~; mkdir -p ~/.cache/sticky-notes/shots/spike; cp ~/Pictures/*.jpg ~/.cache/sticky-notes/shots/spike/test.jpg 2>/dev/null; or convert -size 10x10 xc:red ~/.cache/sticky-notes/shots/spike/test.jpg
claude --mcp-config /tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/spike/mcp.json --dangerously-load-development-channels server:sticky-notes
```
Expected: warning dialog about development channels, banner lists the channel, within ~5 s Claude says "channel event received" (type nothing first — this proves eager spawn and queueing). Then ask: `Read ~/.cache/sticky-notes/shots/spike/test.jpg` and note whether a permission prompt appears. Exit with `/exit`.

- [x] **Step 3: Read the log and check the sleeper**

```bash
cat /tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/spike/spike.log
pgrep -a sleep   # the "sleep 900" from the log must still be running after Claude exited
```
Record: `cwd=`, which `CLAUDE_*` vars exist (look for `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_SESSION_NAME`), whether `initialize` came before you typed anything.

- [x] **Step 4: Continue the session with the flags**

```fish
claude --continue --mcp-config /tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/spike/mcp.json --dangerously-load-development-channels server:sticky-notes
```
Expected: previous conversation restored, a second "start" line in the log, a second "channel event received".

- [x] **Step 5: Write the findings into this plan and kill the sleeper**

Fill "Spike findings" above with the exact values. `pkill -f "sleep 900"`. If any of these fail (no event delivered, no eager spawn), stop and report — the design depends on them.

- [x] **Step 6: Commit the plan**

```bash
cd ~/projects/sticky-notes && git add docs && git commit -m "docs: live delivery design and implementation plan"
```

---

### Task 2: Shared slug + screenshot lines in the exporter

**Files:**
- Create: `src/slug.js`
- Modify: `src/screenshot.js` (replace the local `slug`)
- Modify: `src/exporter.js`
- Test: `test/exporter.test.js`, `test/slug.test.js`

**Interfaces:**
- Produces: `slug(key) → string` (`"/kids/12" → "kids-12"`, empty → `"page"`); exporter rows accept `shots: string[]` and print `screenshot: <path>` lines after the comment. The daemon (Task 4) imports both.

- [ ] **Step 1: Write the failing tests**

`test/slug.test.js`:
```js
import { describe, it, expect } from "vitest"
import { slug } from "../src/slug.js"

describe("slug", () => {
  it("keeps letters and digits, joins the rest with one dash", () => {
    expect(slug("/kids/12")).toBe("kids-12")
    expect(slug("shop domain model")).toBe("shop-domain-model")
  })

  it("falls back to 'page' when nothing survives", () => {
    expect(slug("///")).toBe("page")
    expect(slug("")).toBe("page")
  })
})
```

Append to `test/exporter.test.js` inside `describe("toMarkdown")`:
```js
  it("lists attached screenshots after the comment, indented like it", () => {
    const lines = toMarkdown([row({ shots: ["/home/dev/.cache/sticky-notes/shots/s2/kids-12-1.jpg"] })], META).split("\n")

    expect(lines.slice(3)).toEqual([
      "1. `#report > h2`",
      "   > Quarterly report",
      "   typo",
      "   screenshot: /home/dev/.cache/sticky-notes/shots/s2/kids-12-1.jpg",
      "",
    ])
  })
```

- [ ] **Step 2: Run them, watch them fail**

Run: `npx vitest run test/slug.test.js test/exporter.test.js`
Expected: slug — "Failed to resolve import"; exporter — the screenshot line is missing.

- [ ] **Step 3: Implement**

`src/slug.js`:
```js
/* File-name-safe form of a page key. Shared by the overlay (Download names)
   and the daemon (shots/<session>/<slug>-<n>.jpg), so both sides agree. */
const FALLBACK = "page"

export const slug = (key) => String(key).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || FALLBACK
```

`src/screenshot.js`: add `import { slug } from "./slug.js"` and delete the local `const slug = …` line.

`src/exporter.js`: add `const SCREENSHOT_LINE = "screenshot: "` next to the other constants and extend `markdownRow`:
```js
  return [
    `${row.n}. \`${row.path}\`${flagsOf(row)}`,
    `${pad}> ${row.text || EMPTY_TEXT}`,
    ...(row.ctx ? [`${pad}under: ${row.ctx}`] : []),
    ...comment.split("\n").map((line) => pad + line),
    ...(row.shots ?? []).map((path) => `${pad}${SCREENSHOT_LINE}${path}`),
    "",
  ]
```
Update the module comment: rows are `{ n, path, anchored, text, ctx, note, orphan, shots? }`.

- [ ] **Step 4: Run all tests and lint**

Run: `npm test && npm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/slug.js src/screenshot.js src/exporter.js test/slug.test.js test/exporter.test.js
git commit -m "feat: screenshot lines in markdown export, shared slug"
```

---

### Task 3: Daemon foundations — paths, NDJSON framing, session table

**Files:**
- Create: `server/paths.js`, `server/ndjson.js`, `server/sessions.js`
- Test: `test/server/ndjson.test.js`, `test/server/sessions.test.js`

**Interfaces:**
- Produces:
  - `paths.js`: `DEFAULT_PORT = 47391`, `home()`, `infoPath()`, `sockPath()`, `logPath()`, `shotsDir()`, `daemonPath()` (absolute path of `server/daemon.js`), `port()` (env or default, number).
  - `ndjson.js`: `readLines(stream, onMessage, onError)`, `writeLine(stream, message)`.
  - `sessions.js`: `QUEUE = "queue"`, `createSessions() → { register(socket, { cwd, pid, label, claudeSession? }) → session, list() → [{ id, cwd, pid, label, claudeSession, startedAt }], has(id), deliver(id, event) → { delivered: true } | { queued: true } | null, get queued() }`. Sessions are removed when their socket closes; queued events flush to the next registering session.

- [ ] **Step 1: Write the failing tests**

`test/server/ndjson.test.js`:
```js
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PassThrough } from "node:stream"
import { readLines, writeLine } from "../../server/ndjson.js"

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe("ndjson", () => {
  it("emits one parsed object per line, across chunk boundaries", async () => {
    const stream = new PassThrough()
    const seen = []
    readLines(stream, (msg) => seen.push(msg), () => {})

    stream.write('{"a":1}\n{"b"')
    stream.write(':2}\n\n')
    await tick()

    expect(seen).toEqual([{ a: 1 }, { b: 2 }])
  })

  it("reports a bad line and keeps reading", async () => {
    const stream = new PassThrough()
    const seen = []
    const errors = []
    readLines(stream, (msg) => seen.push(msg), (error) => errors.push(error))

    stream.write("not json\n{\"ok\":true}\n")
    await tick()

    expect(errors).toHaveLength(1)
    expect(seen).toEqual([{ ok: true }])
  })

  it("writes one line per message", () => {
    const stream = new PassThrough()
    writeLine(stream, { type: "event", content: "x" })

    expect(stream.read().toString()).toBe('{"type":"event","content":"x"}\n')
  })
})
```

`test/server/sessions.test.js`:
```js
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PassThrough } from "node:stream"
import { createSessions, QUEUE } from "../../server/sessions.js"

const META = { cwd: "/home/dev/projects/krouzitko", pid: 4242, label: "krouzitko" }
const EVENT = { content: "# Notes", meta: { count: "1" } }

const socket = () => new PassThrough()
const lastLine = (stream) => JSON.parse(String(stream.read()).trim().split("\n").pop())

describe("createSessions", () => {
  it("registers a session and lists it without the socket", () => {
    const sessions = createSessions()
    const session = sessions.register(socket(), META)

    expect(session.id).toMatch(/^s[a-z0-9]+$/)
    expect(sessions.list()).toEqual([{ id: session.id, ...META, claudeSession: null, startedAt: expect.any(String) }])
    expect(sessions.has(session.id)).toBe(true)
  })

  it("forgets a session when its socket closes", () => {
    const sessions = createSessions()
    const stream = socket()
    const { id } = sessions.register(stream, META)

    stream.emit("close")

    expect(sessions.has(id)).toBe(false)
    expect(sessions.list()).toEqual([])
  })

  it("delivers an event as one ndjson line on the session socket", () => {
    const sessions = createSessions()
    const stream = socket()
    const { id } = sessions.register(stream, META)

    expect(sessions.deliver(id, EVENT)).toEqual({ delivered: true })
    expect(lastLine(stream)).toEqual({ type: "event", ...EVENT })
  })

  it("returns null for an unknown session", () => {
    expect(createSessions().deliver("s9", EVENT)).toBeNull()
  })

  it("queues events and flushes them to the next session that registers", () => {
    const sessions = createSessions()

    expect(sessions.deliver(QUEUE, EVENT)).toEqual({ queued: true })
    expect(sessions.queued).toBe(1)

    const stream = socket()
    sessions.register(stream, META)

    expect(sessions.queued).toBe(0)
    expect(lastLine(stream)).toEqual({ type: "event", ...EVENT })
  })
})
```

- [ ] **Step 2: Run them, watch them fail**

Run: `npx vitest run test/server`
Expected: "Failed to resolve import" for both modules.

- [ ] **Step 3: Implement**

`server/paths.js`:
```js
/* Where the daemon keeps its state. STICKY_NOTES_HOME lets tests and CI run
   a private daemon; STICKY_NOTES_PORT=0 asks for an ephemeral port. */
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

export const DEFAULT_PORT = 47391
const HOME_ENV = "STICKY_NOTES_HOME"
const PORT_ENV = "STICKY_NOTES_PORT"

export const home = () => process.env[HOME_ENV] || join(homedir(), ".cache", "sticky-notes")
export const infoPath = () => join(home(), "daemon.json")
export const sockPath = () => join(home(), "daemon.sock")
export const logPath = () => join(home(), "daemon.log")
export const shotsDir = () => join(home(), "shots")
export const port = () => (process.env[PORT_ENV] === undefined ? DEFAULT_PORT : Number(process.env[PORT_ENV]))
export const daemonPath = () => join(dirname(fileURLToPath(import.meta.url)), "daemon.js")
```

`server/ndjson.js`:
```js
/* Newline-delimited JSON, the framing between MCP servers and the daemon. */
const NEWLINE = "\n"

export function readLines(stream, onMessage, onError) {
  let buffer = ""
  stream.setEncoding("utf8")

  stream.on("data", (chunk) => {
    buffer += chunk
    let end

    while ((end = buffer.indexOf(NEWLINE)) >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      if (!line.trim()) continue

      // one bad line must not take the connection down
      try {
        onMessage(JSON.parse(line))
      } catch (error) {
        onError(error)
      }
    }
  })
}

export const writeLine = (stream, message) => stream.write(JSON.stringify(message) + NEWLINE)
```

`server/sessions.js`:
```js
/* The session table is the set of open MCP-server sockets: a session that
   exits drops its socket and disappears. Events for "queue" wait here for the
   next session to register. */
import { writeLine } from "./ndjson.js"

export const QUEUE = "queue"
const ID_RADIX = 36
const ID_PREFIX = "s"

export function createSessions() {
  const live = new Map() // id → { id, cwd, pid, label, startedAt, socket }
  const queued = []
  let counter = 0

  function register(socket, { cwd, pid, label, claudeSession = null }) {
    const id = ID_PREFIX + (++counter).toString(ID_RADIX)
    const session = { id, cwd, pid, label, claudeSession, startedAt: new Date().toISOString(), socket }
    live.set(id, session)
    socket.on("close", () => live.delete(id))

    for (const event of queued.splice(0)) push(session, event)

    return session
  }

  const list = () => [...live.values()].map(({ socket, ...row }) => row) // eslint-disable-line no-unused-vars

  const has = (id) => live.has(id)

  function deliver(id, event) {
    if (id === QUEUE) {
      queued.push(event)
      return { queued: true }
    }

    const session = live.get(id)
    if (!session) return null

    push(session, event)
    return { delivered: true }
  }

  return {
    register,
    list,
    has,
    deliver,
    get queued() {
      return queued.length
    },
  }
}

const push = (session, event) => writeLine(session.socket, { type: "event", ...event })
```

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run test/server && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/paths.js server/ndjson.js server/sessions.js test/server
git commit -m "feat(daemon): paths, ndjson framing and session table"
```

---

### Task 4: Screenshot storage and event building

**Files:**
- Create: `server/shots.js`, `server/event.js`
- Test: `test/server/shots.test.js`, `test/server/event.test.js`

**Interfaces:**
- Consumes: `slug` (Task 2), `toMarkdown` (Task 2).
- Produces:
  - `shots.js`: `MAX_BYTES = 2 MB`, `class ShotError extends Error { status }`, `createShots(dir) → { store(session, key, base64) → absolutePath }`. Files: `<dir>/<session>/<slug(key)>-<n>.jpg`, `n` = existing count for that slug + 1.
  - `event.js`: `buildEvent({ url, key, title, notes }, pathsByNote) → { content, meta: { url, key, count } }` where `pathsByNote[i]` is the array of stored paths for `notes[i]`.

- [ ] **Step 1: Write the failing tests**

`test/server/shots.test.js`:
```js
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
```

`test/server/event.test.js`:
```js
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { buildEvent } from "../../server/event.js"

const BODY = {
  url: "https://krouzitko.oak.hozak.dev/kids/12",
  key: "/kids/12",
  title: "Kid 12",
  notes: [
    { n: 1, path: '#kid-form [name="kid[name]"]', text: "Name", ctx: "Details", note: "Label is cut off", shots: ["ignored-base64"] },
    { n: 2, path: "#kid-form button", text: "Save", ctx: "", note: "" },
  ],
}

describe("buildEvent", () => {
  it("renders the export markdown with stored screenshot paths and string meta", () => {
    const event = buildEvent(BODY, [["/shots/s2/kids-12-1.jpg"], []])

    expect(event.meta).toEqual({ url: BODY.url, key: "/kids/12", count: "2" })
    expect(event.content.split("\n")).toEqual([
      "# Notes on Kid 12",
      BODY.url,
      "",
      '1. `#kid-form [name="kid[name]"]`',
      "   > Name",
      "   under: Details",
      "   Label is cut off",
      "   screenshot: /shots/s2/kids-12-1.jpg",
      "",
      "2. `#kid-form button`",
      "   > Save",
      "   (no comment)",
      "",
    ])
  })

  it("tolerates a body without notes", () => {
    expect(buildEvent({ url: "u", key: "k", title: "t" }, []).meta.count).toBe("0")
  })
})
```

- [ ] **Step 2: Run them, watch them fail**

Run: `npx vitest run test/server/shots.test.js test/server/event.test.js`
Expected: import failures.

- [ ] **Step 3: Implement**

`server/shots.js`:
```js
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
```

`server/event.js`:
```js
/* Turns a POST /notes body into the channel event: the same Markdown the
   overlay exports, with stored screenshot paths per note, plus string meta. */
import { toMarkdown } from "../src/exporter.js"

export function buildEvent({ url = "", key = "", title = "", notes = [] }, pathsByNote) {
  const rows = notes.map((note, index) => ({ ...note, shots: pathsByNote[index] ?? [] }))

  return {
    content: toMarkdown(rows, { title, url }),
    meta: { url, key, count: String(notes.length) },
  }
}
```

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run test/server && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/shots.js server/event.js test/server/shots.test.js test/server/event.test.js
git commit -m "feat(daemon): jpeg storage and channel event building"
```

---

### Task 5: Daemon HTTP API

**Files:**
- Create: `server/http.js`
- Test: `test/server/http.test.js`

**Interfaces:**
- Consumes: `createSessions`, `QUEUE` (Task 3), `createShots`, `ShotError` (Task 4), `buildEvent` (Task 4).
- Produces: `createHttpServer({ token, sessions, shots, onStop, log }) → http.Server` (not yet listening). Routes: `OPTIONS *` → 204 + CORS; `GET /sessions`; `POST /notes`; `POST /stop`. Every non-OPTIONS request needs `Authorization: Bearer <token>` → else 401. JSON errors are `{ error: "<message>" }`. Body limit 16 MB → 413.

- [ ] **Step 1: Write the failing test**

`test/server/http.test.js`:
```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PassThrough } from "node:stream"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHttpServer } from "../../server/http.js"
import { createSessions } from "../../server/sessions.js"
import { createShots } from "../../server/shots.js"

const TOKEN = "t0ken"
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")
const META = { cwd: "/home/dev/projects/krouzitko", pid: 1, label: "krouzitko" }
const note = (shots = []) => ({ n: 1, path: "#a", text: "A", ctx: "", note: "fix", shots })

describe("daemon http api", () => {
  let dir, server, base, sessions, stopped

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "daemon-"))
    sessions = createSessions()
    stopped = false
    server = createHttpServer({ token: TOKEN, sessions, shots: createShots(dir), onStop: () => (stopped = true), log: () => {} })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })

  const call = (path, { method = "GET", body, token = TOKEN } = {}) =>
    fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body && JSON.stringify(body),
    })

  it("answers preflight without a token", async () => {
    const response = await fetch(base + "/notes", { method: "OPTIONS" })

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("access-control-allow-headers")).toMatch(/authorization/i)
  })

  it("rejects a wrong token", async () => {
    expect((await call("/sessions", { token: "nope" })).status).toBe(401)
  })

  it("lists sessions", async () => {
    const { id } = sessions.register(new PassThrough(), META)
    const response = await call("/sessions")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id, ...META, startedAt: expect.any(String) }])
  })

  it("stores screenshots, builds the event and delivers it", async () => {
    const socket = new PassThrough()
    const { id } = sessions.register(socket, META)

    const response = await call("/notes", { method: "POST", body: { session: id, url: "http://x/kids/1", key: "/kids/1", title: "Kid", notes: [note([JPEG])] } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ delivered: true })
    const event = JSON.parse(String(socket.read()).trim())
    expect(event.content).toContain(`screenshot: ${join(dir, id, "kids-1-1.jpg")}`)
    expect(event.meta).toEqual({ url: "http://x/kids/1", key: "/kids/1", count: "1" })
  })

  it("queues when asked to", async () => {
    const response = await call("/notes", { method: "POST", body: { session: "queue", url: "u", key: "k", title: "t", notes: [note()] } })

    expect(await response.json()).toEqual({ queued: true })
    expect(sessions.queued).toBe(1)
  })

  it("is 404 for an unknown session and stores nothing", async () => {
    const response = await call("/notes", { method: "POST", body: { session: "s99", url: "u", key: "k", title: "t", notes: [note([JPEG])] } })

    expect(response.status).toBe(404)
    expect(existsSync(join(dir, "s99"))).toBe(false)
  })

  it("forwards screenshot validation as 415", async () => {
    const { id } = sessions.register(new PassThrough(), META)
    const png = Buffer.from([0x89, 0x50]).toString("base64")
    const response = await call("/notes", { method: "POST", body: { session: id, url: "u", key: "k", title: "t", notes: [note([png])] } })

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: "not a JPEG" })
  })

  it("is 400 for a body that is not json", async () => {
    const response = await fetch(base + "/notes", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{" })

    expect(response.status).toBe(400)
  })

  it("stops on request", async () => {
    expect((await call("/stop", { method: "POST" })).status).toBe(200)
    expect(stopped).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run test/server/http.test.js`
Expected: import failure.

- [ ] **Step 3: Implement**

`server/http.js`:
```js
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
```

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run test/server && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/http.js test/server/http.test.js
git commit -m "feat(daemon): loopback http api with bearer auth and cors"
```

---

### Task 6: Daemon process — socket server, entry point, stop

**Files:**
- Create: `server/socket.js`, `server/daemon.js`
- Modify: `package.json` (`files` + `bin`)
- Test: `test/server/daemon.test.js`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `socket.js`: `createSocketServer({ sessions, log }) → net.Server` (caller listens on `sockPath()`); a `{ type: "register", cwd, pid, label }` line registers the connection.
  - `daemon.js`: `start() → Promise<{ info: { port, token, pid, startedAt }, stop(), stopServers() }>` (`stop` = `stopServers` + exit; `null` when another daemon owns the socket); CLI `node server/daemon.js` runs until SIGTERM/SIGINT or `POST /stop`; `node server/daemon.js stop` stops the running daemon. `daemon.json` is written after listening, mode `0600`; removed with `daemon.sock` on shutdown. A stale socket file (nobody listening) is unlinked; a live one means "already running" → exit 0.
  - `package.json`: `"bin": { "sticky-notes-daemon": "server/daemon.js" }`, `"files"` gains `"server"`.

- [ ] **Step 1: Write the failing test**

`test/server/daemon.test.js`:
```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawn } from "node:child_process"
import { connect } from "node:net"
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { daemonPath } from "../../server/paths.js"
import { readLines, writeLine } from "../../server/ndjson.js"

const STARTUP_MS = 5000
const POLL_MS = 50
const MODE_MASK = 0o777
const OWNER_ONLY = 0o600

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check, timeout = STARTUP_MS) {
  const deadline = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out")
    await wait(POLL_MS)
  }
}

describe("daemon process", () => {
  let home, child

  beforeEach(() => (home = mkdtempSync(join(tmpdir(), "sn-"))))
  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM")
      await new Promise((resolve) => child.on("exit", resolve))
    }
    rmSync(home, { recursive: true, force: true })
  })

  const env = () => ({ ...process.env, STICKY_NOTES_HOME: home, STICKY_NOTES_PORT: "0" })
  const infoFile = () => join(home, "daemon.json")
  const readInfo = () => JSON.parse(readFileSync(infoFile(), "utf8"))
  const startChild = () => (child = spawn(process.execPath, [daemonPath()], { env: env(), stdio: "ignore" }))

  const api = (info, path, method = "GET", body) =>
    fetch(`http://127.0.0.1:${info.port}${path}`, { method, headers: { authorization: `Bearer ${info.token}` }, body: body && JSON.stringify(body) })

  it("writes daemon.json (0600) after listening and serves the socket", async () => {
    startChild()
    await until(() => existsSync(infoFile()))
    const info = readInfo()

    expect(info).toEqual({ port: expect.any(Number), token: expect.stringMatching(/^[0-9a-f]{48}$/), pid: child.pid, startedAt: expect.any(String) })
    expect(statSync(infoFile()).mode & MODE_MASK).toBe(OWNER_ONLY)

    const socket = connect(join(home, "daemon.sock"))
    await new Promise((resolve) => socket.on("connect", resolve))
    writeLine(socket, { type: "register", cwd: "/x", pid: 7, label: "x" })
    const sessions = async () => (await api(info, "/sessions")).json()
    await until(async () => (await sessions()).length === 1)

    expect(await sessions()).toEqual([{ id: "s1", cwd: "/x", pid: 7, label: "x", startedAt: expect.any(String) }])

    const events = []
    readLines(socket, (msg) => events.push(msg), () => {})
    await api(info, "/notes", "POST", { session: "s1", url: "u", key: "k", title: "t", notes: [] })
    await until(() => events.length === 1)

    expect(events[0].type).toBe("event")
    socket.destroy()
  })

  it("stops on POST /stop and cleans up its files", async () => {
    startChild()
    await until(() => existsSync(infoFile()))
    const info = readInfo()

    expect((await api(info, "/stop", "POST")).status).toBe(200)
    await new Promise((resolve) => child.on("exit", resolve))

    expect(existsSync(infoFile())).toBe(false)
    expect(existsSync(join(home, "daemon.sock"))).toBe(false)
  })

  it("`stop` subcommand stops a running daemon", async () => {
    startChild()
    await until(() => existsSync(infoFile()))

    const stopper = spawn(process.execPath, [daemonPath(), "stop"], { env: env(), stdio: "ignore" })
    await new Promise((resolve) => stopper.on("exit", resolve))
    await new Promise((resolve) => child.on("exit", resolve))

    expect(stopper.exitCode).toBe(0)
    expect(existsSync(infoFile())).toBe(false)
  })

  it("exits 0 when another daemon already owns the socket", async () => {
    startChild()
    await until(() => existsSync(infoFile()))

    const second = spawn(process.execPath, [daemonPath()], { env: env(), stdio: "ignore" })
    await new Promise((resolve) => second.on("exit", resolve))

    expect(second.exitCode).toBe(0)
    expect(existsSync(infoFile())).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run test/server/daemon.test.js`
Expected: `daemon.js` not found (spawn exits non-zero, `until` times out).

- [ ] **Step 3: Implement**

`server/socket.js`:
```js
/* Unix-socket side of the daemon: every connection is one MCP server; its
   first message registers it and the connection itself is its liveness. */
import { createServer } from "node:net"
import { readLines } from "./ndjson.js"

const REGISTER = "register"

export function createSocketServer({ sessions, log }) {
  return createServer((socket) => {
    readLines(
      socket,
      (message) => {
        if (message.type !== REGISTER) return log(`socket: ignored ${message.type}`)

        const { id } = sessions.register(socket, message)
        log(`session ${id} registered: ${message.label} (${message.cwd}, pid ${message.pid})`)
        socket.on("close", () => log(`session ${id} gone`))
      },
      (error) => log(`socket: ${error.message}`),
    )
    socket.on("error", (error) => log(`socket: ${error.message}`))
  })
}
```

`server/daemon.js`:
```js
#!/usr/bin/env node
/* The sticky-notes daemon: one per machine.

     page ──POST /notes──▶ Rails engine ──▶ 127.0.0.1:47391 (this) ──daemon.sock──▶ MCP server ──▶ Claude Code

   Holds the live session table, stores screenshots, buffers "queue" sends.
   Spawned detached by the first MCP server that finds no socket; stays until
   `sticky-notes-daemon stop`, POST /stop or a signal. */
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs"
import { connect } from "node:net"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { home, infoPath, sockPath, shotsDir, port } from "./paths.js"
import { createSessions } from "./sessions.js"
import { createShots } from "./shots.js"
import { createHttpServer } from "./http.js"
import { createSocketServer } from "./socket.js"

const LOOPBACK = "127.0.0.1"
const TOKEN_BYTES = 24
const OWNER_ONLY = 0o600
const STOP_COMMAND = "stop"
const STOP_PATH = "/stop"
const EXIT_OK = 0
const EXIT_FAILURE = 1
const EXIT_GRACE_MS = 50

const log = (line) => console.log(`${new Date().toISOString()} ${line}`)

export async function start() {
  mkdirSync(shotsDir(), { recursive: true })
  if (await socketAlive()) return null

  if (existsSync(sockPath())) unlinkSync(sockPath()) // stale: nobody answered

  const sessions = createSessions()
  const shots = createShots(shotsDir())
  const token = randomBytes(TOKEN_BYTES).toString("hex")
  const socketServer = createSocketServer({ sessions, log })
  const httpServer = createHttpServer({ token, sessions, shots, onStop: () => setImmediate(stop), log })

  await listen(socketServer, sockPath())
  await listen(httpServer, port(), LOOPBACK)

  const info = { port: httpServer.address().port, token, pid: process.pid, startedAt: new Date().toISOString() }
  writeFileSync(infoPath(), JSON.stringify(info), { mode: OWNER_ONLY })
  log(`listening on ${LOOPBACK}:${info.port} and ${sockPath()}`)

  // Tests run the daemon in-process and only need the listeners gone.
  function stopServers() {
    httpServer.close()
    socketServer.close()
    for (const file of [infoPath(), sockPath()]) if (existsSync(file)) unlinkSync(file)
  }

  function stop() {
    log("stopping")
    stopServers()
    setTimeout(() => process.exit(EXIT_OK), EXIT_GRACE_MS) // let the /stop reply flush first
  }

  return { info, stop, stopServers }
}

// A socket file with a listener behind it means a daemon is already running.
function socketAlive() {
  if (!existsSync(sockPath())) return Promise.resolve(false)

  return new Promise((resolve) => {
    const probe = connect(sockPath())
    probe.on("connect", () => {
      probe.destroy()
      resolve(true)
    })
    probe.on("error", () => resolve(false))
  })
}

const listen = (server, ...args) =>
  new Promise((resolve, reject) => {
    server.on("error", reject)
    server.listen(...args, resolve)
  })

async function requestStop() {
  if (!existsSync(infoPath())) return log("no daemon.json — not running")

  const { port: daemonPort, token } = JSON.parse(readFileSync(infoPath(), "utf8"))
  const response = await fetch(`http://${LOOPBACK}:${daemonPort}${STOP_PATH}`, { method: "POST", headers: { authorization: `Bearer ${token}` } })
  log(`stop → ${response.status}`)
}

async function main() {
  if (process.argv[2] === STOP_COMMAND) return requestStop()

  const daemon = await start()
  if (!daemon) return log("already running")

  process.on("SIGTERM", daemon.stop)
  process.on("SIGINT", daemon.stop)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log(error.stack)
    process.exit(EXIT_FAILURE)
  })
}
```

`package.json`: add `"server"` to `files`; add `"bin": { "sticky-notes-daemon": "server/daemon.js" }`. `chmod +x server/daemon.js`.

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run test/server && npm run lint`
Expected: green. If the `until(() => false, 200)` sleep proves flaky, poll `/sessions` instead.

- [ ] **Step 5: Manual smoke**

```bash
STICKY_NOTES_HOME=/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/snhome node server/daemon.js & sleep 1
cat /tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/snhome/daemon.json
STICKY_NOTES_HOME=/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/snhome node server/daemon.js stop
```
Expected: json with port 47391, then "stop → 200" and the background job exits.

- [ ] **Step 6: Commit**

```bash
git add server/socket.js server/daemon.js package.json test/server/daemon.test.js
git commit -m "feat(daemon): process entry with unix socket, stop and stale-socket handling"
```

---

### Task 7: Sticky-notes MCP server — channel protocol and daemon client

**Files:**
- Create: `server/channel.js`, `server/daemon-client.js`, `server/mcp.js`
- Test: `test/server/channel.test.js`, `test/server/daemon-client.test.js`

**Interfaces:**
- Consumes: `daemonPath`, `sockPath`, `logPath`, `home` (Task 3); `readLines`/`writeLine` (Task 3); a running daemon (Task 6).
- Produces:
  - `channel.js`: `createChannelServer({ input, output, instructions, version }) → { notify(content, meta) }`. Handles `initialize` (echoes the client's `protocolVersion`, declares `capabilities.experimental["claude/channel"] = {}` and `tools: {}`, returns `instructions`), `notifications/initialized`, `ping`, `tools/list` (empty), anything else with `-32601`. `notify` before initialization is buffered and flushed on `notifications/initialized`.
  - `daemon-client.js`: `connectDaemon({ meta, onEvent, log, retryMs = 2000 }) → { close() }`. Connects to `sockPath()`, sends `register` with `meta`, calls `onEvent({ content, meta })` per `event` line, reconnects every `retryMs` after close, spawns the daemon detached (stdout/stderr → `daemon.log`) when the socket file is missing. `spawnDaemon()` exported for tests.
  - `mcp.js`: entry; `meta = { cwd: process.cwd(), pid: process.pid, label }` where `label` = `process.env.CLAUDE_CODE_SESSION_NAME || basename(cwd)` (adjust to the spike's env-var finding).

- [ ] **Step 1: Write the failing tests**

`test/server/channel.test.js`:
```js
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PassThrough } from "node:stream"
import { createChannelServer } from "../../server/channel.js"

const PROTOCOL = "2025-06-18"
const request = (id, method, params = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
const notification = (method) => JSON.stringify({ jsonrpc: "2.0", method }) + "\n"
const tick = () => new Promise((resolve) => setImmediate(resolve))

function boot() {
  const input = new PassThrough()
  const output = new PassThrough()
  const out = []
  output.on("data", (chunk) => out.push(...String(chunk).split("\n").filter(Boolean).map(JSON.parse)))
  const server = createChannelServer({ input, output, instructions: "review notes", version: "0.2.0" })

  return { input, out, server }
}

describe("createChannelServer", () => {
  it("declares the channel capability and instructions on initialize", async () => {
    const { input, out } = boot()
    input.write(request(1, "initialize", { protocolVersion: PROTOCOL }))
    await tick()

    expect(out[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { experimental: { "claude/channel": {} }, tools: {} },
        serverInfo: { name: "sticky-notes", version: "0.2.0" },
        instructions: "review notes",
      },
    })
  })

  it("answers ping and an empty tools/list, rejects the rest", async () => {
    const { input, out } = boot()
    input.write(request(2, "ping") + request(3, "tools/list") + request(4, "resources/list"))
    await tick()

    expect(out).toEqual([
      { jsonrpc: "2.0", id: 2, result: {} },
      { jsonrpc: "2.0", id: 3, result: { tools: [] } },
      { jsonrpc: "2.0", id: 4, error: { code: -32601, message: "method not found: resources/list" } },
    ])
  })

  it("holds events until initialized, then pushes channel notifications", async () => {
    const { input, out, server } = boot()
    server.notify("# Notes", { count: "1" })
    await tick()
    expect(out).toEqual([])

    input.write(request(1, "initialize", { protocolVersion: PROTOCOL }) + notification("notifications/initialized"))
    await tick()
    server.notify("# More", { count: "2" })
    await tick()

    expect(out.slice(1)).toEqual([
      { jsonrpc: "2.0", method: "notifications/claude/channel", params: { content: "# Notes", meta: { count: "1" } } },
      { jsonrpc: "2.0", method: "notifications/claude/channel", params: { content: "# More", meta: { count: "2" } } },
    ])
  })
})
```

`test/server/daemon-client.test.js`:
```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { start } from "../../server/daemon.js"
import { connectDaemon, spawnDaemon } from "../../server/daemon-client.js"

const POLL_MS = 50
const TIMEOUT_MS = 5000
const RETRY_MS = 100
const META = { cwd: "/home/dev/projects/krouzitko", pid: 99, label: "krouzitko" }

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out")
    await wait(POLL_MS)
  }
}

const api = (info, path, method = "GET", body) =>
  fetch(`http://127.0.0.1:${info.port}${path}`, { method, headers: { authorization: `Bearer ${info.token}` }, body: body && JSON.stringify(body) }).then((r) => r.json())

describe("connectDaemon", () => {
  let home, previousHome, previousPort

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sn-"))
    previousHome = process.env.STICKY_NOTES_HOME
    previousPort = process.env.STICKY_NOTES_PORT
    process.env.STICKY_NOTES_HOME = home
    process.env.STICKY_NOTES_PORT = "0"
  })

  afterEach(() => {
    process.env.STICKY_NOTES_HOME = previousHome
    process.env.STICKY_NOTES_PORT = previousPort
    rmSync(home, { recursive: true, force: true })
  })

  it("registers, receives events, and re-registers after the daemon restarts", async () => {
    let daemon = await start()
    const events = []
    const client = connectDaemon({ meta: META, onEvent: (event) => events.push(event), log: () => {}, retryMs: RETRY_MS })

    await until(async () => (await api(daemon.info, "/sessions")).length === 1)
    expect((await api(daemon.info, "/sessions"))[0]).toMatchObject(META)

    await api(daemon.info, "/notes", "POST", { session: "s1", url: "u", key: "k", title: "t", notes: [] })
    await until(() => events.length === 1)
    expect(events[0].content).toContain("# Notes on t")

    daemon.stopServers() // close listeners without exiting the test process
    daemon = await start()
    await until(async () => (await api(daemon.info, "/sessions")).length === 1)

    client.close()
    daemon.stopServers()
  })

  it("spawns a detached daemon when the socket is missing", async () => {
    spawnDaemon()
    await until(() => existsSync(join(home, "daemon.json")))
    const info = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8"))

    expect(info.pid).not.toBe(process.pid)
    await fetch(`http://127.0.0.1:${info.port}/stop`, { method: "POST", headers: { authorization: `Bearer ${info.token}` } })
    await until(() => !existsSync(join(home, "daemon.json")))
  })
})
```

- [ ] **Step 2: Run them, watch them fail**

Run: `npx vitest run test/server/channel.test.js test/server/daemon-client.test.js`
Expected: import failures.

- [ ] **Step 3: Implement**

`server/channel.js`:
```js
/* The MCP side of the sticky-notes MCP server: a minimal stdio JSON-RPC
   server whose only job is to declare the claude/channel capability and push
   notifications/claude/channel. No tools, no resources, no SDK. */
import { readLines, writeLine } from "./ndjson.js"

const JSONRPC = "2.0"
const SERVER_NAME = "sticky-notes"
const CHANNEL_CAPABILITY = "claude/channel"
const CHANNEL_NOTIFICATION = "notifications/claude/channel"
const INITIALIZED = "notifications/initialized"
const METHOD_NOT_FOUND = -32601

export function createChannelServer({ input, output, instructions, version }) {
  const pending = [] // events that arrived before Claude Code finished the handshake
  let ready = false

  const handlers = {
    initialize: (params) => ({
      protocolVersion: params.protocolVersion,
      capabilities: { experimental: { [CHANNEL_CAPABILITY]: {} }, tools: {} },
      serverInfo: { name: SERVER_NAME, version },
      instructions,
    }),
    ping: () => ({}),
    "tools/list": () => ({ tools: [] }),
  }

  readLines(input, onMessage, (error) => console.error(`channel: ${error.message}`))

  function onMessage(message) {
    if (message.method === INITIALIZED) return flush()
    if (message.id === undefined) return // other notifications need no answer

    const handler = handlers[message.method]
    if (!handler) {
      return writeLine(output, { jsonrpc: JSONRPC, id: message.id, error: { code: METHOD_NOT_FOUND, message: `method not found: ${message.method}` } })
    }

    writeLine(output, { jsonrpc: JSONRPC, id: message.id, result: handler(message.params ?? {}) })
  }

  function flush() {
    ready = true
    for (const event of pending.splice(0)) push(event)
  }

  const push = ({ content, meta }) => writeLine(output, { jsonrpc: JSONRPC, method: CHANNEL_NOTIFICATION, params: { content, meta } })

  function notify(content, meta) {
    if (!ready) return pending.push({ content, meta })

    push({ content, meta })
  }

  return { notify }
}
```

`server/daemon-client.js`:
```js
/* Daemon side of the sticky-notes MCP server. Keeps one socket to the daemon
   open for the life of the session; the socket is the session's liveness. */
import { connect } from "node:net"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs"
import { daemonPath, home, logPath, sockPath } from "./paths.js"
import { readLines, writeLine } from "./ndjson.js"

const DEFAULT_RETRY_MS = 2000
const REGISTER = "register"
const EVENT = "event"

export function connectDaemon({ meta, onEvent, log, retryMs = DEFAULT_RETRY_MS }) {
  let socket = null
  let timer = null
  let closed = false

  function open() {
    if (closed) return
    if (!existsSync(sockPath())) spawnDaemon()

    socket = connect(sockPath())
    socket.on("connect", () => {
      log("connected to daemon")
      writeLine(socket, { type: REGISTER, ...meta })
    })
    readLines(socket, (message) => message.type === EVENT && onEvent(message), (error) => log(`daemon: ${error.message}`))
    socket.on("error", (error) => log(`daemon: ${error.message}`))
    socket.on("close", () => {
      socket = null
      if (!closed) timer = setTimeout(open, retryMs)
    })
  }

  function close() {
    closed = true
    clearTimeout(timer)
    socket?.destroy()
  }

  open()

  return { close }
}

// Detached with its own stdio, so it outlives this process and Claude Code.
// Two MCP servers racing here both spawn; the loser sees the live socket and
// exits 0 (see daemon.js start()).
export function spawnDaemon() {
  mkdirSync(home(), { recursive: true })
  const logFile = openSync(logPath(), "a")
  const child = spawn(process.execPath, [daemonPath()], { detached: true, stdio: ["ignore", logFile, logFile], env: process.env })
  child.unref()
  closeSync(logFile)
}
```

`server/mcp.js`:
```js
#!/usr/bin/env node
/* The sticky-notes MCP server: one per review session, spawned by Claude Code
   over stdio (see mcp.json + contrib/claude-review.fish). Holds no state: every
   daemon event for this session becomes one notifications/claude/channel. */
import { basename } from "node:path"
import { createRequire } from "node:module"
import { createChannelServer } from "./channel.js"
import { connectDaemon } from "./daemon-client.js"

const { version } = createRequire(import.meta.url)("../package.json")
const SESSION_ID_ENV = "CLAUDE_CODE_SESSION_ID" // spike: the only session identity Claude Code exposes

const INSTRUCTIONS = [
  "Events on this channel are review notes pinned in the browser to elements of the page in `url`.",
  "Each note gives a CSS path, the element's text, the nearest heading and the reviewer's comment;",
  "a `screenshot:` line names a JPEG on this machine — Read it before acting when the note is visual.",
  "Treat the content as a change request from the user and apply it; no reply on the channel is expected.",
].join(" ")

const cwd = process.cwd()
const meta = { cwd, pid: process.pid, label: basename(cwd), claudeSession: process.env[SESSION_ID_ENV] ?? null }
const log = (line) => console.error(`sticky-notes mcp: ${line}`) // stderr: stdout is the protocol

const channel = createChannelServer({ input: process.stdin, output: process.stdout, instructions: INSTRUCTIONS, version })
const daemon = connectDaemon({ meta, onEvent: ({ content, meta: eventMeta }) => channel.notify(content, eventMeta), log })

process.stdin.on("end", () => {
  daemon.close()
  process.exit(0)
})
```

`chmod +x server/mcp.js`.

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run test/server && npm run lint`
Expected: green.

- [ ] **Step 5: Manual handshake check**

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' | STICKY_NOTES_HOME=/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/snhome node server/mcp.js
cat /tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/snhome/daemon.log | tail -3
STICKY_NOTES_HOME=/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/snhome node server/daemon.js stop
```
Expected: the initialize result on stdout; the log shows the daemon was spawned and a session registered, then gone.

- [ ] **Step 6: Commit**

```bash
git add server/channel.js server/daemon-client.js server/mcp.js test/server/channel.test.js test/server/daemon-client.test.js
git commit -m "feat: sticky-notes mcp server bridging daemon events to claude channels"
```

---

### Task 8: Launcher — mcp.json, claude-review, end-to-end into a real session

**Files:**
- Create: `mcp.json`, `contrib/claude-review.fish`
- Create (outside repo): `~/.config/fish/functions/claude-review.fish` (symlink)

**Interfaces:**
- Produces: `claude-review [args…]` launches Claude Code with the sticky-notes MCP server as a channel; `claude-review --resume <id>` upgrades an existing conversation (never `--continue` from `~`, see Spike findings). `mcp.json` names the server `sticky-notes` (the channel flag refers to it as `server:sticky-notes`).

- [ ] **Step 1: Write the files**

`mcp.json` (absolute path: `--mcp-config` resolves `args` against Claude's cwd, not the file):
```json
{
  "mcpServers": {
    "sticky-notes": {
      "command": "node",
      "args": ["/home/dev/projects/sticky-notes/server/mcp.js"]
    }
  }
}
```

`contrib/claude-review.fish`:
```fish
# Start a Claude Code session that receives sticky-notes events. Both flags
# are needed; keeping them together is the point. To upgrade a running
# session: /exit, then `claude-review --resume <id>` (the id is printed at
# exit). Not --continue: from ~ it picks whichever conversation was last.
# Install: ln -sf ~/projects/sticky-notes/contrib/claude-review.fish ~/.config/fish/functions/
function claude-review --description "Claude Code with the sticky-notes channel"
    claude --mcp-config ~/projects/sticky-notes/mcp.json \
        --dangerously-load-development-channels server:sticky-notes $argv
end
```

```fish
ln -sf ~/projects/sticky-notes/contrib/claude-review.fish ~/.config/fish/functions/claude-review.fish
```

- [ ] **Step 2: End-to-end with a real session (user in a terminal)**

```fish
cd ~/projects/krouzitko; claude-review
```
Expected: banner lists the `sticky-notes` channel; `ls ~/.cache/sticky-notes/` shows `daemon.json daemon.sock daemon.log shots`.

In another shell:
```bash
info=$(cat ~/.cache/sticky-notes/daemon.json); port=$(echo "$info" | python3 -c 'import json,sys;print(json.load(sys.stdin)["port"])'); token=$(echo "$info" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
curl -s -H "authorization: Bearer $token" http://127.0.0.1:$port/sessions
curl -s -H "authorization: Bearer $token" -H 'content-type: application/json' -d '{"session":"s1","url":"http://x/kids/1","key":"/kids/1","title":"Kid","notes":[{"n":1,"path":"#a","text":"A","ctx":"","note":"say hello back"}]}' http://127.0.0.1:$port/notes
```
Expected: sessions lists cwd `/home/dev/projects/krouzitko`, label per spike; the POST returns `{"delivered":true}` and Claude reacts to the note in the terminal. Exit Claude; `/sessions` is now `[]`; the daemon is still running.

- [ ] **Step 3: Commit**

```bash
git add mcp.json contrib/claude-review.fish
git commit -m "feat: claude-review launcher and mcp config"
```

---

### Task 9: Overlay — canvas capture, JPEG conversion, element capture, browser channel client

**Files:**
- Modify: `src/screenshot.js`
- Modify: `src/layer.js` (screenshot() uses the new capture API)
- Create: `src/channel.js`
- Test: `test/server/channel-client.test.js` (node env, real daemon)

**Interfaces:**
- Produces:
  - `screenshot.js`: `captureRect(doc, rect) → Promise<HTMLCanvasElement>`; `captureElement(doc, el, padding) → Promise<HTMLCanvasElement>`; `toPng(canvas) → Promise<Blob>`; `toJpeg(canvas, { maxEdge = JPEG_MAX_EDGE, quality = JPEG_QUALITY }) → Promise<string>` (base64, no data-URL prefix); constants `JPEG_MAX_EDGE = 1568`, `JPEG_QUALITY = 0.85`. `download`, `copyImage`, `selectRect`, `screenshotFileName` unchanged.
  - `channel.js`: `createChannel({ base, token = null, fetch }) → { sessions() → Promise<Session[]>, send(payload) → Promise<{ delivered } | { queued }> }`; `class ChannelError extends Error { status }`; `DIRECT_BASE = "http://127.0.0.1:47391"`; `TOKEN_KEY = "sticky-notes:daemon-token"`; `readToken(storage)`, `saveToken(storage, token)`; `detectChannel({ base, storage, fetch }) → channel | null` (base wins, then a stored token → direct, else null).

- [ ] **Step 1: Write the failing test for the channel client**

`test/server/channel-client.test.js` (runs the real daemon; `fetch` is node's):
```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PassThrough } from "node:stream"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createChannel, detectChannel, ChannelError, saveToken, readToken, TOKEN_KEY } from "../../src/channel.js"
import { createHttpServer } from "../../server/http.js"
import { createSessions } from "../../server/sessions.js"
import { createShots } from "../../server/shots.js"

const TOKEN = "abc"
const META = { cwd: "/p", pid: 1, label: "p" }

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

describe("browser channel client", () => {
  let dir, server, base, sessions

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "chan-"))
    sessions = createSessions()
    server = createHttpServer({ token: TOKEN, sessions, shots: createShots(dir), onStop: () => {}, log: () => {} })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })

  it("lists sessions and sends notes with the bearer token", async () => {
    const socket = new PassThrough()
    const { id } = sessions.register(socket, META)
    const channel = createChannel({ base, token: TOKEN, fetch })

    expect(await channel.sessions()).toEqual([{ id, ...META, startedAt: expect.any(String) }])
    expect(await channel.send({ session: id, url: "u", key: "k", title: "t", notes: [] })).toEqual({ delivered: true })
    expect(JSON.parse(String(socket.read())).type).toBe("event")
  })

  it("throws a ChannelError carrying status and daemon message", async () => {
    const channel = createChannel({ base, token: TOKEN, fetch })

    await expect(channel.send({ session: "s9", url: "u", key: "k", title: "t", notes: [] })).rejects.toMatchObject({ status: 404, message: "unknown session" })
    await expect(createChannel({ base, token: "wrong", fetch }).sessions()).rejects.toBeInstanceOf(ChannelError)
  })

  it("detects the rails path first, then a stored token, else nothing", () => {
    const storage = fakeStorage()

    expect(detectChannel({ base: "/sticky-notes", storage, fetch })).not.toBeNull()
    expect(detectChannel({ base: undefined, storage, fetch })).toBeNull()

    saveToken(storage, TOKEN)
    expect(readToken(storage)).toBe(TOKEN)
    expect(storage.getItem(TOKEN_KEY)).toBe(TOKEN)
    expect(detectChannel({ base: undefined, storage, fetch })).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run test/server/channel-client.test.js`
Expected: import failure for `src/channel.js`.

- [ ] **Step 3: Implement `src/channel.js`**

```js
/* Browser side of live delivery. Two transports, one interface:
   - Rails path: same-origin `${base}/sessions|notes`, the engine adds the token
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

export function detectChannel({ base, storage, fetch }) {
  if (base) return createChannel({ base, fetch })

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
```

- [ ] **Step 4: Rework `src/screenshot.js` capture API**

Replace the import and `captureRect`, add the new functions:
```js
import { domToCanvas } from "modern-screenshot"

const JPEG = "image/jpeg"
export const JPEG_MAX_EDGE = 1568 // px; Claude's token cost follows pixel area
export const JPEG_QUALITY = 0.85

// Renders the whole document shifted by (-x, -y) into a w×h viewport — the
// library clips to width/height, so only the rectangle gets rasterised.
export function captureRect(doc, { x, y, w, h }) {
  const view = doc.defaultView

  return domToCanvas(doc.documentElement, {
    width: w,
    height: h,
    scale: view.devicePixelRatio || 1,
    style: { transform: `translate(${-x}px, ${-y}px)`, transformOrigin: "top left" },
    filter: (node) => !EXCLUDED.some((cls) => node.classList?.contains(cls)),
  })
}

// The element's box plus padding, clamped to the document — auto-shot uses it.
export function captureElement(doc, el, padding = 0) {
  const view = doc.defaultView
  const page = doc.documentElement
  const box = el.getBoundingClientRect()
  const x = Math.max(0, Math.round(box.left + view.scrollX - padding))
  const y = Math.max(0, Math.round(box.top + view.scrollY - padding))
  const w = Math.min(page.scrollWidth - x, Math.round(box.width + 2 * padding))
  const h = Math.min(page.scrollHeight - y, Math.round(box.height + 2 * padding))

  return captureRect(doc, { x, y, w, h })
}

export const toPng = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, PNG))

// CSS scale (device pixels divided by dpr), long edge capped, JPEG → base64.
export async function toJpeg(canvas, { maxEdge = JPEG_MAX_EDGE, quality = JPEG_QUALITY } = {}) {
  const doc = canvas.ownerDocument
  const view = doc.defaultView
  const dpr = view.devicePixelRatio || 1
  const cssWidth = canvas.width / dpr
  const cssHeight = canvas.height / dpr
  const factor = Math.min(1, maxEdge / Math.max(cssWidth, cssHeight))

  const out = doc.createElement("canvas")
  out.width = Math.round(cssWidth * factor)
  out.height = Math.round(cssHeight * factor)
  out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height)

  const blob = await new Promise((resolve) => out.toBlob(resolve, JPEG, quality))
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new view.FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

  return dataUrl.slice(dataUrl.indexOf(",") + 1)
}
```

In `src/layer.js` `screenshot()`: replace `const blob = await captureRect(doc, area)` with
```js
      const canvas = await captureRect(doc, area)
      const blob = await toPng(canvas)
```
and import `toPng` from `./screenshot.js`. Behaviour is unchanged for now (attachment comes in Task 11).

- [ ] **Step 5: Run everything, build**

Run: `npm test && npm run lint && npm run build`
Expected: green; `dist/` rebuilt.

- [ ] **Step 6: Browser check of the JPEG path (Playwright, chromium, 1920×1080)**

Serve the existing test page from the earlier screenshot experiment (`/tmp/claude-1000/-home-dev/688bda45-2c95-40a2-8faf-5ff535c8f4ec/scratchpad/snap/`, or any page with `dist/sticky-notes.iife.js` injected) and run:
```js
const instance = StickyNotes.mount({ key: "jpeg-check" })
// captureRect/toJpeg are internal: reach them through the module build in a <script type=module> or expose temporarily via window in the test page
```
Simplest: add to the test page `<script type="module">import { captureRect, toJpeg } from "/dist/sticky-notes.js"; window.__shot = async () => toJpeg(await captureRect(document, { x: 0, y: 0, w: 2400, h: 900 }))</script>`, then in Playwright `const b64 = await page.evaluate(() => window.__shot())`, decode to a file, check with `file` that it is a JPEG with long edge 1568 and size well under 2 MB. Note: `captureRect`/`toJpeg` are not part of the public entry — export them from `src/index.js` only if this check needs it; otherwise import from `dist/` chunk is fine because vite emits `screenshot.js` as a shared chunk name only if split — verify the actual emitted file name and adjust the import.

- [ ] **Step 7: Commit**

```bash
git add src/screenshot.js src/layer.js src/channel.js dist test/server/channel-client.test.js
git commit -m "feat: canvas capture with jpeg conversion and browser channel client"
```

---

### Task 10: Session picker

**Files:**
- Create: `src/picker.js`
- Test: `test/picker.test.js` (jsdom)

**Interfaces:**
- Produces: `createPicker({ doc, storage, key, onOpen }) → { el: HTMLSelectElement, refresh(sessions), get value() }`. `refresh` rebuilds the options in the given order plus the queue entry; selection rule per Global Constraints; the choice is stored under `sticky-notes:session:<key>`; `value` is `""` while nothing is chosen. `onOpen` fires on `focus`/`mousedown` of the select so the caller can refresh the list. Constants: `QUEUE = "queue"`, `QUEUE_LABEL = "queue for next review session"`, `PICK_LABEL = "pick a session…"`.

- [ ] **Step 1: Write the failing test**

`test/picker.test.js`:
```js
import { describe, it, expect, beforeEach } from "vitest"
import { createPicker, QUEUE, QUEUE_LABEL, PICK_LABEL } from "../src/picker.js"

const KEY = "/kids/12"
const STORAGE_KEY = "sticky-notes:session:/kids/12"
const A = { id: "s1", cwd: "/home/dev/projects/krouzitko", label: "krouzitko" }
const B = { id: "s2", cwd: "/home/dev", label: "home" }

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

describe("createPicker", () => {
  let storage, opened

  beforeEach(() => {
    storage = fakeStorage()
    opened = 0
  })

  const picker = () => createPicker({ doc: document, storage, key: KEY, onOpen: () => opened++ })
  const labels = (el) => [...el.options].map((o) => o.textContent)

  it("selects the only live session by itself", () => {
    const p = picker()
    p.refresh([A])

    expect(p.value).toBe("s1")
    expect(labels(p.el)).toEqual(["krouzitko · /home/dev/projects/krouzitko", QUEUE_LABEL])
  })

  it("keeps the order it is given and asks to pick when there are several", () => {
    const p = picker()
    p.refresh([B, A])

    expect(p.value).toBe("")
    expect(labels(p.el)).toEqual([PICK_LABEL, "home · /home/dev", "krouzitko · /home/dev/projects/krouzitko", QUEUE_LABEL])
  })

  it("remembers the choice per key and restores it while that session is live", () => {
    const p = picker()
    p.refresh([A, B])
    p.el.value = "s2"
    p.el.dispatchEvent(new Event("change"))

    expect(storage.data.get(STORAGE_KEY)).toBe("s2")

    const again = picker()
    again.refresh([A, B])
    expect(again.value).toBe("s2")

    again.refresh([A])
    expect(again.value).toBe("s1") // the remembered one is gone; single live session wins
  })

  it("offers only the queue when nothing is live, without preselecting it", () => {
    const p = picker()
    p.refresh([])

    expect(labels(p.el)).toEqual([PICK_LABEL, QUEUE_LABEL])
    expect(p.value).toBe("")

    p.el.value = QUEUE
    p.el.dispatchEvent(new Event("change"))
    expect(p.value).toBe(QUEUE)
  })

  it("reports when it is opened", () => {
    const p = picker()
    p.el.dispatchEvent(new Event("focus"))
    p.el.dispatchEvent(new Event("mousedown"))

    expect(opened).toBe(2)
  })
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run test/picker.test.js`
Expected: import failure.

- [ ] **Step 3: Implement `src/picker.js`**

```js
/* Which Claude Code session gets the notes. The daemon lists them (already
   ordered by the engine for this app); the reviewer decides. One live session
   picks itself; "queue" is always an explicit choice. */
export const QUEUE = "queue"
export const QUEUE_LABEL = "queue for next review session"
export const PICK_LABEL = "pick a session…"

const CLASS = "sticky-notes-bar__picker"
const STORAGE_PREFIX = "sticky-notes:session:"
const SEPARATOR = " · "
const NONE = ""

export function createPicker({ doc, storage, key, onOpen }) {
  const el = doc.createElement("select")
  el.className = CLASS
  el.setAttribute("aria-label", PICK_LABEL)

  el.addEventListener("focus", onOpen)
  el.addEventListener("mousedown", onOpen)
  el.addEventListener("change", () => remember(el.value))

  function refresh(sessions) {
    const chosen = choose(sessions)
    el.innerHTML = ""

    if (!chosen) el.append(option(NONE, PICK_LABEL, { disabled: true }))
    for (const session of sessions) el.append(option(session.id, session.label + SEPARATOR + session.cwd))
    el.append(option(QUEUE, QUEUE_LABEL))

    el.value = chosen ?? NONE
  }

  function choose(sessions) {
    if (sessions.length === 1) return sessions[0].id

    const remembered = recall()
    return sessions.some((session) => session.id === remembered) ? remembered : null
  }

  function option(value, text, { disabled = false } = {}) {
    const node = doc.createElement("option")
    node.value = value
    node.textContent = text
    node.disabled = disabled

    return node
  }

  function remember(id) {
    try {
      storage.setItem(STORAGE_PREFIX + key, id)
    } catch {
      // private mode: the choice lasts for this page view
    }
  }

  function recall() {
    try {
      return storage.getItem(STORAGE_PREFIX + key)
    } catch {
      return null
    }
  }

  return {
    el,
    refresh,
    get value() {
      return el.value
    },
  }
}
```

- [ ] **Step 4: Run tests and lint**

Run: `npm test && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/picker.js test/picker.test.js
git commit -m "feat: session picker with remembered choice and explicit queue"
```

---

### Task 11: Overlay — Send, attach screenshots, auto-shot, Connect

**Files:**
- Modify: `src/index.js`, `src/layer.js`, `src/style.css`, `src/turbo.js`, `src/stimulus.js`
- Test: `test/send.test.js` (jsdom)

**Interfaces:**
- Consumes: `createChannel`/`detectChannel`/`saveToken`/`DIRECT_BASE` (Task 9), `createPicker`/`QUEUE` (Task 10), `captureElement`/`toJpeg`/`toPng` (Task 9).
- Produces:
  - `createStickyNotes(options)` new options: `channel` (string base URL, or an object `{ sessions(), send(payload) }`; undefined → detect from storage token), `fetch` (default `globalThis.fetch`).
  - Instance: `send() → Promise<result | null>`, `attachScreenshot(noteId, jpegBase64)`, `connect(token)`, `get channel()`.
  - Layer: `setChannel(on)`, `session()` (picker value), `elementOf(id)`, `setShots(count)`, `setAutoShot(on)`, callbacks `onSend`, `onShot(noteId, jpegBase64)`, `onAutoShot(on)`, `onConnect`, `onSessionsOpen`, `picker` prop `refreshSessions(list)`.
  - `turbo.js` passes `channel: el.dataset.channel`; `stimulus.js` adds `channel: String` value.
  - Storage keys: `sticky-notes:pending:<key>` (count of unsent screenshots), `sticky-notes:auto-shot` (`"0"` = off).
  - Payload: `{ session, url, key, title, notes: [{ n, path, anchored, text, ctx, note, orphan, shots }] }`.

- [ ] **Step 1: Write the failing test**

`test/send.test.js` — an in-memory channel object that records payloads is a real implementation of the channel interface (a host could plug one in), not a mock library:
```js
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createStickyNotes } from "../src/index.js"

const KEY = "/kids/12"
const JPEG = "/9j/4AAQ" // any base64; the overlay never inspects it

function fakeStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
}

function memoryChannel(sessions = [{ id: "s1", cwd: "/p", label: "p" }]) {
  const sent = []
  return { sent, sessions: async () => sessions, send: async (payload) => (sent.push(payload), { delivered: true }) }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("send", () => {
  let storage, channel, instance

  beforeEach(async () => {
    document.body.innerHTML = '<main><h2 id="title">Kid 12</h2><button id="save">Save</button></main>'
    storage = fakeStorage()
    channel = memoryChannel()
    instance = createStickyNotes({ key: KEY, storage, channel }).mount()
    instance.setAutoShot(false) // jsdom has no canvas
    await tick() // sessions() resolved, picker filled
  })

  afterEach(() => instance.unmount())

  it("shows the send controls only when a channel exists", () => {
    expect(document.querySelector('[data-command="send"]').hidden).toBe(false)

    const without = createStickyNotes({ key: "/other", storage, channel: null, root: document.body }).mount()
    expect(document.querySelectorAll('[data-command="send"]')[1].hidden).toBe(true)
    expect(document.querySelectorAll('[data-command="connect"]')[1].hidden).toBe(false)
    without.unmount()
  })

  it("sends the export rows with attached screenshots to the picked session", async () => {
    instance.toggle(true)
    document.getElementById("save").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    const [note] = instance.notes
    instance.attachScreenshot(note.id, JPEG)

    expect(document.querySelector(".sticky-notes-bar__shots").textContent).toBe("1 shot")

    const result = await instance.send()

    expect(result).toEqual({ delivered: true })
    expect(channel.sent[0]).toEqual({
      session: "s1",
      url: location.href,
      key: KEY,
      title: document.title,
      notes: [expect.objectContaining({ n: 1, path: "#save", text: "Save", shots: [JPEG] })],
    })
    expect(document.querySelector(".sticky-notes-bar__shots").textContent).toBe("")
  })

  it("refuses to send while no session is picked", async () => {
    const multi = memoryChannel([{ id: "s1", cwd: "/a", label: "a" }, { id: "s2", cwd: "/b", label: "b" }])
    const other = createStickyNotes({ key: "/multi", storage, channel: multi }).mount()
    await tick()

    expect(await other.send()).toBeNull()
    expect(multi.sent).toEqual([])
    other.unmount()
  })

  it("warns about screenshots lost on reload", () => {
    storage.setItem("sticky-notes:pending:/lost", "2")
    const lost = createStickyNotes({ key: "/lost", storage, channel }).mount()

    // the last bar on the page belongs to the instance mounted last
    expect([...document.querySelectorAll(".sticky-notes-bar__message")].at(-1).textContent).toBe("2 screenshots lost")
    expect(storage.data.get("sticky-notes:pending:/lost")).toBe("0")
    lost.unmount()
  })

  it("connects the direct path from a pasted token", () => {
    const bare = createStickyNotes({ key: "/file", storage, channel: null, fetch: async () => new Response("[]") }).mount()
    bare.connect("t0ken")

    expect(storage.data.get("sticky-notes:daemon-token")).toBe("t0ken")
    expect(bare.channel).not.toBeNull()
    bare.unmount()
  })
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run test/send.test.js`
Expected: `setAutoShot is not a function` / send controls missing.

- [ ] **Step 3: Implement `src/index.js` changes**

Add imports and constants:
```js
import { createChannel, detectChannel, saveToken, DIRECT_BASE } from "./channel.js"
import { captureElement, toJpeg } from "./screenshot.js"

const PENDING_PREFIX = "sticky-notes:pending:"
const AUTO_SHOT_KEY = "sticky-notes:auto-shot"
const AUTO_SHOT_OFF = "0"
const AUTO_SHOT_PADDING = 16 // px around the noted element
const SENT_MESSAGE = "sent"
const QUEUED_MESSAGE = "queued for the next review session"
const PICK_SESSION_MESSAGE = "pick a session first"
const NO_DAEMON_MESSAGE = "no daemon"
const SEND_FAILED_MESSAGE = "send failed"
const LOST_MESSAGE = (n) => `${n} screenshots lost`
const TOKEN_PROMPT = "sticky-notes daemon token (from ~/.cache/sticky-notes/daemon.json)"
```

Inside `createStickyNotes`:
```js
  const storage = options.storage ?? localStorage
  const store = createStore(storage, key)
  const fetchFn = options.fetch ?? globalThis.fetch?.bind(globalThis)
  const pending = new Map() // note id → [jpeg base64], until sent

  let channel = resolveChannel(options.channel)
  let autoShot = readAutoShot()

  function resolveChannel(given) {
    if (given && typeof given === "object") return given

    return detectChannel({ base: given, storage, fetch: fetchFn })
  }
```

`mount()` — after `layer.mount()`:
```js
    layer.setChannel(!!channel)
    layer.setAutoShot(autoShot)
    reportLost()
    refreshSessions()
```

New functions:
```js
  function reportLost() {
    const lost = Number(read(PENDING_PREFIX + key)) || 0
    write(PENDING_PREFIX + key, "0")
    if (lost) layer.message(LOST_MESSAGE(lost))
  }

  async function refreshSessions() {
    if (!channel) return

    try {
      layer.refreshSessions(await channel.sessions())
    } catch (error) {
      layer.message(`${NO_DAEMON_MESSAGE}: ${error.message}`)
      throw error
    }
  }

  function attachScreenshot(id, jpeg) {
    if (!channel || !id) return

    pending.set(id, [...(pending.get(id) ?? []), jpeg])
    countPending()
  }

  function countPending() {
    const count = [...pending.values()].reduce((sum, shots) => sum + shots.length, 0)
    write(PENDING_PREFIX + key, String(count))
    layer.setShots(count)
  }

  async function send() {
    if (!channel) return null

    const session = layer.session()
    if (!session) {
      layer.message(PICK_SESSION_MESSAGE)
      return null
    }

    const doc = (root ?? document.body).ownerDocument
    const rows = notes.map((note, index) => ({ ...toRow(note, index), shots: pending.get(note.id) ?? [] }))
    if (autoShot) await autoShots(doc, rows)

    const payload = { session, url: doc.defaultView.location.href, key, title: doc.title, notes: rows }

    try {
      const result = await channel.send(payload)
      pending.clear()
      countPending()
      layer.message(result.queued ? QUEUED_MESSAGE : SENT_MESSAGE)

      return result
    } catch (error) {
      layer.message(`${SEND_FAILED_MESSAGE}: ${error.message}`)
      throw error
    }
  }

  // Every noted element without a manual screenshot gets one, so Claude sees
  // what the note points at.
  async function autoShots(doc, rows) {
    for (const [index, note] of notes.entries()) {
      if (rows[index].shots.length) continue

      const el = layer.elementOf(note.id)
      if (!el) continue

      rows[index].shots = [await toJpeg(await captureElement(doc, el, AUTO_SHOT_PADDING))]
    }
  }

  function setAutoShot(on) {
    autoShot = on
    write(AUTO_SHOT_KEY, on ? "" : AUTO_SHOT_OFF)
    layer?.setAutoShot(on)
  }

  // function declaration on purpose: `let autoShot = readAutoShot()` runs before this line
  function readAutoShot() {
    return read(AUTO_SHOT_KEY) !== AUTO_SHOT_OFF
  }

  function connect(token = promptToken()) {
    if (!token) return

    saveToken(storage, token)
    channel = createChannel({ base: DIRECT_BASE, token, fetch: fetchFn })
    layer?.setChannel(true)
    refreshSessions()
  }

  const promptToken = () => (root ?? document.body).ownerDocument.defaultView.prompt?.(TOKEN_PROMPT)

  function read(name) {
    try {
      return storage.getItem(name)
    } catch {
      return null
    }
  }

  function write(name, value) {
    try {
      storage.setItem(name, value)
    } catch {
      // private mode: state lasts for this page view
    }
  }
```

`createLayer` call gains callbacks:
```js
    layer = createLayer({
      root, key, storage,
      onPick, onChange: save, onRemove, onClear: clear, onExport: exportNotes,
      onSend: send, onShot: attachScreenshot, onAutoShot: setAutoShot, onConnect: () => connect(), onSessionsOpen: refreshSessions,
    })
```

Instance additions: `send, attachScreenshot, setAutoShot, connect, get channel() { return channel }`.

- [ ] **Step 4: Implement `src/layer.js` changes**

Imports/constants:
```js
import { selectRect, captureRect, toPng, toJpeg, screenshotFileName, download, copyImage } from "./screenshot.js"
import { createPicker } from "./picker.js"

const SEND_COMMAND = "send"
const AUTO_SHOT_COMMAND = "auto-shot"
const CONNECT_COMMAND = "connect"
const SEND_LABEL = "Send"
const AUTO_SHOT_LABEL = "auto-shot"
const CONNECT_LABEL = "Connect"
const ATTACHED_MESSAGE = (n) => `attached to #${n}`
const SHOTS_LABEL = (n) => (n ? `${n} shot${n === 1 ? "" : "s"}` : "")
const SEND_ATTRIBUTE = "data-send"
const CONNECT_ATTRIBUTE = "data-connect"
```

`createLayer` signature: `({ root, key, storage, onPick, onChange, onRemove, onClear, onExport, onSend, onShot, onAutoShot, onConnect, onSessionsOpen })`; new state `let picker = null`, `let shotsEl = null`, `let autoShotInput = null`, `let lastFocusedId = null`.

Bar markup — insert after the Download button:
```html
      <button class="sticky-notes-bar__button" type="button" data-command="${SEND_COMMAND}" ${SEND_ATTRIBUTE} hidden>${SEND_LABEL}</button>
      <label class="sticky-notes-bar__auto" ${SEND_ATTRIBUTE} hidden><input type="checkbox" data-command="${AUTO_SHOT_COMMAND}"> ${AUTO_SHOT_LABEL}</label>
      <span class="sticky-notes-bar__shots" ${SEND_ATTRIBUTE} hidden></span>
      <button class="sticky-notes-bar__button" type="button" data-command="${CONNECT_COMMAND}" ${CONNECT_ATTRIBUTE}>${CONNECT_LABEL}</button>
```
After `bar.innerHTML`:
```js
    picker = createPicker({ doc, storage, key, onOpen: onSessionsOpen })
    picker.el.setAttribute(SEND_ATTRIBUTE, "")
    picker.el.hidden = true
    bar.querySelector(`[data-command="${SEND_COMMAND}"]`).before(picker.el)
    shotsEl = bar.querySelector(".sticky-notes-bar__shots")
    autoShotInput = bar.querySelector(`[data-command="${AUTO_SHOT_COMMAND}"]`)
```

`onBarClick` additions:
```js
    if (command === SEND_COMMAND) onSend()
    if (command === AUTO_SHOT_COMMAND) onAutoShot(event.target.checked)
    if (command === CONNECT_COMMAND) onConnect()
```

`screenshot()` — after `downloadButton.disabled = false`:
```js
      if (lastFocusedId) {
        onShot(lastFocusedId, await toJpeg(canvas))
        message(ATTACHED_MESSAGE(indexOf(lastFocusedId)))
      } else {
        const copied = await copyImage(view, blob)
        message(copied ? COPIED_MESSAGE : NOT_COPIED_MESSAGE)
      }
```
with `const indexOf = (id) => notes.findIndex((note) => note.id === id) + 1`.

In `buildNote`, after the textarea `input` listener:
```js
    text.addEventListener("focus", () => (lastFocusedId = note.id))
```
and in the remove handler: `if (lastFocusedId === note.id) lastFocusedId = null` before `onRemove(note)`. In `focusNote(id)`: set `lastFocusedId = id` before focusing.

New API functions:
```js
  function setChannel(on) {
    for (const node of bar.querySelectorAll(`[${SEND_ATTRIBUTE}]`)) node.hidden = !on
    for (const node of bar.querySelectorAll(`[${CONNECT_ATTRIBUTE}]`)) node.hidden = on
  }

  const session = () => picker.value
  const refreshSessions = (list) => picker.refresh(list)
  const elementOf = (id) => live.get(id)?.el ?? null
  const setShots = (count) => (shotsEl.textContent = SHOTS_LABEL(count))
  const setAutoShot = (on) => (autoShotInput.checked = on)
```
Export them from the returned object: `setChannel, session, refreshSessions, elementOf, setShots, setAutoShot`.

`src/style.css` additions:
```css
.sticky-notes-bar__picker {
  all: unset;
  border: 1px solid var(--line, #c8ccd4);
  padding: 5px 6px;
  font: inherit;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.sticky-notes-bar__auto {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  cursor: pointer;
}
.sticky-notes-bar__auto input {
  margin: 0;
}
.sticky-notes-bar__shots {
  opacity: 0.7;
  white-space: nowrap;
}
```

`src/turbo.js` `remount()`:
```js
  notes = el ? mount({ root: el, key: el.dataset.key || undefined, anchors: anchorsOf(el), channel: el.dataset.channel }) : null
```
`src/stimulus.js`: `static values = { key: String, channel: String }` and pass `channel: this.hasChannelValue ? this.channelValue : undefined`.

- [ ] **Step 5: Run tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: green; dist rebuilt. If jsdom trips on `prompt`, the test passes a token explicitly (it does).

- [ ] **Step 6: Browser check on a local file page (Playwright, 1920×1080)**

With the daemon running (`node server/daemon.js &`) and a session registered by hand (`node server/mcp.js` fed an `initialize` line on stdin, kept open), open the scratchpad test page with the iife bundle, `StickyNotes.mount({ key: "file-check" })`, click Connect and pass the token from `daemon.json`, pin a note on any element, click Send. Expected: bar says "sent"; the `mcp.js` process prints a `notifications/claude/channel` line containing `screenshot: …/shots/s1/file-check-1.jpg` (auto-shot); the file is a JPEG. Stop the daemon afterwards.

- [ ] **Step 7: Commit**

```bash
git add src/index.js src/layer.js src/style.css src/turbo.js src/stimulus.js dist test/send.test.js
git commit -m "feat: send notes and screenshots to a picked claude session"
```

---

### Task 12: Rails engine — daemon client, proxy routes, channel attribute

**Files:**
- Create: `Gemfile`, `lib/sticky_notes/rails/daemon.rb`, `app/controllers/sticky_notes/channel_controller.rb`, `test/rails/test_helper.rb`, `test/rails/channel_test.rb`
- Modify: `sticky-notes-rails.gemspec` (add `http` dependency), `lib/sticky_notes/rails.rb`, `config/routes.rb`, `app/helpers/sticky_notes_helper.rb`, `app/views/sticky_notes/_tag.html.erb`, `.gitignore` (`Gemfile.lock`)

**Interfaces:**
- Consumes: daemon HTTP API (Task 5/6), `data-channel` read by `turbo.js` (Task 11).
- Produces:
  - `StickyNotes::Rails::Daemon.new(home: ENV["STICKY_NOTES_HOME"] || ~/.cache/sticky-notes)`: `#alive?`, `#sessions(root:) → Array<Hash>` ordered (cwd == root, then ancestors closest first, then the rest), `#post_notes(json) → [status, body]`, raises `StickyNotes::Rails::Daemon::Unreachable`.
  - `StickyNotes::Rails.daemon → Daemon` (new instance each call: cheap, and tests move `STICKY_NOTES_HOME`).
  - Routes: `GET /sticky-notes/sessions` (200 list / 503), `POST /sticky-notes/notes` (daemon status + body / 503).
  - `sticky_notes_tag` adds `data-channel="/sticky-notes"` when the daemon answers at render time.

- [ ] **Step 1: Write the failing tests**

`Gemfile`:
```ruby
source "https://rubygems.org"

gemspec

gem "rails"
gem "rack-test"
gem "minitest"
```
Add `Gemfile.lock` to `.gitignore`. Run `bundle install` (Ruby 3.3.3 via asdf; if `Array#shelljoin` errors appear, see memory note on the broken shellwords.rb — it does not affect path gemspecs).

`test/rails/test_helper.rb`:
```ruby
require "rails"
require "action_controller/railtie"
require "sticky-notes-rails"
require "minitest/autorun"
require "rack/test"
require "tmpdir"
require "socket"
require "timeout"
require "json"
require "fileutils"

class DummyApp < Rails::Application
  config.eager_load = false
  config.secret_key_base = "sticky"
  config.logger = Logger.new(nil)
  config.hosts.clear
  config.sticky_notes.enabled = true
end
DummyApp.initialize!

# A host controller gets `helper :all`, so sticky_notes_tag renders through it.
class PagesController < ActionController::Base; end

# The real daemon in a private home on an ephemeral port — no doubles.
module DaemonHarness
  ROOT = File.expand_path("../..", __dir__)
  DAEMON = File.join(ROOT, "server", "daemon.js")
  START_TIMEOUT = 5
  SETTLE = 0.1

  def start_daemon
    @home = Dir.mktmpdir("sticky-notes")
    ENV["STICKY_NOTES_HOME"] = @home
    log = File.join(@home, "daemon.log")
    @daemon = Process.spawn({ "STICKY_NOTES_HOME" => @home, "STICKY_NOTES_PORT" => "0" }, "node", DAEMON, out: log, err: log)
    Timeout.timeout(START_TIMEOUT) { sleep SETTLE until File.exist?(File.join(@home, "daemon.json")) }
  end

  def stop_daemon
    Process.kill("TERM", @daemon)
    Process.wait(@daemon)
    FileUtils.rm_rf(@home)
  end

  # Stands in for a sticky-notes MCP server: registers over the unix socket
  # and returns the socket, which then receives the events.
  def register_session(cwd:, label: "test")
    socket = UNIXSocket.new(File.join(@home, "daemon.sock"))
    socket.puts({ type: "register", cwd:, pid: Process.pid, label: }.to_json)
    sleep SETTLE
    socket
  end
end
```

`test/rails/channel_test.rb`:
```ruby
require_relative "test_helper"

class ChannelTest < Minitest::Test
  include Rack::Test::Methods
  include DaemonHarness

  JSON_TYPE = { "CONTENT_TYPE" => "application/json" }.freeze

  def app = DummyApp

  def setup = start_daemon

  def teardown = stop_daemon

  def test_sessions_are_ordered_for_rails_root
    register_session(cwd: "/elsewhere")
    register_session(cwd: Rails.root.to_s)
    register_session(cwd: Rails.root.dirname.to_s)

    get "/sticky-notes/sessions"

    assert_equal 200, last_response.status
    assert_equal [Rails.root.to_s, Rails.root.dirname.to_s, "/elsewhere"], JSON.parse(last_response.body).map { _1["cwd"] }
  end

  def test_sessions_are_503_without_a_daemon
    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir

    get "/sticky-notes/sessions"

    assert_equal 503, last_response.status
  end

  def test_notes_are_forwarded_and_reach_the_session
    socket = register_session(cwd: Rails.root.to_s)
    get "/sticky-notes/sessions"
    id = JSON.parse(last_response.body).first["id"]

    body = { session: id, url: "http://x/kids/1", key: "/kids/1", title: "Kid", notes: [{ n: 1, path: "#a", text: "A", ctx: "", note: "fix" }] }
    post "/sticky-notes/notes", body.to_json, JSON_TYPE

    assert_equal 200, last_response.status
    assert_equal({ "delivered" => true }, JSON.parse(last_response.body))

    event = JSON.parse(socket.gets)
    assert_equal "event", event["type"]
    assert_includes event["content"], "# Notes on Kid"
  end

  def test_daemon_errors_pass_through
    post "/sticky-notes/notes", { session: "s99", url: "u", key: "k", title: "t", notes: [] }.to_json, JSON_TYPE

    assert_equal 404, last_response.status
    assert_equal({ "error" => "unknown session" }, JSON.parse(last_response.body))
  end

  def test_tag_carries_the_channel_only_while_the_daemon_answers
    html = PagesController.render(inline: "<%= sticky_notes_tag %>")
    assert_includes html, 'data-channel="/sticky-notes"'

    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir
    html = PagesController.render(inline: "<%= sticky_notes_tag %>")
    refute_includes html, "data-channel"
  end
end
```

- [ ] **Step 2: Run it, watch it fail**

Run: `bundle exec ruby -Itest test/rails/channel_test.rb`
Expected: 404s from the missing routes, `NameError` for `Daemon`, tag without `data-channel`.

- [ ] **Step 3: Implement**

`sticky-notes-rails.gemspec`: add `spec.add_dependency "http", ">= 5"`.

`lib/sticky_notes/rails/daemon.rb`:
```ruby
require "http"
require "json"

module StickyNotes
  module Rails
    # Client for the sticky-notes daemon on this machine (docs/live-delivery.html).
    # Port and token come from daemon.json; the browser never sees either.
    class Daemon
      INFO_FILE = "daemon.json".freeze
      SESSIONS = "/sessions".freeze
      NOTES = "/notes".freeze
      LOOPBACK = "127.0.0.1".freeze
      TIMEOUT = 2 # s — a wedged daemon must not stall page loads

      Unreachable = Class.new(StandardError)

      def self.default_home
        ENV.fetch("STICKY_NOTES_HOME") { File.join(Dir.home, ".cache", "sticky-notes") }
      end

      def initialize(home: self.class.default_home)
        @info_path = File.join(home, INFO_FILE)
      end

      def alive?
        request(:get, SESSIONS).status.success?
      rescue Unreachable
        false
      end

      # cwd == root first, then ancestors of root (closest first), then the rest.
      def sessions(root:)
        response = request(:get, SESSIONS)
        raise Unreachable, "daemon answered #{response.status}" unless response.status.success?

        JSON.parse(response.body.to_s).sort_by { |session| [rank(session["cwd"], root), -session["cwd"].length] }
      end

      def post_notes(json)
        response = request(:post, NOTES, body: json)

        [response.status.code, response.body.to_s]
      end

      private

      def rank(cwd, root)
        return 0 if cwd == root
        return 1 if root.start_with?("#{cwd}/")

        2
      end

      def request(method, path, body: nil)
        info = read_info or raise Unreachable, "no #{@info_path}"

        HTTP.timeout(TIMEOUT)
            .auth("Bearer #{info["token"]}")
            .headers(content_type: "application/json")
            .request(method, "http://#{LOOPBACK}:#{info["port"]}#{path}", body:)
      rescue HTTP::Error, SystemCallError => e
        raise Unreachable, e.message
      end

      def read_info
        return unless File.file?(@info_path)

        JSON.parse(File.read(@info_path))
      end
    end
  end
end
```

`lib/sticky_notes/rails.rb`: add `require "sticky_notes/rails/daemon"` and
```ruby
    def self.daemon
      Daemon.new
    end
```

`app/controllers/sticky_notes/channel_controller.rb`:
```ruby
module StickyNotes
  # Same-origin proxy to the daemon so remote browsing (caddy) works and the
  # token stays on the machine. Dev/staging only, like the routes.
  class ChannelController < ActionController::Base
    skip_forgery_protection # the overlay posts JSON with no form; the routes only exist where the overlay does

    def sessions
      render json: daemon.sessions(root: ::Rails.root.to_s)
    rescue StickyNotes::Rails::Daemon::Unreachable
      head :service_unavailable
    end

    def notes
      status, body = daemon.post_notes(request.raw_post)
      render json: body, status:
    rescue StickyNotes::Rails::Daemon::Unreachable
      head :service_unavailable
    end

    private

    def daemon = StickyNotes::Rails.daemon
  end
end
```

`config/routes.rb`:
```ruby
StickyNotes::Rails::Engine.routes.draw do
  get "sessions", to: "sticky_notes/channel#sessions", as: :sessions
  post "notes", to: "sticky_notes/channel#notes", as: :notes

  get ":name", to: "sticky_notes/assets#show", as: :script, format: false,
      constraints: { name: /(sticky-notes|turbo|stimulus)\.js/ }
end
```

`app/helpers/sticky_notes_helper.rb`:
```ruby
  def sticky_notes_tag(key: nil, anchors: nil)
    return unless StickyNotes::Rails.enabled?

    # one loopback call per page load; connection refused is instant when the daemon is down
    channel = sticky_notes.sessions_path.delete_suffix(StickyNotes::Rails::Daemon::SESSIONS) if StickyNotes::Rails.daemon.alive?

    render "sticky_notes/tag", key:, anchors:, channel:
  end
```

`app/views/sticky_notes/_tag.html.erb`: `tag.div(data: { sticky_notes: true, key:, anchors: anchors&.join(" "), channel: })` (a nil `channel` is omitted by `tag`).

- [ ] **Step 4: Run the Ruby tests and the JS suite**

Run: `bundle exec ruby -Itest test/rails/channel_test.rb && npm test`
Expected: 5 runs, 0 failures; JS still green.

- [ ] **Step 5: Commit**

```bash
git add Gemfile .gitignore sticky-notes-rails.gemspec lib app config test/rails
git commit -m "feat(rails): proxy sessions and notes to the sticky-notes daemon"
```

---

### Task 13: End-to-end on Krouzitko through caddy

**Files:**
- Modify (host repo): `~/projects/krouzitko/Gemfile.lock` via `bundle update sticky-notes-rails`

- [ ] **Step 1: Update the host and restart its server**

```bash
cd ~/projects/krouzitko && bundle update sticky-notes-rails && git diff --stat
```
Restart the Rails dev server in its tmuxinator pane (see `.tmuxinator.yml`; memory: dev at `krouzitko.oak.hozak.dev`).

- [ ] **Step 2: Start a review session**

In a tmux pane: `cd ~/projects/krouzitko; claude-review`. Confirm the channel in the banner.

- [ ] **Step 3: Drive the browser (Playwright, chromium, 1920×1080, or the user by hand)**

Open `https://krouzitko.oak.hozak.dev/` (log in if needed), check `document.querySelector("[data-sticky-notes]").dataset.channel === "/sticky-notes"`. Click "✎ Notes", pin a note on a heading, type "make this bold", click Send. Expected: picker preselected the krouzitko session (single live session), bar says "sent", Claude in the tmux pane receives the note with a `screenshot:` line and starts acting on it. Check `ls ~/.cache/sticky-notes/shots/s*/` shows a `.jpg` ≤ 2 MB whose long edge ≤ 1568 (`file` prints the dimensions).

- [ ] **Step 4: Two sessions and queue**

Start a second `claude-review` from `~`. Reload the page: the picker now shows "pick a session…", krouzitko first, `~` second, queue last. Pick the `~` session, Send → that session reacts. Exit both sessions; reload; picker offers only queue; Send → "queued for the next review session"; start `claude-review` again → the queued note arrives at start.

- [ ] **Step 5: Remote check**

From another device (phone on the tailnet, or `curl -k` through caddy), load the page via `*.oak.hozak.dev` and Send once. Expected: works identically; `daemon.log` shows the request came in via the engine (loopback).

- [ ] **Step 6: Commit the host lock bump**

```bash
cd ~/projects/krouzitko && git add Gemfile.lock && git commit -m "chore: bump sticky-notes-rails for live delivery"
```

---

### Task 14: Documentation, skill, version bump

**Files:**
- Modify: `README.md`, `DESIGN.md`, `skill/SKILL.md`, `package.json` (`version`), `lib/sticky_notes/rails/version.rb`
- Modify: memory `~/.claude/projects/-home-dev/memory/sticky-notes-library.md`

- [ ] **Step 0: `docs/live-delivery.html`** — the two `--continue` mentions become `--resume <id>` (see Spike findings); add the `claudeSession` field to the register row of the socket table.

- [ ] **Step 1: README** — add a section "Live delivery to Claude Code" (≤ 25 lines): the three commands (`claude-review`, `node ~/projects/sticky-notes/server/daemon.js stop`, install symlink), what the bar's Send/picker/auto-shot do, the file:// Connect flow, a pointer to `docs/live-delivery.html`.

- [ ] **Step 2: DESIGN.md** — extend the Modules table with `slug.js`, `channel.js`, `picker.js`, the new `screenshot.js` exports, and the `server/` table (one row per file from "File structure" above); Public API gains `channel`/`fetch` options and `send()`, `attachScreenshot()`, `setAutoShot()`, `connect()`, `channel`; CSS classes gain `__picker`, `__auto`, `__shots`; storage keys gain `sticky-notes:session:<key>`, `sticky-notes:pending:<key>`, `sticky-notes:auto-shot`, `sticky-notes:daemon-token`.

- [ ] **Step 3: SKILL.md** — add:
  - to "Three ways in": review sessions start with `claude-review` (why: channels are per launch; `claude-review --continue` upgrades a running one).
  - a section "Reading a channel event": the `<channel source="sticky-notes" url key count>` shape, body = the same Markdown as the export plus `screenshot:` lines; Read the JPEG when the note is visual; treat it as a change request; no reply on the channel.
  - to "What the layer does": Send / picker / auto-shot / Connect rows.
  - to "Common mistakes": launching `claude` without `claude-review` and expecting Send to work; forgetting that the daemon keeps running (`sticky-notes-daemon stop`).

- [ ] **Step 4: Version bump and build**

`package.json` `"version": "0.2.0"`, `VERSION = "0.2.0"`; `npm run build`; `npm test && npm run lint && bundle exec ruby -Itest test/rails/channel_test.rb`.

- [ ] **Step 5: Memory** — in `sticky-notes-library.md` replace the "Next: push notes…" paragraph with the shipped state (daemon + MCP server + engine routes + `claude-review`, spike facts, gotchas found), keep the doc URL, update the MEMORY.md line.

- [ ] **Step 6: Commit and push**

```bash
git add README.md DESIGN.md skill/SKILL.md package.json lib/sticky_notes/rails/version.rb dist
git commit -m "docs: live delivery, bump to 0.2.0"
git push
```
Then in Portal and Hub (PRs #737 / #165): `bundle update sticky-notes-rails` when those branches are next touched — not part of this plan.

---

## Self-review

- **Spec coverage:** daemon files/API/socket messages (Tasks 3–6), MCP server + instructions (7), launch function + `--continue` (8), Send flow + picker rules + queue (10–11), screenshots JPEG/cap/attach/auto-shot/pending-lost/Download PNG (9, 11), engine routes + ordering + `data-channel` + 503 (12), remote via caddy (13), file:// direct path with pasted token + CORS (5, 11), failure modes (401/404/413/415 pass-through in 5 and 12; "no daemon" message in 11; stale socket and duplicate daemon in 6; reconnect in 7), security (loopback bind, 0600, daemon-named files, magic bytes: 4–6), artifacts deferred (docs only, 14), verify list (1).
- **Open decisions taken here:** `http.rb` in the gem (CLAUDE.md preference); pending screenshots in memory with a persisted count for the "lost" message (spec); MCP server hand-rolls JSON-RPC instead of pulling `@modelcontextprotocol/sdk` into the npm package's runtime deps.
- **Known risks:** the daemon-client reconnect test relies on `start()` binding a fresh ephemeral port after `stopServers()` — the client reconnects over the socket path, so the port change does not matter. In that test the client's retry can race the in-process restart and call `spawnDaemon()`; the spawned daemon then sees the live socket and exits 0, so the test still holds — if it flakes, raise `RETRY_MS`. jsdom has no canvas, so JPEG conversion and auto-shot are covered only by the browser checks in Tasks 9, 11, 13.
