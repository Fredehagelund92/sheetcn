import type { ParseResult, SelectOption } from "./types.js"

export const ok = <V>(value: V): ParseResult<V> => ({ ok: true, value })
export const fail = (error: string): ParseResult<never> => ({
  ok: false,
  error,
})

// A plain number, or one grouped with commas in threes ("1,234,567.5").
// The exponent is only allowed on plain numbers, as String(n) writes it.
// Each part can match a string in only one way, so the time stays linear.
const NUMBER =
  /^([+-]?)([$€£]?)([+-]?)(?:(\d{1,3}(?:,\d{3})+)(\.\d*)?|(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?)$/

/**
 * Parses number text as spreadsheets copy it: "1234.5", "-12", "1e21",
 * "$4.99", "12%" and "1,234.50". A comma is never read as a decimal mark.
 * A single comma group with no decimal point ("1,234") is rejected, because it
 * means 1234 in some locales and 1.234 in others.
 */
export function parseNumber(text: string): ParseResult<number | null> {
  let t = text.trim()
  if (t === "") return ok(null)
  const percent = t.endsWith("%")
  if (percent) t = t.slice(0, -1).trimEnd()
  const m = NUMBER.exec(t)
  if (!m || (m[1] && m[3])) return fail(`"${text.trim()}" is not a number`)
  const sign = m[1] || m[3] || ""
  const grouped = m[4]
  if (grouped !== undefined && !m[5] && grouped.split(",").length === 2) {
    const plain = grouped.replace(",", "")
    return fail(
      `"${text.trim()}" is ambiguous: write ${plain} or ${grouped.replace(",", ".")}`
    )
  }
  const mantissa =
    grouped !== undefined ? grouped.replaceAll(",", "") + (m[5] ?? "") : m[6]
  const exponent = Number(m[7] ?? 0) - (percent ? 2 : 0)
  const n = Number(`${sign}${mantissa}e${exponent}`)
  if (!Number.isFinite(n)) return fail(`"${text.trim()}" is too large`)
  return ok(n === 0 ? 0 : n)
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
  )
}

/**
 * Parses a date in ISO form only ("2026-03-01"). Forms such as "3/4/2026" are
 * rejected rather than guessed, since they read differently by locale.
 */
export function parseDate(text: string): ParseResult<string | null> {
  const t = text.trim()
  if (t === "") return ok(null)
  if (!ISO_DATE.test(t)) return fail(`"${t}" is not a date in YYYY-MM-DD form`)
  if (!isIsoDate(t)) return fail(`"${t}" is not a real date`)
  return ok(t)
}

const TRUE_TEXT = new Set(["true", "yes", "y", "1", "x", "on", "checked", "✓"])
const FALSE_TEXT = new Set(["false", "no", "n", "0", "off", "unchecked"])

export function parseBoolean(text: string): ParseResult<boolean | null> {
  const t = text.trim().toLowerCase()
  if (t === "") return ok(null)
  if (TRUE_TEXT.has(t)) return ok(true)
  if (FALSE_TEXT.has(t)) return ok(false)
  return fail(`"${text.trim()}" is not yes or no`)
}

/**
 * Matches an option by label, then by value, then by either ignoring case.
 * The text is tried as given before it is trimmed.
 */
export function parseSelect(
  text: string,
  options: readonly SelectOption[]
): ParseResult<string | null> {
  const t = text.trim()
  if (t === "") return ok(null)
  const lower = t.toLowerCase()
  const option =
    options.find((o) => o.label === text) ??
    options.find((o) => o.value === text) ??
    options.find((o) => o.label === t) ??
    options.find((o) => o.value === t) ??
    options.find((o) => o.label.toLowerCase() === lower) ??
    options.find((o) => o.value.toLowerCase() === lower)
  return option ? ok(option.value) : fail(`"${t}" is not one of the options`)
}
