import {
  cellSelectionFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  tableFeatures,
  type Row,
  type RowData,
  type Table,
} from "@tanstack/react-table"

import { createSheetCoreRowModel } from "./row-model.js"

/** The TanStack features a sheet registers. */
export const sheetFeatures = tableFeatures({
  cellSelectionFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnPinningFeature,
  coreRowModel: createSheetCoreRowModel(),
})

export type SheetFeatures = typeof sheetFeatures
export type SheetTable<TRow extends RowData> = Table<SheetFeatures, TRow>
export type SheetRow<TRow extends RowData> = Row<SheetFeatures, TRow>
