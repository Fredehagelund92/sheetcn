import { defineColumnType } from "../type-def.js"
import type { ParseResult } from "../types.js"
import { fail, ok } from "../values.js"
import { COUNTRY_CODES } from "./country-codes.js"
import { anyOfFilter, asText, collator, emptyFilter, fold } from "./shared.js"

export type CountryOptions = {
  /** The language of the names, such as "en" or "de". Default: "en". */
  locale: string
  /** Show the code after the name: "Norway (NO)". Default: false. */
  showCode: boolean
}

type PreparedCountry = CountryOptions & {
  names: Intl.DisplayNames
  /** Folded names (in the column's language and in English) to codes. */
  byName: ReadonlyMap<string, string>
  byAlpha3: ReadonlyMap<string, string>
}

// Names fold case, accents and curly apostrophes ("Côte d’Ivoire").
const foldName = (name: string) => fold(name).replace(/[’‘`]/g, "'")

// Codes that are not assigned but that people write for an assigned one.
const ALIASES: ReadonlyMap<string, string> = new Map([["UK", "GB"]])

function nameMap(locale: string): Map<string, string> {
  const names = new Intl.DisplayNames(locale, { type: "region" })
  const map = new Map<string, string>()
  for (const code of COUNTRY_CODES.keys()) {
    const name = names.of(code)
    if (name !== undefined && name !== code) map.set(foldName(name), code)
  }
  return map
}

const namesByLocale = new Map<string, Map<string, string>>()

function namesIn(locale: string): Map<string, string> {
  let map = namesByLocale.get(locale)
  if (!map) {
    map = nameMap(locale)
    namesByLocale.set(locale, map)
  }
  return map
}

/** The country's name, or undefined for a value that is not a country. */
function nameOf(value: unknown, p: PreparedCountry): string | undefined {
  return typeof value === "string" && COUNTRY_CODES.has(value)
    ? p.names.of(value)
    : undefined
}

function parseCountry(
  text: string,
  p: PreparedCountry
): ParseResult<string | null> {
  const t = text.trim()
  if (t === "") return ok(null)
  // "Norway (NO)", as `showCode` writes it, reads by its code.
  const shown = /\(([a-z]{2})\)$/i.exec(t)
  const upper = (shown?.[1] ?? t).toUpperCase()
  const code =
    (COUNTRY_CODES.has(upper) ? upper : undefined) ??
    ALIASES.get(upper) ??
    p.byAlpha3.get(upper) ??
    p.byName.get(foldName(t))
  return code ? ok(code) : fail(`"${t}" is not a country`)
}

/**
 * A country, stored as its ISO 3166-1 alpha-2 code ("NO") and shown by name
 * in the column's language. Text may be the code, the alpha-3 code or the
 * name (in that language or English), ignoring case and accents; "UK" reads
 * as GB. Only the 249 assigned codes are countries.
 */
export const countryType = defineColumnType<
  string,
  CountryOptions,
  PreparedCountry,
  "country"
>({
  id: "country",
  label: "Country",
  group: "choice",
  defaultOptions: { locale: "en", showCode: false },
  prepare: (options) => {
    const names = new Intl.DisplayNames(options.locale, { type: "region" })
    const byName = new Map([...namesIn("en"), ...namesIn(options.locale)])
    const byAlpha3 = new Map(
      [...COUNTRY_CODES].map(([alpha2, alpha3]) => [alpha3, alpha2])
    )
    return { ...options, names, byName, byAlpha3 }
  },
  parse: (text, p) => parseCountry(text, p),
  format: (value, p) => {
    const name = nameOf(value, p)
    return name === undefined
      ? asText(value)
      : p.showCode
        ? `${name} (${value})`
        : name
  },
  validate: (value) =>
    typeof value === "string" && COUNTRY_CODES.has(value)
      ? null
      : { message: "Not a country code" },
  compare: (a, b, p) => collator.compare(nameOf(a, p) ?? a, nameOf(b, p) ?? b),
  filters: [anyOfFilter(parseCountry), emptyFilter()],
  edit: "popup",
})
