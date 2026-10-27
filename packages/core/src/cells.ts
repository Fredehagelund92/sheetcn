import { builtInTypes } from "./built-in-types.js"
import { filterEnv } from "./column-types/dates.js"
import { collator, fold, isList, listsEqual } from "./column-types/shared.js"
import type { AnyColumnTypeDef } from "./type-def.js"
import type { CellValue, Column, Issue, ParseResult } from "./types.js"
import { valueIndexFor, valueKey } from "./value-index.js"

/** A column's type, resolved: its definition, options and prepared state. */
export type ResolvedType = {
  def: AnyColumnTypeDef
  /** The column's `typeOptions` over the type's defaults. */
  options: object
  /** What the type's `prepare` built from the options. */
  prepared: unknown
}

const builtInById = new Map<string, AnyColumnTypeDef>(
  builtInTypes.map((d) => [d.id, d as AnyColumnTypeDef])
)

// Prepared once per column object. Columns are immutable, so this is a cache.
const resolved = new WeakMap<object, ResolvedType>()

/**
 * The column's type: the `typeDef` its registry set, or the built-in type
 * `type` names. The type's `prepare` runs on the first call for each column.
 * Throws when the type is unknown or rejects the column's options.
 */
export function resolveColumnType<Row>(column: Column<Row>): ResolvedType {
  const cached = resolved.get(column)
  if (cached) return cached
  const def = column.typeDef ?? builtInById.get(column.type)
  if (!def) {
    throw new Error(
      `Column "${column.id}" has the type "${column.type}", which is not built in; build the column with the registry that defines it`
    )
  }
  if (def.id !== column.type) {
    throw new Error(
      `Column "${column.id}" has the type "${column.type}" but the definition of "${def.id}"`
    )
  }
  const options = { ...def.defaultOptions, ...column.typeOptions }
  let prepared: unknown = options
  if (def.prepare) {
    try {
      prepared = def.prepare(options)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Column "${column.id}": ${reason}`, { cause: error })
    }
  }
  const type = { def, options, prepared }
  resolved.set(column, type)
  return type
}

/** Text to a cell value: the column's own `parse`, or its type's. */
export function parseCell<Row>(
  column: Column<Row>,
  text: string
): ParseResult<CellValue> {
  if (column.parse) return column.parse(text)
  const { def, prepared } = resolveColumnType(column)
  return def.parse(text, prepared)
}

/**
 * A cell value to text for display and copy. Empty cells format as "".
 * Pass the row for display, so a type can show it per row (a money column's
 * `currencyFrom`); copy and editing pass none.
 */
export function formatCell<Row>(
  column: Column<Row>,
  value: CellValue,
  row?: Row
): string {
  if (value === null) return ""
  if (column.format) return column.format(value)
  const { def, prepared } = resolveColumnType(column)
  return def.format(value, prepared, row)
}

/**
 * Checks a cell: first with the column's type (its `validateEmpty` for an
 * empty cell), then, for a type whose values are `unique`, against the rest
 * of the column, then with the column's own `validate`. The uniqueness check
 * needs `rows`, the rows `row` is one of; it flags a repeat with another row
 * that holds the value: "Also in row 12" (positions count from 1). It keeps
 * an index of the column's values with the rows array, which a commit
 * patches rather than rebuilds.
 */
export function validateCell<Row>(
  column: Column<Row>,
  value: CellValue,
  row: Row,
  rows?: readonly Row[]
): Issue | null {
  const { def, prepared } = resolveColumnType(column)
  const issue =
    value === null
      ? (def.validateEmpty?.(prepared, row) ?? null)
      : (def.validate?.(value, prepared, row) ??
        (def.unique && rows ? repeatIssue(column, value, row, rows) : null))
  if (issue) return issue
  return column.validate ? column.validate(value, row) : null
}

function repeatIssue<Row>(
  column: Column<Row>,
  value: CellValue,
  row: Row,
  rows: readonly Row[]
): Issue | null {
  const holders = valueIndexFor(rows, column).get(valueKey(value))
  if (!holders || holders.size < 2) return null
  // One forward pass that stops at the first other row holding the value.
  for (let at = 0; at < rows.length; at++) {
    const other = rows[at] as Row
    if (other !== row && holders.has(other)) {
      return { message: `Also in row ${at + 1}` }
    }
  }
  return null
}

/**
 * Whether two values of the column are the same, by its type's `equals`.
 * Without one, lists are the same when their items are, and other values
 * when `Object.is` says so.
 */
export function cellsEqual<Row>(
  column: Column<Row>,
  a: CellValue,
  b: CellValue
): boolean {
  if (a === null || b === null) return a === b
  const { equals } = resolveColumnType(column).def
  if (equals) return equals(a, b)
  return isList(a) && isList(b) ? listsEqual(a, b) : Object.is(a, b)
}

/**
 * Orders two values of the column by its type's `compare`, or by their
 * formatted text. Empty cells come last.
 */
export function compareCells<Row>(
  column: Column<Row>,
  a: CellValue,
  b: CellValue
): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1
  const { def, prepared } = resolveColumnType(column)
  if (def.compare) return def.compare(a, b, prepared)
  return collator.compare(formatCell(column, a), formatCell(column, b))
}

/**
 * Runs one of the type's filters on one value: whether the cell passes. The
 * operands are read on every call; to filter many rows, compile a view's
 * filter once with `compileFilter`. Operands that do not parse match
 * nothing. Throws when the type has no filter with that id.
 */
export function filterCell<Row>(
  column: Column<Row>,
  filterId: string,
  value: CellValue,
  operands: readonly string[] = [],
  options: { today?: string } = {}
): boolean {
  const { def, prepared } = resolveColumnType(column)
  const filter = def.filters?.find((f) => f.id === filterId)
  if (!filter) {
    throw new Error(
      `Column "${column.id}" (${def.label}) has no filter "${filterId}"`
    )
  }
  const env = filterEnv(options.today)
  if (filter.text) {
    const compiled = filter.compile(operands, prepared, env)
    if (!compiled.ok) return false
    return compiled.value(
      value === null ? null : fold(filter.text(value, prepared))
    )
  }
  const compiled = filter.compile(operands, prepared, env)
  return compiled.ok && compiled.value(value)
}
