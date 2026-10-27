// The phone adapter: "@sheetcn/core/phone". It is the only part of the core
// with a dependency, libphonenumber-js (an optional peer dependency, pinned
// to 1.13.15), so the main entry stays dependency-free.
import parsePhoneNumber, {
  isSupportedCountry,
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js/min"

import { phoneDigits, phoneShapeType } from "./column-types/phone.js"
import { asText } from "./column-types/shared.js"
import { defineColumnType } from "./type-def.js"
import type { ParseResult } from "./types.js"
import { fail, ok } from "./values.js"

export type PhoneOptions = {
  /**
   * The country a number without its country code belongs to, as an ISO
   * 3166-1 alpha-2 code ("GB"), or null to require the country code.
   */
  defaultCountry: string | null
}

// What `prepare` builds. The library's own types stay out of this entry's
// public types, so a project can type-check without them.
type PreparedPhone = { defaultCountry: string | undefined }

// Takes any stored value, since a cell may hold one of another shape.
function read(text: unknown, p: PreparedPhone): PhoneNumber | undefined {
  return typeof text === "string"
    ? parsePhoneNumber(text, p.defaultCountry as CountryCode | undefined)
    : undefined
}

function parsePhone(
  text: string,
  p: PreparedPhone
): ParseResult<string | null> {
  const t = text.trim()
  if (t === "") return ok(null)
  const number = read(phoneDigits(t), p)
  if (!number) {
    return fail(
      p.defaultCountry
        ? `"${t}" is not a phone number`
        : `"${t}" needs its country code, such as +44 or 0044`
    )
  }
  // The library advises `isPossible` (the length fits the country) over
  // `isValid`, which goes stale as numbering plans change.
  return number.isPossible()
    ? ok(number.number)
    : fail(`"${t}" is not a possible number for its country`)
}

/**
 * The phone type with libphonenumber-js: numbers without their country code
 * read with `defaultCountry`, a number must be possible for its country, and
 * it shows in international groups ("+44 20 7946 0958"). It stores the same
 * E.164 text as the built-in `phone` type, so it replaces it in a registry:
 *
 * ```ts
 * import { phoneType } from "@sheetcn/core/phone"
 *
 * const types = createTypeRegistry([
 *   ...builtInTypes.filter((t) => t.id !== "phone"),
 *   phoneType,
 * ])
 * ```
 */
export const phoneType = defineColumnType<
  string,
  PhoneOptions,
  PreparedPhone,
  "phone"
>({
  ...phoneShapeType,
  defaultOptions: { defaultCountry: null },
  prepare: ({ defaultCountry }) => {
    if (defaultCountry === null) return { defaultCountry: undefined }
    const code = defaultCountry.toUpperCase()
    if (!isSupportedCountry(code)) {
      throw new Error(`"${defaultCountry}" is not a country with phone numbers`)
    }
    return { defaultCountry: code }
  },
  parse: parsePhone,
  format: (value, p) => read(value, p)?.formatInternational() ?? asText(value),
  validate: (value, p) => {
    const issue = phoneShapeType.validate?.(value, {}, null)
    if (issue) return issue
    return read(value, p)?.isPossible()
      ? null
      : { message: "Not a possible phone number" }
  },
})
