import { handOverIndex, indexFor } from "./row-index.js"
import type { Change, Column, InsertedRow, Patch } from "./types.js"

/** What applying a change needs to know about the rows. */
export type ChangeContext<Row> = {
  columns: readonly Column<Row>[]
  /** A pure function of the row. Ids are unique and never change. */
  getRowId: (row: Row) => string
}

const columnMaps = new WeakMap<object, Map<string, unknown>>()

function writerFor<Row>(
  columns: readonly Column<Row>[],
  columnId: string
): NonNullable<Column<Row>["write"]> {
  let map = columnMaps.get(columns) as Map<string, Column<Row>> | undefined
  if (!map) {
    map = new Map(columns.map((c) => [c.id, c]))
    columnMaps.set(columns, map)
  }
  const column = map.get(columnId)
  if (!column) throw new Error(`There is no column "${columnId}"`)
  if (!column.write) throw new Error(`Column "${columnId}" is read-only`)
  return column.write
}

function writePatch<Row>(row: Row, patch: Patch, ctx: ChangeContext<Row>): Row {
  const next = writerFor(ctx.columns, patch.columnId)(row, patch.to)
  if (ctx.getRowId(next) !== patch.rowId) {
    throw new Error(
      `Writing column "${patch.columnId}" changed the id of row "${patch.rowId}"`
    )
  }
  return next
}

/**
 * Positions in the array after the insert step, found through the index of
 * the rows the change applies to. An existing row at position p moves down by
 * the number of inserted rows that land before it.
 */
class Positions<Row> {
  readonly #rows: readonly Row[]
  readonly #ctx: ChangeContext<Row>
  readonly #inserted = new Map<string, number>()
  // For the j-th inserted row, the existing position it is inserted before.
  readonly #before: number[] = []

  constructor(
    rows: readonly Row[],
    inserted: readonly InsertedRow<Row>[],
    ctx: ChangeContext<Row>
  ) {
    this.#rows = rows
    this.#ctx = ctx
    const index = indexFor(rows)
    inserted.forEach(({ index: at, row }, j) => {
      const before = at - j
      const last = this.#before.at(-1) ?? 0
      if (!Number.isInteger(at) || before < last || before > rows.length) {
        throw new Error(
          `Inserted row ${j} has index ${at}; indexes must ascend and stay within the rows`
        )
      }
      const id = ctx.getRowId(row)
      if (
        this.#inserted.has(id) ||
        index.indexOf(rows, ctx.getRowId, id) >= 0
      ) {
        throw new Error(`Two rows have the id "${id}"`)
      }
      this.#inserted.set(id, at)
      this.#before.push(before)
    })
  }

  /** The row's position after the insert step, or -1. */
  of(rowId: string): number {
    const inserted = this.#inserted.get(rowId)
    if (inserted !== undefined) return inserted
    const p = indexFor(this.#rows).indexOf(
      this.#rows,
      this.#ctx.getRowId,
      rowId
    )
    if (p < 0) return -1
    // Count the inserted rows that land before p (binary search on #before).
    let lo = 0
    let hi = this.#before.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((this.#before[mid] as number) <= p) lo = mid + 1
      else hi = mid
    }
    return p + lo
  }

  isInserted(rowId: string): boolean {
    return this.#inserted.has(rowId)
  }

  require(rowId: string): number {
    const p = this.of(rowId)
    if (p < 0) throw new Error(`There is no row "${rowId}"`)
    return p
  }
}

function removedPositions<Row>(
  change: Change<Row>,
  positions: Positions<Row>
): Map<string, number> {
  const removed = new Map<string, number>()
  for (const id of change.removedRowIds ?? []) {
    if (!removed.has(id)) removed.set(id, positions.require(id))
  }
  return removed
}

/**
 * Returns new rows with the change applied, leaving `rows` untouched. Only
 * the patched rows are copied; every other row object is shared. A change
 * that only patches cells costs O(patches) plus one copy of the array of
 * references. Throws when the change names an unknown row or column, inserts
 * an id that exists, or writes a column that has no `write`.
 */
export function applyChange<Row>(
  rows: readonly Row[],
  change: Change<Row>,
  ctx: ChangeContext<Row>
): Row[] {
  const inserted = change.insertedRows ?? []
  if (!inserted.length && !change.removedRowIds?.length) {
    const index = indexFor(rows)
    const next = rows.slice()
    for (const patch of change.patches) {
      const p = index.indexOf(rows, ctx.getRowId, patch.rowId)
      if (p < 0) throw new Error(`There is no row "${patch.rowId}"`)
      next[p] = writePatch(next[p] as Row, patch, ctx)
    }
    handOverIndex(rows, next)
    return next
  }

  const positions = new Positions(rows, inserted, ctx)
  // Insert step: merge the old rows and the inserted ones in one pass.
  const merged: Row[] = []
  let from = 0
  for (const { index, row } of inserted) {
    while (merged.length < index) merged.push(rows[from++] as Row)
    merged.push(row)
  }
  while (from < rows.length) merged.push(rows[from++] as Row)

  for (const patch of change.patches) {
    const p = positions.require(patch.rowId)
    merged[p] = writePatch(merged[p] as Row, patch, ctx)
  }

  const removed = removedPositions(change, positions)
  let next = merged
  let stale = inserted[0]?.index ?? merged.length
  if (removed.size) {
    const drop = new Set(removed.values())
    next = merged.filter((_, i) => !drop.has(i))
    for (const i of drop) stale = Math.min(stale, i)
  }
  const index = handOverIndex(rows, next, stale)
  for (const id of removed.keys()) index.positions.delete(id)
  return next
}

/**
 * The change that undoes `change` when it is applied to the rows `change`
 * produced from `rows`. Call it before applying `change`.
 */
export function invertChange<Row>(
  rows: readonly Row[],
  change: Change<Row>,
  ctx: ChangeContext<Row>
): Change<Row> {
  const inserted = change.insertedRows ?? []
  const positions = new Positions(rows, inserted, ctx)
  const insertedById = new Map(
    inserted.map(({ row }) => [ctx.getRowId(row), row])
  )
  const removed = removedPositions(change, positions)
  // A removed row comes back as it was just before removal, patches included.
  const restoredRows = new Map<string, Row>()
  for (const id of removed.keys()) {
    restoredRows.set(
      id,
      insertedById.has(id)
        ? (insertedById.get(id) as Row)
        : (rows[indexFor(rows).indexOf(rows, ctx.getRowId, id)] as Row)
    )
  }
  for (const patch of change.patches) {
    const row = restoredRows.get(patch.rowId)
    if (row !== undefined) {
      restoredRows.set(patch.rowId, writePatch(row, patch, ctx))
    }
  }
  const restored: InsertedRow<Row>[] = []
  for (const [id, index] of removed) {
    restored.push({ index, row: restoredRows.get(id) as Row })
  }
  restored.sort((a, b) => a.index - b.index)

  const inverse: Change<Row> = {
    source: change.source,
    patches: change.patches
      .map((p) => ({ ...p, from: p.to, to: p.from }))
      .reverse(),
  }
  if (restored.length) inverse.insertedRows = restored
  if (inserted.length) {
    inverse.removedRowIds = inserted.map(({ row }) => ctx.getRowId(row))
  }
  return inverse
}
