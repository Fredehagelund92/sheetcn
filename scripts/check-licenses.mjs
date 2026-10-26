// License scan. Every installed package must carry a license on the allow
// list. Packages that ship to users (production dependencies of the published
// packages) must also be permissive and be listed in THIRD_PARTY_NOTICES.md.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const PERMISSIVE = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
])

// Allowed for build and test tools only; never shipped. MPL-2.0 is file-level
// copyleft and applies only when its files are modified or distributed.
const DEV_ONLY = new Set(["MPL-2.0"])

function licenses(prod) {
  const args = ["licenses", "list", "--json", "--recursive"]
  if (prod) args.push("--prod")
  const out = execFileSync("pnpm", args, { encoding: "utf8" }).trim()
  const byLicense = out ? JSON.parse(out) : {}
  return Object.entries(byLicense).flatMap(([license, packages]) =>
    packages.map((p) => ({ license, id: `${p.name}@${p.versions.join(",")}` }))
  )
}

const problems = []

for (const { license, id } of licenses(false)) {
  if (!PERMISSIVE.has(license) && !DEV_ONLY.has(license)) {
    problems.push(`${id}: license "${license}" is not on the allow list`)
  }
}

const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8")
const shipped = licenses(true)
for (const { license, id } of shipped) {
  if (!PERMISSIVE.has(license)) {
    problems.push(`${id}: ships to users under "${license}"`)
  }
  const name = id.slice(0, id.lastIndexOf("@"))
  if (!notices.includes(name)) {
    problems.push(
      `${id}: ships to users but is missing from THIRD_PARTY_NOTICES.md`
    )
  }
}

if (problems.length) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log(
  `Licenses ok: ${shipped.length} shipped packages, all installed packages allowed.`
)
