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
