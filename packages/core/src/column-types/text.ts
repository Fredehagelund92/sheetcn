import { defineColumnType } from "../type-def.js"
import type { Issue } from "../types.js"
import { fail, ok } from "../values.js"
import {
  asText,
  collator,
  containsFilter,
  emptyFilter,
  fold,
  isTextFilter,
  noOptions,
  parseUrl,
  startsWithFilter,
  type ParsedUrl,
} from "./shared.js"

const NOT_TEXT: Issue = { message: "Not text" }

export type LongTextOptions = {
  /** The most characters a value may have, or null for no limit. */
  maxLength: number | null
}

/**
 * Text that may run over several lines. Windows and old Mac line ends
 * become "\n"; nothing is trimmed. Its editor is the view's own (a text area
 * where Alt+Enter starts a new line).
 */
export const longTextType = defineColumnType<
  string,
  LongTextOptions,
  LongTextOptions,
  "longtext"
>({
  id: "longtext",
  label: "Long text",
  group: "text",
  defaultOptions: { maxLength: null },
  parse: (text) => {
    if (text === "") return ok(null)
    return ok(text.replace(/\r\n?/g, "\n"))
  },
  format: (value) => asText(value),
  validate: (value, p) => {
    if (typeof value !== "string") return NOT_TEXT
    return p.maxLength !== null && value.length > p.maxLength
      ? { message: `Longer than ${p.maxLength} characters` }
      : null
  },
  compare: (a, b) => collator.compare(a, b),
  filters: [containsFilter(), emptyFilter()],
  edit: "popup",
})

// The valid e-mail address of the HTML standard, which departs from RFC 5322
// on purpose: https://html.spec.whatwg.org/multipage/input.html
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** The address in `Name <a@b.example>` or `mailto:a@b.example?subject=x`. */
function emailAddress(text: string): string {
  let t = text.trim()
  const angle = /<([^<>]*)>\s*$/.exec(t)
  if (angle) t = (angle[1] ?? "").trim()
  if (/^mailto:/i.test(t)) t = t.slice(7).split("?")[0] ?? ""
  return t.trim()
}

/**
 * An e-mail address, trimmed. Text such as `Ada <ada@example.test>` and
 * `mailto:ada@example.test` keeps the address only.
 */
export const emailType = defineColumnType({
  id: "email",
  label: "Email",
  group: "link",
  defaultOptions: noOptions,
  parse: (text) => {
    if (text.trim() === "") return ok(null)
    const address = emailAddress(text)
    return EMAIL.test(address)
      ? ok(address)
      : fail(`"${text.trim()}" is not an email address`)
  },
  format: (value: string) => asText(value),
  validate: (value) =>
    typeof value === "string" && EMAIL.test(value)
      ? null
      : { message: "Not an email address" },
  compare: (a, b) => collator.compare(a, b),
  filters: [
    containsFilter(),
    {
      id: "domainIs",
      label: "domain is",
      operands: 1,
      test: (value, [domain = ""]) =>
        value !== null &&
        fold(value.slice(value.lastIndexOf("@") + 1)) === fold(domain.trim()),
    },
    emptyFilter(),
  ],
})

export type UrlOptions = {
  /** The schemes a link may use, without ":". Default: http and https. */
  schemes: readonly string[]
}

