import {
  cellSelectionFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  tableFeatures,
  type Row,
  type RowData,
  type Table,
} from "@tanstack/react-table"

import { createSheetCoreRowModel } from "./row-model.js"
import { createSheetViewRowModel, ViewHolder } from "./view-row-model.js"

/**
 * The TanStack features of one sheet, whose rows follow the view in `view`.
 * `useSheet` makes one per sheet.
 */
export function createSheetFeatures(view: ViewHolder) {
  return tableFeatures({
    cellSelectionFeature,
    columnSizingFeature,
    columnResizingFeature,
    columnPinningFeature,
    columnVisibilityFeature,
    // Registered for its row model slot only: the sheet's view (filter,
    // sort and group) takes the sorted row model's place, and `useSheet`
    // turns TanStack's own sorting off.
    rowSortingFeature,
    coreRowModel: createSheetCoreRowModel(),
    sortedRowModel: createSheetViewRowModel(view),
  })
}

/** The TanStack features a sheet registers, with no view, for its types. */
export const sheetFeatures = createSheetFeatures(new ViewHolder())

export type SheetFeatures = typeof sheetFeatures
export type SheetTable<TRow extends RowData> = Table<SheetFeatures, TRow>
export type SheetRow<TRow extends RowData> = Row<SheetFeatures, TRow>
