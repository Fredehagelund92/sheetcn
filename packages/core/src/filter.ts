import { resolveColumnType } from "./cells.js"
import { filterEnv } from "./column-types/dates.js"
import { getCellValue } from "./columns.js"
import { foldedTextFor } from "./text-cache.js"
import type { FilterEnv, FilterOp } from "./type-def.js"
import type { Column } from "./types.js"
import {
  isFilterGroup,
  type FilterCondition,
  type FilterGroup,
  type SheetView,
  type ViewIssue,
} from "./view.js"

export type CompileFilterOptions = {
  /**
   * Today's date in ISO form, for relative dates such as "in the last 7
   * days". Default: the local date where the code runs, read once per
   * compile.
   */
  today?: string
}

/** A row test over one row array, by row and position. */
export type RowTest<Row> = (row: Row, index: number) => boolean

/** A filter read once, ready to test many rows. */
export type CompiledFilter<Row> = {
  /**
   * Conditions that cannot apply and are skipped: an unknown column or
   * filter, a missing value, or a value that does not parse.
   */
  readonly issues: readonly ViewIssue[]
  /** False when no condition applies, so every row passes. */
  readonly active: boolean
  /**
   * The test for the rows of one array. Bind once per array: text filters
   * keep the folded text of each cell with the array.
   */
  bind(rows: readonly Row[]): RowTest<Row>
}

// A condition, compiled: the test for the rows of an array.
type Node<Row> = (rows: readonly Row[]) => RowTest<Row>

const passAll = () => true

function compileCondition<Row>(
  condition: FilterCondition,
  path: readonly number[],
  columns: ReadonlyMap<string, Column<Row>>,
  env: FilterEnv,
  issues: ViewIssue[]
): Node<Row> | null {
  const skip = (message: string) => {
    issues.push({ part: "filter", path, message })
    return null
  }
  const column = columns.get(condition.column)
  if (!column) return skip(`There is no column "${condition.column}"`)
  const { def, prepared } = resolveColumnType(column)
  const op = def.filters?.find((f) => f.id === condition.op) as
    FilterOp<never> | undefined
  if (!op) {
    return skip(
      `Column "${column.header}" (${def.label}) has no filter "${condition.op}"`
    )
  }
  const values = condition.values
  const wanted =
    op.operands === "many" ? Math.max(values.length, 1) : op.operands
  for (let i = 0; i < wanted; i++) {
    if ((values[i] ?? "").trim() === "") {
      return skip(
        op.operands === 2 ? "Two values are needed" : "A value is needed"
      )
    }
  }
  const operands = values.slice(0, wanted)
  const not = condition.not === true

  if (op.text) {
    const compiled = op.compile(operands, prepared, env)
    if (!compiled.ok) return skip(compiled.error)
    const test = compiled.value
    const text = op.text
    return (rows) => {
      const folded = foldedTextFor(rows, column, text, prepared)
      return not
        ? (row, i) => !test(folded(row, i))
        : (row, i) => test(folded(row, i))
    }
  }
  const compiled = op.compile(operands, prepared, env)
  if (!compiled.ok) return skip(compiled.error)
  const test = compiled.value as (value: unknown) => boolean
  const key = typeof column.value === "string" ? column.value : null
  let node: RowTest<Row>
  if (key !== null) {
    // The common case, a row property, read without a call.
    node = not
      ? (row) => !test(row[key as keyof Row] ?? null)
      : (row) => test(row[key as keyof Row] ?? null)
  } else {
    node = not
      ? (row) => !test(getCellValue(column, row))
      : (row) => test(getCellValue(column, row))
  }
  return () => node
}

function compileGroup<Row>(
  group: FilterGroup,
  path: readonly number[],
  columns: ReadonlyMap<string, Column<Row>>,
  env: FilterEnv,
  issues: ViewIssue[]
): Node<Row> | null {
  const nodes: Node<Row>[] = []
  group.items.forEach((item, i) => {
    const at = [...path, i]
    const node = isFilterGroup(item)
      ? compileGroup(item, at, columns, env, issues)
      : compileCondition(item, at, columns, env, issues)
    if (node) nodes.push(node)
  })
  if (nodes.length === 0) return null
  if (nodes.length === 1) return nodes[0] as Node<Row>
  const all = group.match !== "any"
  return (rows) => {
    const tests = nodes.map((n) => n(rows))
    const count = tests.length
    return all
      ? (row, index) => {
          for (let t = 0; t < count; t++) {
            if (!(tests[t] as RowTest<Row>)(row, index)) return false
          }
          return true
        }
      : (row, index) => {
          for (let t = 0; t < count; t++) {
            if ((tests[t] as RowTest<Row>)(row, index)) return true
          }
          return false
        }
  }
}

/**
 * Reads a filter once against the columns, for testing many rows: each
 * condition's values are parsed here, not per cell. A condition that cannot
 * apply is skipped and listed in `issues`, so a saved view that names a
 * removed column still runs; a group left with nothing that applies is
 * skipped too. The tree may nest to any depth.
 */
export function compileFilter<Row>(
  filter: FilterGroup | undefined,
  columns: readonly Column<Row>[],
  options: CompileFilterOptions = {}
): CompiledFilter<Row> {
  const issues: ViewIssue[] = []
  const env = filterEnv(options.today)
  const byId = new Map(columns.map((c) => [c.id, c]))
  const node = filter ? compileGroup(filter, [], byId, env, issues) : null
  return {
    issues,
    active: node !== null,
    bind: node ?? (() => passAll),
  }
}

/**
 * How many of the rows a view shows: for a count on a saved view's tab, say.
 * One pass of its filter; sort and group do not change the count.
 */
export function countRows<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  view: SheetView,
  options: CompileFilterOptions = {}
): number {
  const compiled = compileFilter(view.filter, columns, options)
  if (!compiled.active) return rows.length
  const test = compiled.bind(rows)
  let count = 0
  for (let i = 0; i < rows.length; i++) {
    if (test(rows[i] as Row, i)) count++
  }
  return count
}
