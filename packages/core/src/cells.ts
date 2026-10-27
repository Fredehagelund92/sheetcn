import { builtInTypes, collator } from "./built-in-types.js"
import type { AnyColumnTypeDef } from "./type-def.js"
import type { CellValue, Column, Issue, ParseResult } from "./types.js"

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

/** A cell value to text for display and copy. Empty cells format as "". */
export function formatCell<Row>(column: Column<Row>, value: CellValue): string {
  if (value === null) return ""
  if (column.format) return column.format(value)
  const { def, prepared } = resolveColumnType(column)
  return def.format(value, prepared)
}

/**
 * Checks a stored value: first with the column's type, then with the
 * column's own `validate`. Empty cells pass the type check.
 */
export function validateCell<Row>(
  column: Column<Row>,
  value: CellValue,
  row: Row
): Issue | null {
  if (value !== null) {
    const { def, prepared } = resolveColumnType(column)
    const issue = def.validate?.(value, prepared, row) ?? null
    if (issue) return issue
  }
  return column.validate ? column.validate(value, row) : null
}

/** Whether two values of the column are the same, by its type's `equals`. */
export function cellsEqual<Row>(
  column: Column<Row>,
  a: CellValue,
  b: CellValue
): boolean {
  if (a === null || b === null) return a === b
  const { equals } = resolveColumnType(column).def
  return equals ? equals(a, b) : Object.is(a, b)
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
