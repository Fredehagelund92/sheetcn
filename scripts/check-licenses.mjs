// License scan. Every installed package must carry a license on the allow
// list. Packages that ship to users (production dependencies of the published
// packages) must also be permissive and be listed in THIRD_PARTY_NOTICES.md.
// Peer dependencies (React) are installed by the app, not shipped.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

const PERMISSIVE = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
])

// Allowed for build and test tools only; never shipped. MPL-2.0 is file-level
// copyleft and applies only when its files are modified or distributed.
// CC-BY-4.0 covers browser support data that lint tooling reads.
const DEV_ONLY = new Set(["MPL-2.0", "CC-BY-4.0"])

// The peer dependencies of the published packages and everything they depend
// on. The app installs them; sheetcn does not ship them.
function appProvided() {
  const names = new Set()
  const root = (file) => {
    let dir = dirname(file)
    while (!existsSync(join(dir, "package.json"))) dir = dirname(dir)
    return dir
  }
  const visit = (name, fromDir) => {
    if (names.has(name)) return
    const require = createRequire(join(fromDir, "package.json"))
    let dir
    try {
      dir = root(require.resolve(name))
    } catch {
      return
    }
    names.add(name)
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir)
  }
  for (const entry of readdirSync("packages")) {
    const dir = resolve("packages", entry)
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    for (const peer of Object.keys(pkg.peerDependencies ?? {})) visit(peer, dir)
  }
  return names
}

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
const provided = appProvided()
const shipped = licenses(true).filter(
  ({ id }) => !provided.has(id.slice(0, id.lastIndexOf("@")))
)
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
