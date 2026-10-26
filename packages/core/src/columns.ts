import type { CellValue, Column, ColumnType, SelectOption } from "./types.js"

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

type WithOptions = { options: SelectOption[] }

type Helper<Row, V extends CellValue, Extra = unknown> = {
  (
    key: KeysOfType<Row, V>,
    options?: KeyColumnOptions<Row, V> & Extra
  ): Column<Row, V>
  (id: string, options: AccessorColumnOptions<Row, V> & Extra): Column<Row, V>
}

export type ColumnHelpers<Row> = {
  text: Helper<Row, string>
  number: Helper<Row, number>
  /** Dates are stored as ISO strings ("2026-03-01"). */
  date: Helper<Row, string>
  select: {
    (
      key: KeysOfType<Row, string>,
      options: KeyColumnOptions<Row, string> & WithOptions
    ): Column<Row, string>
    (
      id: string,
      options: AccessorColumnOptions<Row, string> & WithOptions
    ): Column<Row, string>
  }
  boolean: Helper<Row, boolean>
}

type Row = Record<string, unknown>

function makeHelper(type: ColumnType) {
  return (
    keyOrId: string,
    options: Partial<AccessorColumnOptions<Row, CellValue>> & {
      id?: string
      options?: SelectOption[]
    } = {}
  ): Column<Row> => {
    const { value, id, ...rest } = options
    if (typeof value === "function") {
      return { header: keyOrId, ...rest, id: keyOrId, type, value }
    }
    return {
      write: (row, next) => ({ ...row, [keyOrId]: next }),
      header: id ?? keyOrId,
      ...rest,
      id: id ?? keyOrId,
      type,
      value: keyOrId,
    }
  }
}

const helpers = {
  text: makeHelper("text"),
  number: makeHelper("number"),
  date: makeHelper("date"),
  select: makeHelper("select"),
  boolean: makeHelper("boolean"),
}

/**
 * Builds a typed column list. Each helper checks that a key holds the right
 * kind of value, and the result is a plain `Column<Row>[]`:
 *
 * ```ts
 * const columns = defineColumns<Item>((c) => [
 *   c.text("name", { header: "Name" }),
 *   c.number("price", { format: (v) => v.toFixed(2) }),
 *   c.number("total", { value: (row) => row.price * row.qty }),
 * ])
 * ```
 */
export function defineColumns<Row>(
  build: (c: ColumnHelpers<Row>) => Column<Row>[]
): Column<Row>[] {
  const columns = build(helpers as unknown as ColumnHelpers<Row>)
  assertColumns(columns)
  return columns
}

/**
 * Throws when ids repeat, or when a select column has an empty label or
 * repeats an option value or label (a pasted label must name one option).
 */
export function assertColumns<Row>(columns: readonly Column<Row>[]): void {
  const ids = new Set<string>()
  for (const column of columns) {
    if (ids.has(column.id)) {
      throw new Error(`Two columns have the id "${column.id}"`)
    }
    ids.add(column.id)
    if (column.type !== "select") continue
    const values = new Set<string>()
    const labels = new Set<string>()
    for (const o of column.options ?? []) {
      if (o.label.trim() === "") {
        throw new Error(`Column "${column.id}" has an option with no label`)
      }
      if (values.has(o.value) || labels.has(o.label)) {
        throw new Error(
          `Column "${column.id}" has two options with the value "${o.value}" or the label "${o.label}"`
        )
      }
      values.add(o.value)
      labels.add(o.label)
    }
  }
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
