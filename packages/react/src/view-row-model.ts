import type { ViewChange, ViewModel, ViewResult } from "@sheetcn/core"
import {
  tableMemo,
  type Row,
  type RowData,
  type RowModel,
  type Table,
  type TableFeatures,
} from "@tanstack/react-table"

/**
 * The view one sheet shows: `useSheet` points it at the view model on every
 * render, before the table reads its rows.
 */
export class ViewHolder {
  model: ViewModel<never> | null = null

  show(model: ViewModel<never> | null): void {
    this.model = model
  }
}

/**
 * The row models whose rows already hold their display index
 * (`_displayIndexCache`), set as the rows were listed, so asking for the
 * rows in display order needs no pass that numbers every row.
 */
export const numbered = new WeakSet<object>()

/**
 * Makes `change` to `rows` (the last result's rows, which it turns into the
 * new result's) and returns the first and last position whose row is not the
 * one that was there: the rows outside keep their place.
 */
function applyMoves<T>(
  rows: T[],
  { removed, inserted }: ViewChange<unknown>,
  source: readonly T[]
): [from: number, to: number] {
  const [out] = removed
  const [put] = inserted
  if (
    out !== undefined &&
    put &&
    removed.length === 1 &&
    inserted.length === 1
  ) {
    // One row moved: the rows between shift by one place.
    const { at } = put
    if (out < at) rows.copyWithin(out, out + 1, at + 1)
    else if (at < out) rows.copyWithin(at + 1, at, out)
    rows[at] = source[put.source] as T
    return [Math.min(out, at), Math.max(out, at)]
  }
  let from = rows.length
  let to = 0
  for (const p of removed) {
    rows.splice(p, 1)
    from = Math.min(from, p)
    to = Math.max(to, p)
  }
  for (const { at, source: i } of inserted) {
    rows.splice(at, 0, source[i] as T)
    from = Math.min(from, at)
    to = Math.max(to, at)
  }
  // Rows after the last moved one keep their place only when as many rows
  // went in as came out.
  return [from, removed.length === inserted.length ? to : rows.length - 1]
}

/**
 * A row model that shows the rows of a sheet's view: filtered, grouped and
 * sorted by the core's `createViewModel`, in the sorted row model's place.
 * It reuses the core row model's `Row` objects, and when the view says how
 * its rows changed (a one-cell commit: the changed row tested again and
 * moved), it makes the same moves in the last array of rows instead of
 * listing every shown row again. `rowsById` holds every row; a row the view
 * hides has no display index.
 */
export function createSheetViewRowModel(view: ViewHolder) {
  return <TFeatures extends TableFeatures, TData extends RowData>(
    table: Table<TFeatures, TData>
  ) => {
    // The last rows listed, with what they were listed from.
    let last: {
      result: ViewResult<TData>
      byId: RowModel<TFeatures, TData>["rowsById"]
      rows: Row<TFeatures, TData>[]
    } | null = null
    return tableMemo({
      feature: "coreRowModelsFeature",
      table,
      fnName: "table.getSortedRowModel",
      memoDeps: () => [table.getPreSortedRowModel(), view.model],
      fn: (): RowModel<TFeatures, TData> => {
        const core = table.getPreSortedRowModel()
        const model = view.model as ViewModel<TData> | null
        if (!model?.active) return core
        const result = model.compute(table.options.data)
        // The core model keeps `rowsById` while no row id has moved, so its
        // `Row`s are the ones listed last time except where a row changed.
        const { change } = result
        let rows: Row<TFeatures, TData>[]
        if (
          last &&
          change?.from === last.result &&
          last.byId === core.rowsById
        ) {
          rows = last.rows.slice()
          const [from, to] = applyMoves(rows, change, core.rows)
          for (let p = from; p <= to; p++) {
            ;(rows[p] as Row<TFeatures, TData>)._displayIndexCache = p
          }
        } else {
          const n = result.rows.length
          rows = new Array<Row<TFeatures, TData>>(n)
          for (let p = 0; p < n; p++) {
            const row = core.rows[result.sourceIndex(p)] as Row<
              TFeatures,
              TData
            >
            row._displayIndexCache = p
            rows[p] = row
          }
        }
        last = { result, byId: core.rowsById, rows }
        const shown = { rows, flatRows: rows, rowsById: core.rowsById }
        numbered.add(shown)
        return shown
      },
    })
  }
}
