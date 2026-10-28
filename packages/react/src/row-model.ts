import { patchedRows } from "@sheetcn/core"
import {
  constructRow,
  makeObjectMap,
  skipFirstRun,
  tableMemo,
  type Row,
  type RowData,
  type RowModel,
  type Table,
  type TableFeatures,
} from "@tanstack/react-table"

/**
 * A core row model that reuses `Row` objects across data changes.
 *
 * TanStack's own core row model builds a new `Row` for every data row
 * whenever `data` changes, which costs about 10 ms at 100,000 rows. Edits
 * made through the sheet store share every untouched row object, so this
 * model compares the new array with the previous one by reference and builds
 * new `Row`s only where the object changed. When the length differs or a row
 * id moved, it rebuilds everything, as TanStack does.
 *
 * A patched model keeps `rowsById` as the same object, updated in place (the
 * previous model is discarded). A rebuild makes a new one. So the identity of
 * `rowsById` changes exactly when row ids may have moved, and anything keyed
 * by row position, such as the virtualizer's item keys, can key on it.
 * Sub-rows are not supported.
 */
export function createSheetCoreRowModel() {
  return <TFeatures extends TableFeatures, TData extends RowData>(
    table: Table<TFeatures, TData>
  ) => {
    let previous: {
      data: readonly TData[]
      model: RowModel<TFeatures, TData>
    } | null = null
    return tableMemo({
      feature: "coreRowModelsFeature",
      table,
      fnName: "table.getCoreRowModel",
      memoDeps: () => [table.options.data],
      fn: () => {
        const data = table.options.data
        const model =
          (previous &&
            patchModel(table, previous.data, previous.model, data)) ??
          buildModel(table, data)
        previous = { data, model }
        return model
      },
      // The same resets TanStack's core row model runs after a data change.
      onAfterUpdate: skipFirstRun(() => {
        const t = table as unknown as Partial<
          Record<
            | "autoResetExpanded"
            | "autoResetPageIndex"
            | "autoResetSorting"
            | "autoResetCellSelection",
            () => void
          >
        >
        t.autoResetExpanded?.()
        t.autoResetPageIndex?.()
        t.autoResetSorting?.()
        t.autoResetCellSelection?.()
      }),
    })
  }
}

function buildModel<TFeatures extends TableFeatures, TData extends RowData>(
  table: Table<TFeatures, TData>,
  data: readonly TData[]
): RowModel<TFeatures, TData> {
  const rows: Row<TFeatures, TData>[] = []
  const rowsById = makeObjectMap<Row<TFeatures, TData>>()
  for (let i = 0; i < data.length; i++) {
    const original = data[i] as TData
    const row = constructRow(table, table.getRowId(original, i), original, i, 0)
    rows.push(row)
    rowsById[row.id] = row
  }
  return { rows, flatRows: rows, rowsById }
}

/**
 * The previous model with new `Row`s for the changed objects, or null when
 * rows were added, removed or moved. O(changed rows) work when the store
 * made `data` from `previousData` (see `patchedRows`), else also O(rows)
 * reference checks.
 */
function patchModel<TFeatures extends TableFeatures, TData extends RowData>(
  table: Table<TFeatures, TData>,
  previousData: readonly TData[],
  previous: RowModel<TFeatures, TData>,
  data: readonly TData[]
): RowModel<TFeatures, TData> | null {
  if (data.length !== previousData.length || table.options.getSubRows) {
    return null
  }
  // The sheet store says which rows a change replaced; other arrays are
  // compared.
  let changed = patchedRows(data, previousData)
  if (!changed) {
    const found: number[] = []
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== previousData[i]) found.push(i)
    }
    changed = found
  }
  if (!changed.length) return previous
  const ids = changed.map((i) => table.getRowId(data[i] as TData, i))
  for (let k = 0; k < changed.length; k++) {
    if (ids[k] !== previous.rows[changed[k] as number]?.id) return null
  }
  const rows = previous.rows.slice()
  for (let k = 0; k < changed.length; k++) {
    const i = changed[k] as number
    const id = ids[k] as string
    const row = constructRow(table, id, data[i] as TData, i, 0)
    rows[i] = row
    previous.rowsById[id] = row
  }
  return { rows, flatRows: rows, rowsById: previous.rowsById }
}
