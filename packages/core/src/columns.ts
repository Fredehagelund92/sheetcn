import { resolveColumnType } from "./cells.js"
import type { TypeRegistry } from "./registry.js"
import type { CellValue, Column, ColumnSpec } from "./types.js"

/** Keys of `Row` whose values fit `V` (or are empty). */
export type KeysOfType<Row, V> = {
  [K in keyof Row & string]: Row[K] extends V | null | undefined ? K : never
}[keyof Row & string]

type Shared<Row, V extends CellValue> = Partial<
  Pick<
    Column<Row, V>,
    | "header"
    | "write"
    | "readOnly"
    | "width"
    | "minWidth"
    | "maxWidth"
    | "grow"
    | "pin"
    | "format"
    | "parse"
    | "validate"
  >
>

/** Options for a column read from a row property; `id` defaults to the key. */
export type KeyColumnOptions<Row, V extends CellValue> = Shared<Row, V> & {
  id?: string
  value?: never
}

/** Options for a column read by a function. It is read-only unless `write` is given. */
export type AccessorColumnOptions<Row, V extends CellValue> = Shared<Row, V> & {
  value: (row: Row) => V | null
}

/**
 * Throws when ids repeat, or when a column's type is unknown or rejects its
 * options (a select's labels must be filled in and distinct, for instance).
 * With `types`, also when a column's type is not the one `types` defines
 * under its id.
 */
export function assertColumns<Row>(
  columns: readonly Column<Row>[],
  types?: Pick<TypeRegistry, "get">
): void {
  const ids = new Set<string>()
  for (const column of columns) {
    if (ids.has(column.id)) {
      throw new Error(`Two columns have the id "${column.id}"`)
    }
    ids.add(column.id)
    const { def } = resolveColumnType(column)
    if (types && types.get(column.type) !== def) {
      throw new Error(
        `Column "${column.id}" has the type "${column.type}", which this sheet's types ${types.get(column.type) ? "define differently" : "do not include"}`
      )
    }
  }
}

/** The plain-data part of a column, for persistence and history. */
export function toColumnSpec<Row>(column: Column<Row>): ColumnSpec {
  const spec: ColumnSpec = {
    id: column.id,
    header: column.header,
    type: column.type,
  }
  if (column.typeOptions !== undefined) spec.typeOptions = column.typeOptions
  if (column.width !== undefined) spec.width = column.width
  if (column.minWidth !== undefined) spec.minWidth = column.minWidth
  if (column.maxWidth !== undefined) spec.maxWidth = column.maxWidth
  if (column.grow !== undefined) spec.grow = column.grow
  if (column.pin !== undefined) spec.pin = column.pin
  if (typeof column.readOnly === "boolean") spec.readOnly = column.readOnly
  return spec
}

/** Reads a cell. A missing property reads as empty. */
export function getCellValue<Row>(column: Column<Row>, row: Row): CellValue {
  const v =
    typeof column.value === "function" ? column.value(row) : row[column.value]
  return (v ?? null) as CellValue
}

/** True when the column has no `write`, or `readOnly` says so for this row. */
export function isCellReadOnly<Row>(column: Column<Row>, row: Row): boolean {
  if (!column.write) return true
  const { readOnly } = column
  return typeof readOnly === "function" ? readOnly(row) : readOnly === true
}
