import { isList } from "./column-types/shared.js"
import type { CellValue, Column } from "./types.js"

/** The rows that hold each value of one column, by `valueKey`. */
export type ValueIndex = Map<unknown, Set<unknown>>

// Per row array, per column. A change hands its indexes on to the array it
// produces (see `handOverValueIndexes`), so a commit patches them instead of
// rebuilding them.
const indexes = new WeakMap<readonly unknown[], Map<object, ValueIndex>>()

/** The key a value is indexed under: lists by their items. */
export function valueKey(value: CellValue): unknown {
  return isList(value) ? JSON.stringify(value) : value
}

function read<Row>(column: Column<Row>, row: Row): CellValue {
  const v =
    typeof column.value === "function" ? column.value(row) : row[column.value]
  return (v ?? null) as CellValue
}

function add(index: ValueIndex, key: unknown, row: unknown) {
  let rows = index.get(key)
  if (!rows) {
    rows = new Set()
    index.set(key, rows)
  }
  rows.add(row)
}

function remove(index: ValueIndex, key: unknown, row: unknown) {
  const rows = index.get(key)
  if (!rows) return
  rows.delete(row)
  if (!rows.size) index.delete(key)
}

/**
 * The index of a column's values over a row array, built on first use (one
 * pass over the rows) and kept with the array.
 */
export function valueIndexFor<Row>(
  rows: readonly Row[],
  column: Column<Row>
): ValueIndex {
  let byColumn = indexes.get(rows)
  if (!byColumn) {
    byColumn = new Map()
    indexes.set(rows, byColumn)
  }
  let index = byColumn.get(column)
  if (!index) {
    index = new Map()
    for (const row of rows) {
      const value = read(column, row)
      if (value !== null) add(index, valueKey(value), row)
    }
    byColumn.set(column, index)
  }
  return index
}

/**
 * Passes the value indexes of `from` on to `to`, the array a change produced
 * from it, updated for the rows the change replaced. `rows` lists each such
 * row as it was (undefined when inserted) and as it is (undefined when
 * removed); it is only read when `from` has indexes. `from` loses them and
 * rebuilds on its next use.
 */
export function handOverValueIndexes<Row>(
  from: readonly Row[],
  to: readonly Row[],
  rows: () => Iterable<readonly [Row | undefined, Row | undefined]>
): void {
  const byColumn = indexes.get(from)
  if (!byColumn) return
  indexes.delete(from)
  const changed = [...rows()]
  for (const [column, index] of byColumn as Map<Column<Row>, ValueIndex>) {
    for (const [before, after] of changed) {
      if (before !== undefined) {
        const value = read(column, before)
        if (value !== null) remove(index, valueKey(value), before)
      }
      if (after !== undefined) {
        const value = read(column, after)
        if (value !== null) add(index, valueKey(value), after)
      }
    }
  }
  indexes.set(to, byColumn)
}
