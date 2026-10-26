// Fails when a file in the repository contains an em dash. The project writes
// a plain dash instead.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const EM_DASH = String.fromCharCode(0x2014)
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" }
)
  .split("\0")
  .filter(Boolean)

const found = []
for (const file of files) {
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch {
    continue // listed but deleted from the working tree
  }
  text.split("\n").forEach((line, i) => {
    if (line.includes(EM_DASH)) found.push(`${file}:${i + 1}`)
  })
}

if (found.length) {
  console.error(`Em dash found; use a plain dash instead:\n${found.join("\n")}`)
  process.exit(1)
}
