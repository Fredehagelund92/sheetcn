import {
  cellsEqual,
  compareCells,
  formatCell,
  parseCell,
  resolveColumnType,
} from "./cells.js"
import { DATE_PERIODS } from "./column-types/dates.js"
import { getCellValue } from "./columns.js"
import type { FilterOp } from "./type-def.js"
import type { CellValue, Column } from "./types.js"
import { valueIndexFor } from "./value-index.js"
import type { FilterCondition } from "./view.js"

// What a filter bar needs to draw its menus and chips, from the columns'
// types alone.

/** One entry of a column's operator menu: a filter, or its negation. */
export type FilterChoice = {
  op: string
  not: boolean
  /** The words, such as "contains" or "does not contain". */
  label: string
  operands: FilterOp["operands"]
}

/**
 * A column's operator menu, in the type's order: each filter, and right
 * after it its negation when the type names one (`notLabel`).
 */
export function filterChoices<Row>(column: Column<Row>): FilterChoice[] {
  const choices: FilterChoice[] = []
  for (const f of resolveColumnType(column).def.filters ?? []) {
    choices.push({ op: f.id, not: false, label: f.label, operands: f.operands })
    if (f.notLabel !== undefined) {
      choices.push({
        op: f.id,
        not: true,
        label: f.notLabel,
        operands: f.operands,
      })
    }
  }
  return choices
}

/** Whether a column can be filtered: its type has filters. */
export function canFilter<Row>(column: Column<Row>): boolean {
  return (resolveColumnType(column).def.filters?.length ?? 0) > 0
}

/**
 * The words for a filter, turned around or not: its `notLabel`, or "not"
 * and its label when the type names no negation.
 */
export function filterLabel<Row>(
  column: Column<Row>,
  op: string,
  not = false
): string {
  const f = resolveColumnType(column).def.filters?.find((x) => x.id === op)
  if (!f) return op
  return not ? (f.notLabel ?? `not ${f.label}`) : f.label
}

/** A value a checklist offers for a column. */
export type ValueChoice = {
  /** The text a condition keeps, which the column's type parses back. */
  text: string
  /** The value as the column shows it. */
  label: string
  /** How many rows hold it. */
  count: number
}

/**
 * The values the column's cells hold, in the column's order, each with how
 * many rows hold it: what an "is any of" checklist lists. Read from the
 * value index the core keeps with the rows, so the counts cost one pass the
 * first time and nothing after. A value is kept as its own text when that
 * parses back to it (an option's value, a country's code), so a saved view
 * does not depend on the labels; otherwise as its label.
 */
export function valueChoices<Row>(
  rows: readonly Row[],
  column: Column<Row>
): ValueChoice[] {
  const index = valueIndexFor(rows, column)
  const values: { value: CellValue; count: number }[] = []
  for (const [, holders] of index) {
    const first = holders.values().next().value as Row
    const value = getCellValue(column, first)
    if (value !== null) values.push({ value, count: holders.size })
  }
  values.sort((a, b) => compareCells(column, a.value, b.value))
  return values.map(({ value, count }) => {
    const label = formatCell(column, value)
    const raw = typeof value === "string" ? value : label
    const back = parseCell(column, raw)
    const text =
      back.ok && back.value !== null && cellsEqual(column, back.value, value)
        ? raw
        : label
    return { text, label, count }
  })
}

const PERIOD_WORDS: Readonly<Record<string, string>> = {
  thisWeek: "this week",
  lastWeek: "last week",
  nextWeek: "next week",
  thisMonth: "this month",
  lastMonth: "last month",
  nextMonth: "next month",
  thisYear: "this year",
  lastYear: "last year",
  nextYear: "next year",
}

/** The words for a period of "is within", such as "this month". */
export function periodLabel(period: string): string {
  return PERIOD_WORDS[period] ?? period
}

/** The periods "is within" takes, with their words. */
export const PERIOD_CHOICES: readonly { value: string; label: string }[] =
  DATE_PERIODS.map((p) => ({ value: p, label: periodLabel(p) }))

/** A condition in words, part by part, for a chip and its accessible name. */
export type ConditionWords = {
  column: string
  op: string
  /** The values in words, one per value; empty for a filter with none. */
  values: string[]
  /** The values for the chip: quoted texts, "0.2 and 0.8", or "3 values". */
  value: string
  /** The whole condition, for a screen reader: "Status, is any of, Open and Paused". */
  sentence: string
}

/**
 * Puts a condition in words with the column's type: values that parse are
 * shown as the column shows them ("Needs review" for an option's value,
 * "80%" in a percent column), texts a word filter matches are quoted so
 * spaces show, and more than two values become a count. A value that does
 * not parse is shown as typed.
 */
export function describeCondition<Row>(
  condition: FilterCondition,
  column: Column<Row> | undefined
): ConditionWords {
  if (!column) {
    const values = [...condition.values]
    return {
      column: condition.column,
      op: condition.op,
      values,
      value: values.join(", "),
      sentence: [condition.column, condition.op, ...values].join(", "),
    }
  }
  const f = resolveColumnType(column).def.filters?.find(
    (x) => x.id === condition.op
  )
  const op = filterLabel(column, condition.op, condition.not)
  const count =
    f?.operands === "many"
      ? condition.values.length
      : typeof f?.operands === "number"
        ? f.operands
        : condition.values.length
  const texts = condition.values.slice(0, count)
  let values: string[]
  if (f?.text) {
    values = texts.map((t) => `"${t}"`)
  } else if (condition.op === "inLast" || condition.op === "inNext") {
    values = [texts.join(" ")]
  } else if (condition.op === "within") {
    values = texts.map(periodLabel)
  } else {
    values = texts.map((t) => {
      const parsed = parseCell(column, t)
      return parsed.ok && parsed.value !== null
        ? formatCell(column, parsed.value)
        : t
    })
  }
  const value =
    f?.operands === 2 && values.length === 2
      ? `${values[0]} and ${values[1]}`
      : values.length > 2
        ? `${values.length} values`
        : values.join(", ")
  const spoken =
    values.length > 1
      ? `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`
      : (values[0] ?? "")
  return {
    column: column.header,
    op,
    values,
    value,
    sentence: [column.header, op, spoken].filter(Boolean).join(", "),
  }
}
