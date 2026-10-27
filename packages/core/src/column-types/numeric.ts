import { defineColumnType } from "../type-def.js"
import type { Issue, ParseResult } from "../types.js"
import { fail, ok, parseNumber } from "../values.js"
import { asText, emptyFilter, orderFilters } from "./shared.js"

const NOT_NUMBER: Issue = { message: "Not a number" }

/** Writes a number's decimal text with the point moved `places` right. */
function shiftDecimal(value: number, places: number): string {
  const [mantissa = "", exponent] = String(value).split("e")
  if (exponent !== undefined) return `${mantissa}e${Number(exponent) + places}`
  const negative = mantissa.startsWith("-")
  const [whole = "", fraction = ""] = mantissa.replace("-", "").split(".")
  const digits = whole + fraction.padEnd(places, "0")
  const point = whole.length + places
  let text = `${digits.slice(0, point)}.${digits.slice(point)}`
  text = text.replace(/^0+(?=\d)/, "").replace(/\.?0*$/, "")
  return (negative ? "-" : "") + (text === "" ? "0" : text)
}

function inRange(value: number, min: number | null, max: number | null) {
  return (min === null || value >= min) && (max === null || value <= max)
}

export type PercentOptions = {
  /**
   * How a number typed without "%" reads: "points" (12.5 is 12.5%, the
   * default) or "fraction" (0.125 is 12.5%).
   */
  bare: "points" | "fraction"
  /** The least value, as a fraction (0.1 is 10%), or null. */
  min: number | null
  /** The most value, as a fraction, or null. */
  max: number | null
}

function parsePercent(
  text: string,
  p: PercentOptions
): ParseResult<number | null> {
  const t = text.trim()
  if (t === "") return ok(null)
  if (/[$€£]/.test(t)) return fail(`"${t}" is not a percent`)
  const bare = !t.endsWith("%")
  const parsed = parseNumber(bare && p.bare === "points" ? `${t}%` : t)
  return parsed.ok ? parsed : fail(`"${t}" is not a percent`)
}

/**
 * A share, stored as a fraction: 0.125 shows as "12.5%". "12.5%" parses to
 * 0.125, and so does a bare 12.5, which means points by default.
 */
export const percentType = defineColumnType<
  number,
  PercentOptions,
  PercentOptions,
  "percent"
>({
  id: "percent",
  label: "Percent",
  group: "number",
  defaultOptions: { bare: "points", min: null, max: null },
  parse: (text, p) => parsePercent(text, p),
  format: (value) =>
    typeof value === "number" ? `${shiftDecimal(value, 2)}%` : asText(value),
  validate: (value, p) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return NOT_NUMBER
    return inRange(value, p.min, p.max) ? null : { message: "Out of range" }
  },
  compare: (a, b) => a - b,
  filters: [...orderFilters(parsePercent), emptyFilter()],
  align: "end",
})

/**
 * Reads a row's currency for display, such as `(row) => row.currency`.
 * Declared as a method so that a function of a particular row type fits.
 */
type CurrencyFrom = {
  pick(row: never): string | null | undefined
}["pick"]

export type MoneyOptions = {
  /** The ISO 4217 code, such as "EUR". Values are in its major unit. */
  currency: string
  /**
   * The currency to show a row's value in, when it differs by row. Display
   * only: parsing, copying and editing use `currency`. A function, so a
   * column spec leaves it out.
   */
  currencyFrom: CurrencyFrom | null
  /** The least value, or null. */
  min: number | null
  /** The most value, or null. */
  max: number | null
}

type Currency = {
  code: string
  /** How many decimals it has (JPY 0, EUR 2, KWD 3). */
  digits: number
  /** The symbol its text shows, such as "€" or "DKK". */
  symbol: string
  format: Intl.NumberFormat
}

type PreparedMoney = MoneyOptions & {
  main: Currency
  /** Currencies made for `currencyFrom`, by code. */
  others: Map<string, Currency | null>
}

// One fixed style, so `parse` can read back what `format` writes: grouping
// commas and a decimal point.
const LOCALE = "en-US"

