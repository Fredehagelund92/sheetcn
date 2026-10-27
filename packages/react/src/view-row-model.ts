import type { ViewModel } from "@sheetcn/core"
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
 * A row model that shows the rows of a sheet's view: filtered, grouped and
 * sorted by the core's `createViewModel`, in the sorted row model's place.
 * It reuses the core row model's `Row` objects, so a one-cell commit costs
 * the view's update (the changed row tested again and moved) and one pass
 * that lists the shown rows, not a rebuild. `rowsById` holds every row; a
 * row the view hides has no display index.
 */
export function createSheetViewRowModel(view: ViewHolder) {
  return <TFeatures extends TableFeatures, TData extends RowData>(
    table: Table<TFeatures, TData>
  ) =>
    tableMemo({
      feature: "coreRowModelsFeature",
      table,
      fnName: "table.getSortedRowModel",
      memoDeps: () => [table.getPreSortedRowModel(), view.model],
      fn: (): RowModel<TFeatures, TData> => {
        const core = table.getPreSortedRowModel()
        const model = view.model as ViewModel<TData> | null
        if (!model?.active) return core
        const result = model.compute(table.options.data)
        const n = result.rows.length
        const rows = new Array<Row<TFeatures, TData>>(n)
        for (let p = 0; p < n; p++) {
          rows[p] = core.rows[result.sourceIndex(p)] as Row<TFeatures, TData>
        }
        return { rows, flatRows: rows, rowsById: core.rowsById }
      },
    })
}
