import type { FilterEnv, ValueFilterOp } from "../type-def.js"
import type { ParseResult } from "../types.js"
import { fail, isIsoDate, ok, parseDate } from "../values.js"

// Date math on ISO dates ("2026-10-27"), in whole days. Dates carry no time
// zone, so the arithmetic runs in UTC, where every day has 24 hours.

const DAY_MS = 86_400_000

function toDays(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  )
}

function fromTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

/** The date `days` days after `iso` (before it when negative). */
export function addDays(iso: string, days: number): string {
  return fromTime(toDays(iso) + days * DAY_MS)
}

/**
 * The date `months` months after `iso`, on the same day of the month, or
 * the month's last day when it is shorter: a month after 2026-01-31 is
 * 2026-02-28.
 */
export function addMonths(iso: string, months: number): string {
  const total =
    Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + months
  const year = Math.floor(total / 12)
  const month = total - year * 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(Number(iso.slice(8, 10)), last)
  return fromTime(Date.UTC(year, month, day))
}

/** Today's date where the code runs, in ISO form. */
export function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Checks a date given for "today", or returns the local date. */
export function filterEnv(today?: string): FilterEnv {
  if (today === undefined) return { today: localToday() }
  if (!isIsoDate(today)) {
    throw new Error(`"${today}" is not a date in YYYY-MM-DD form`)
  }
  return { today }
}

// Days relative to today, which a date filter's operand may name instead of
// a date: "before today" finds what is overdue.
const RELATIVE_DAYS: Readonly<Record<string, number>> = {
  today: 0,
  yesterday: -1,
  tomorrow: 1,
}

/**
 * Reads a date filter's operand: an ISO date, or "today", "yesterday" or
 * "tomorrow", which a saved view keeps as words so that it stays current.
 */
export function readDateOperand(
  text: string,
  _prepared: unknown,
  env: FilterEnv
): ParseResult<string | null> {
  const shift = RELATIVE_DAYS[text.trim().toLowerCase()]
  return shift === undefined ? parseDate(text) : ok(addDays(env.today, shift))
}

/** The units of "in the last" and "in the next". */
const UNITS: Readonly<Record<string, "days" | "weeks" | "months" | "years">> = {
  day: "days",
  days: "days",
  week: "weeks",
  weeks: "weeks",
  month: "months",
  months: "months",
  year: "years",
  years: "years",
}

function shift(iso: string, count: number, unit: string): string {
  switch (unit) {
    case "days":
      return addDays(iso, count)
    case "weeks":
      return addDays(iso, count * 7)
    case "months":
      return addMonths(iso, count)
    default:
      return addMonths(iso, count * 12)
  }
}

function readSpan([count = "", unit = ""]: readonly string[]): ParseResult<{
  count: number
  unit: string
}> {
  const n = Number(count.trim())
  if (!/^\d+$/.test(count.trim()) || n < 1) {
    return fail(`"${count.trim()}" is not a whole number of 1 or more`)
  }
  const u = UNITS[unit.trim().toLowerCase()]
  if (!u) return fail(`"${unit.trim()}" is not days, weeks, months or years`)
  return ok({ count: n, unit: u })
}

/**
 * The periods "is within" names. Weeks start on Monday, as ISO 8601 has it.
 */
export const DATE_PERIODS = [
  "thisWeek",
  "lastWeek",
  "nextWeek",
  "thisMonth",
  "lastMonth",
  "nextMonth",
  "thisYear",
  "lastYear",
  "nextYear",
] as const

export type DatePeriod = (typeof DATE_PERIODS)[number]

/** The first and last day of a period, both included. */
export function periodRange(
  period: DatePeriod,
  today: string
): { from: string; to: string } {
  const step = period.startsWith("last")
    ? -1
    : period.startsWith("next")
      ? 1
      : 0
  if (period.endsWith("Week")) {
    // getUTCDay: 0 is Sunday. Back to Monday.
    const weekday = (new Date(toDays(today)).getUTCDay() + 6) % 7
    const from = addDays(today, step * 7 - weekday)
    return { from, to: addDays(from, 6) }
  }
  if (period.endsWith("Month")) {
    const from = addMonths(`${today.slice(0, 7)}-01`, step)
    return { from, to: addDays(addMonths(from, 1), -1) }
  }
  const year = Number(today.slice(0, 4)) + step
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

/**
 * The relative filters of a date type: "in the last" and "in the next" a
 * number of days, weeks, months or years, and "is within" a calendar week,
 * month or year. Their operands are words ("7", "days"; "thisMonth"), so a
 * saved view moves with today.
 *
 * "In the last 7 days" is today and the 6 days before it; "in the next 7
 * days" is today and the 6 days after it. For months and years, the span
 * runs to the same day of the month: "in the last month" on 2026-10-27 is
 * 2026-09-28 to 2026-10-27.
 */
export function relativeDateFilters<P>(): ValueFilterOp<string, P>[] {
  return [
    {
      id: "inLast",
      label: "in the last",
      operands: 2,
      compile: (operands, _p, env) => {
        const span = readSpan(operands)
        if (!span.ok) return span
        const after = shift(env.today, -span.value.count, span.value.unit)
        const to = env.today
        return ok((value) => value !== null && value > after && value <= to)
      },
    },
    {
      id: "inNext",
      label: "in the next",
      operands: 2,
      compile: (operands, _p, env) => {
        const span = readSpan(operands)
        if (!span.ok) return span
        const from = env.today
        const before = shift(env.today, span.value.count, span.value.unit)
        return ok((value) => value !== null && value >= from && value < before)
      },
    },
    {
      id: "within",
      label: "is within",
      operands: 1,
      compile: ([text = ""], _p, env) => {
        const period = DATE_PERIODS.find((p) => p === text.trim())
        if (!period) return fail(`"${text.trim()}" is not a period`)
        const { from, to } = periodRange(period, env.today)
        return ok((value) => value !== null && value >= from && value <= to)
      },
    },
  ]
}
