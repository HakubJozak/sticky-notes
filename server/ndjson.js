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