function makeCurrency(code: string): Currency {
  const upper = code.toUpperCase()
  if (!/^[A-Z]{3}$/.test(upper)) throw new Error(`"${code}" is not a currency`)
  const format = new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: upper,
  })
  const symbol =
    format.formatToParts(1).find((part) => part.type === "currency")?.value ??
    upper
  return {
    code: upper,
    digits: format.resolvedOptions().maximumFractionDigits ?? 2,
    symbol,
    format,
  }
}

// A sign, a currency before the number, the number, and a currency after it.
const MONEY =
  /^([+-]?)\s*([^\d\s.,+-]*)\s*([+-]?)\s*(\d[\d,]*(?:\.\d*)?|\.\d+)\s*([^\d\s.,+-]*)$/u

// A mark that names some currency: a sign ("$", "€"), a code ("USD"), or a
// prefixed sign ("CA$").
const CURRENCY_LIKE = /^(?:[a-z]{0,3}\p{Sc}|[a-z]{3})$/iu

function parseMoney(text: string, c: Currency): ParseResult<number | null> {
  const t = text.trim()
  if (t === "") return ok(null)
  const m = MONEY.exec(t)
  if (!m) return fail(`"${t}" is not an amount`)
  const [, sign1 = "", before = "", sign2 = "", number = "", after = ""] = m
  if (sign1 && sign2) return fail(`"${t}" is not an amount`)
  for (const mark of [before, after]) {
    if (mark !== "" && mark !== c.symbol && mark.toUpperCase() !== c.code) {
      return fail(
        CURRENCY_LIKE.test(mark)
          ? `"${t}" is not in ${c.code}`
          : `"${t}" is not an amount`
      )
    }
  }
  if (before && after) return fail(`"${t}" is not an amount`)
  // One comma group without a point ("1,234") is a thousands group: read as
  // decimals it would have three, which only a three-decimal currency allows.
  const single = /^\d{1,3},\d{3}$/.test(number)
  if (single && c.digits >= 3) {
    return fail(
      `"${t}" is ambiguous: write ${number.replace(",", "")} or ${number.replace(",", ".")}`
    )
  }
  const parsed = parseNumber(
    sign1 + sign2 + (single ? number.replace(",", "") : number)
  )
  if (!parsed.ok) return fail(`"${t}" is not an amount`)
  const fraction = number.split(".")[1] ?? ""
  if (fraction.length > c.digits) {
    return fail(`"${t}" has more decimals than ${c.code} has (${c.digits})`)
  }
  return parsed
}

/** True when the value has no more decimals than the currency. */
function fitsDigits(value: number, digits: number): boolean {
  return Number(value.toFixed(digits)) === value
}

/**
 * An amount of money: a number in the currency's major unit (12.5 is 12.50
 * euros), with the currency set per column. It shows as "€1,234.50". Text
 * may carry the column's symbol or code, but no other: "$5" in a EUR column
 * is an error, and so is a third decimal.
 */
export const moneyType = defineColumnType<
  number,
  MoneyOptions,
  PreparedMoney,
  "money",
  "currency"
>({
  id: "money",
  label: "Money",
  group: "number",
  defaultOptions: { currency: "USD", currencyFrom: null, min: null, max: null },
  requiredOptions: ["currency"],
  prepare: (options) => ({
    ...options,
    main: makeCurrency(options.currency),
    others: new Map(),
  }),
  parse: (text, p) => parseMoney(text, p.main),
  format: (value, p, row) => {
    if (typeof value !== "number") return asText(value)
    let c = p.main
    const code = row === undefined ? null : p.currencyFrom?.(row as never)
    if (code && code.toUpperCase() !== c.code) {
      let other = p.others.get(code)
      if (other === undefined) {
        try {
          other = makeCurrency(code)
        } catch {
          other = null
        }
        p.others.set(code, other)
      }
      if (other) c = other
    }
    return c.format.format(value)
  },
  validate: (value, p) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return NOT_NUMBER
    if (!fitsDigits(value, p.main.digits)) {
      return { message: `More decimals than ${p.main.code} has` }
    }
    return inRange(value, p.min, p.max) ? null : { message: "Out of range" }
  },
  compare: (a, b) => a - b,
  filters: [
    ...orderFilters((text, p: PreparedMoney) => parseMoney(text, p.main)),
    emptyFilter(),
  ],
  align: "end",
})