type PreparedUrl = { schemes: ReadonlySet<string> }

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Whether text starts with a scheme; "example.test:8080" is a host and port. */
const hasScheme = (text: string) =>
  SCHEME.test(text) && !/^[^:/?#]+:\d+(?:[/?#]|$)/.test(text)

/** Parses a link, adding https:// when there is no scheme. */
function readUrl(text: string, p: PreparedUrl): ParsedUrl | string {
  const t = text.trim()
  let url: ParsedUrl
  try {
    url = parseUrl(hasScheme(t) ? t : `https://${t}`)
  } catch {
    return `"${t}" is not a link`
  }
  const scheme = url.protocol.slice(0, -1)
  if (!p.schemes.has(scheme)) {
    return `"${t}" is not a ${[...p.schemes].join(" or ")} link`
  }
  return url
}

/** The link as stored: the parsed form, without a lone "/" after the host. */
function storedUrl(url: ParsedUrl): string {
  const { href } = url
  return url.pathname === "/" && !url.search && !url.hash && href.endsWith("/")
    ? href.slice(0, -1)
    : href
}

/**
 * An absolute link, such as "https://example.test/a". Text without a scheme
 * gets https://. Only the allowed schemes parse, so `javascript:` never
 * becomes a link. It shows without "https://".
 */
export const urlType = defineColumnType<string, UrlOptions, PreparedUrl, "url">(
  {
    id: "url",
    label: "URL",
    group: "link",
    defaultOptions: { schemes: ["http", "https"] },
    prepare: ({ schemes }) => {
      if (!schemes.length) throw new Error("A URL column needs a scheme")
      return { schemes: new Set(schemes.map((s) => s.toLowerCase())) }
    },
    parse: (text, p) => {
      if (text.trim() === "") return ok(null)
      const url = readUrl(text, p)
      return typeof url === "string" ? fail(url) : ok(storedUrl(url))
    },
    format: (value) => {
      const text = asText(value)
      return text.startsWith("https://") ? text.slice(8) : text
    },
    validate: (value, p) =>
      typeof value === "string" &&
      hasScheme(value) &&
      typeof readUrl(value, p) !== "string"
        ? null
        : { message: "Not a link" },
    compare: (a, b) => collator.compare(a, b),
    filters: [
      containsFilter(),
      {
        id: "hostIs",
        label: "host is",
        operands: 1,
        test: (value, [host = ""], p) => {
          if (value === null) return false
          const url = readUrl(value, p)
          return typeof url !== "string" && url.hostname === fold(host.trim())
        },
      },
      emptyFilter(),
    ],
  }
)

export type DomainOptions = {
  /** Drop a leading "www." label. Default: false. */
  stripWww: boolean
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/** Why a lowercase ASCII host is not a domain, or null when it is one. */
function domainIssue(host: string): string | null {
  if (host.length > 253) return "is longer than 253 characters"
  const labels = host.split(".")
  if (labels.length < 2) return "has no dot"
  if (!labels.every((l) => LABEL.test(l))) return "is not a domain"
  if (/^\d+$/.test(labels.at(-1) ?? "")) return "is an address, not a domain"
  return null
}

/**
 * A host name, stored lowercase in ASCII: international names are stored in
 * their "xn--" form. Text may be a bare host or a whole link; the host is
 * kept. The public suffix list is not checked.
 */
export const domainType = defineColumnType<
  string,
  DomainOptions,
  DomainOptions,
  "domain"
>({
  id: "domain",
  label: "Domain",
  group: "link",
  defaultOptions: { stripWww: false },
  parse: (text, p) => {
    const t = text.trim()
    if (t === "") return ok(null)
    let host: string
    try {
      host = parseUrl(hasScheme(t) ? t : `https://${t}`).hostname
    } catch {
      return fail(`"${t}" is not a domain`)
    }
    host = host.replace(/\.$/, "")
    if (p.stripWww && host.startsWith("www.")) host = host.slice(4)
    const issue = domainIssue(host)
    return issue ? fail(`"${t}" ${issue}`) : ok(host)
  },
  format: (value) => asText(value),
  validate: (value) =>
    typeof value === "string" && domainIssue(value) === null
      ? null
      : { message: "Not a domain" },
  compare: (a, b) => collator.compare(a, b),
  filters: [
    {
      id: "is",
      label: "is",
      operands: 1,
      // A domain matches itself and its subdomains.
      test: (value, [domain = ""]) => {
        const d = fold(domain.trim())
        return value !== null && (value === d || value.endsWith(`.${d}`))
      },
    },
    emptyFilter(),
  ],
})

export type IdentifierOptions = {
  /** Change the case of what is typed. Default: "keep". */
  case: "upper" | "lower" | "keep"
  /** A regular expression every value must match whole, or null. */
  pattern: string | null
  /** An empty cell is flagged. Default: true. */
  required: boolean
}

type PreparedIdentifier = IdentifierOptions & { regex: RegExp | null }

/**
 * Orders text by code point, with runs of digits compared as numbers, so
 * "A-9" comes before "A-10".
 */
export function compareCodes(a: string, b: string): number {
  const runs = /\d+|\D+/g
  const x = a.match(runs) ?? []
  const y = b.match(runs) ?? []
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i] as string
    const q = y[i] as string
    if (p === q) continue
    const digits = /^\d/.test(p) && /^\d/.test(q)
    if (digits) {
      const n = BigInt(p) - BigInt(q)
      if (n !== 0n) return n < 0n ? -1 : 1
    }
    return p < q ? -1 : 1
  }
  return x.length - y.length || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * A key such as an SKU or an order number: trimmed, with no spaces inside,
 * unique in its column and, by default, required. It shows in a monospace
 * face, never as a chip.
 */
export const identifierType = defineColumnType<
  string,
  IdentifierOptions,
  PreparedIdentifier,
  "identifier"
>({
  id: "identifier",
  label: "Identifier",
  group: "other",
  defaultOptions: { case: "keep", pattern: null, required: true },
  prepare: (options) => {
    let regex: RegExp | null = null
    if (options.pattern !== null) {
      try {
        regex = new RegExp(`^(?:${options.pattern})$`, "u")
      } catch {
        throw new Error(`The pattern "${options.pattern}" is not valid`)
      }
    }
    return { ...options, regex }
  },
  parse: (text, p) => {
    let t = text.trim()
    if (t === "") return ok(null)
    if (/\s/.test(t)) return fail(`"${t}" has a space in it`)
    if (p.case === "upper") t = t.toUpperCase()
    if (p.case === "lower") t = t.toLowerCase()
    return ok(t)
  },
  format: (value: string) => asText(value),
  validate: (value, p) => {
    if (typeof value !== "string" || value === "" || /\s/.test(value)) {
      return { message: "Not an identifier" }
    }
    if (
      (p.case === "upper" && value !== value.toUpperCase()) ||
      (p.case === "lower" && value !== value.toLowerCase())
    ) {
      return { message: `Not in ${p.case} case` }
    }
    return p.regex && !p.regex.test(value)
      ? { message: `Does not match ${p.pattern ?? ""}` }
      : null
  },
  validateEmpty: (p) => (p.required ? { message: "Required" } : null),
  unique: true,
  compare: (a, b) => compareCodes(a, b),
  filters: [isTextFilter(), startsWithFilter(), emptyFilter()],
})
