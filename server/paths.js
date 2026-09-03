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
