import {
  createSheetStore,
  getCellValue,
  type CellRange,
  type CellValue,
  type Change,
  type Column,
  type ColumnSizing,
  type SheetStore,
  type TypeRegistry,
} from "@sheetcn/core"
import {
  functionalUpdate,
  useTable,
  type CellSelectionState,
  type ColumnDef,
  type RowData,
  type Updater,
} from "@tanstack/react-table"
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react"

import { sheetFeatures, type SheetFeatures } from "./features.js"
import { SheetController, type Sheet } from "./sheet.js"

export type UseSheetOptions<Row extends RowData> = {
  /**
   * The columns. Keep the same array between renders (define it outside the
   * component or memoize it): a new array starts a new store and history.
   */
  columns: readonly Column<Row>[]
  /**
   * The column types this sheet can use, from `createTypeRegistry`. Every
   * column's type must be the one these define under its id. Default: the
   * built-in types. Keep the same registry between renders.
   */
  types?: TypeRegistry
  /** A pure function of the row. Ids are unique and never change. */
  getRowId: (row: Row) => string
  /**
   * Controlled rows. The sheet never changes them: apply each change from
   * `onChange` with `applyChange` and pass the result back.
   */
  data?: readonly Row[]
  /** The starting rows when the sheet owns its data (uncontrolled). */
  defaultData?: readonly Row[]
  /** Called once per data mutation, including undo and redo. */
  onChange?: (change: Change<Row>) => void
  /** Controlled selection. */
  selection?: CellRange[]
  /** Called with the new ranges whenever the selection changes. */
  onSelectionChange?: (ranges: CellRange[]) => void
  /** Most undo steps kept. Default 500. */
  historyLimit?: number
  /**
   * How columns use the grid's width. "fixed" (the default): each column
   * keeps its width. "fill": each column's width is its minimum, and the
   * spare width is shared out in proportion to each column's `grow` (by
   * default its width), so the last column ends at the right edge. Pinned
   * columns never grow, and when the minimums do not fit, the grid scrolls.
   * Fill needs the grid's width, which `useSheetColumnVirtualizer` measures.
   */
  sizing?: ColumnSizing
}

const noSubscription = () => () => {}
const noRows = () => null

const DEFAULT_WIDTH = 120
const DEFAULT_MIN_WIDTH = 48

function toColumnDefs<Row extends RowData>(
  columns: readonly Column<Row>[]
): ColumnDef<SheetFeatures, Row>[] {
  return columns.map((column) => ({
    id: column.id,
    header: column.header,
    accessorFn: (row: Row): CellValue => getCellValue(column, row),
    size: column.width ?? DEFAULT_WIDTH,
    minSize: column.minWidth ?? DEFAULT_MIN_WIDTH,
    ...(column.maxWidth === undefined ? {} : { maxSize: column.maxWidth }),
  }))
}

/**
 * Creates a sheet: the core store (rows, transactions, history) wired to a
 * TanStack table with cell selection, sizing, resizing and pinning, and
 * "fixed" or "fill" column sizing with fit to content. The returned API is
 * stable for the life of the component.
 *
 * Rendering stays cheap at 100,000 rows: a one-cell commit rebuilds only the
 * changed row (see `createSheetCoreRowModel`), and this hook re-renders only
 * for data and column layout changes, never for selection. Views subscribe to
 * the selection per row (`useRowSelectionKey`).
 */
export function useSheet<Row extends RowData>(
  options: UseSheetOptions<Row>
): Sheet<Row> {
  const controlled = options.data !== undefined
  // The callbacks below run in events, after this render committed, and read
  // the options of the latest render. Inline functions are fine.
  const [latest] = useState(() => new Latest(options))
  latest.set(options)

  // One store per columns array.
  const [state, setState] = useState(() => ({
    columns: options.columns,
    store: makeStore(options, latest, options.data ?? options.defaultData),
  }))
  let { store } = state
  if (state.columns !== options.columns) {
    store = makeStore(
      options,
      latest,
      controlled ? options.data : state.store.getRows()
    )
    setState({ columns: options.columns, store })
  }

  // Controlled rows come from props; the store follows them and must not
  // render the host a second time.
  const ownRows = useSyncExternalStore(
    controlled ? noSubscription : store.subscribe,
    controlled ? noRows : store.getRows
  )
  const rows = (controlled ? options.data : ownRows) as readonly Row[]
  useLayoutEffect(() => {
    if (controlled) store.setRows(rows)
  }, [controlled, store, rows])

  const columnDefs = useMemo(
    () => toColumnDefs(options.columns),
    [options.columns]
  )
  const [initialState] = useState(() => ({
    columnPinning: {
      start: options.columns.filter((c) => c.pin === "start").map((c) => c.id),
      end: [],
    },
    // One active cell, so the grid has a cell to take focus (roving tabindex).
    cellSelection: firstCell(rows, options),
  }))

  const selectionOptions: {
    state?: { cellSelection: CellSelectionState }
    onCellSelectionChange?: (updater: Updater<CellSelectionState>) => void
  } = {}
  if (options.selection) {
    selectionOptions.state = { cellSelection: options.selection }
  }
  if (options.selection || options.onSelectionChange) {
    selectionOptions.onCellSelectionChange = latest.onCellSelectionChange
  }

  const table = useTable(
    {
      features: sheetFeatures,
      columns: columnDefs,
      data: rows,
      getRowId: latest.getRowId,
      // Edits change `data`; the selection must survive them.
      autoResetCellSelection: false,
      columnResizeMode: "onChange",
      initialState,
      ...selectionOptions,
    },
    (s) => ({
      columnSizing: s.columnSizing,
      columnPinning: s.columnPinning,
      columnResizing: s.columnResizing,
    })
  )

  const source = {
    table,
    store,
    columns: options.columns,
    sizing: options.sizing ?? "fixed",
  }
  const [sheet] = useState(() => new SheetController<Row>(source))
  sheet.update(source)
  latest.attach(sheet)
  // Fill widths follow the grid's width, which is not TanStack state.
  useSyncExternalStore(
    sheet.subscribeLayout,
    sheet.getLayoutVersion,
    sheet.getLayoutVersion
  )
  return sheet
}

/** The options of the latest render, for callbacks that run in events. */
class Latest<Row extends RowData> {
  #options: UseSheetOptions<Row>
  #sheet: Sheet<Row> | null = null

  constructor(options: UseSheetOptions<Row>) {
    this.#options = options
  }

  set(options: UseSheetOptions<Row>) {
    this.#options = options
  }

  attach(sheet: Sheet<Row>) {
    this.#sheet = sheet
  }

  getRowId = (row: Row) => this.#options.getRowId(row)

  onChange = (change: Change<Row>) => this.#options.onChange?.(change)

  onCellSelectionChange = (updater: Updater<CellSelectionState>) => {
    const table = this.#sheet?.table
    if (!table) return
    const next = functionalUpdate(updater, table.atoms.cellSelection.get())
    if (!this.#options.selection) table.baseAtoms.cellSelection.set(next)
    this.#options.onSelectionChange?.(next)
  }
}

function makeStore<Row extends RowData>(
  options: UseSheetOptions<Row>,
  latest: Latest<Row>,
  rows: readonly Row[] = []
): SheetStore<Row> {
  return createSheetStore<Row>({
    rows,
    columns: options.columns,
    getRowId: latest.getRowId,
    controlled: options.data !== undefined,
    onChange: latest.onChange,
    ...(options.types === undefined ? {} : { types: options.types }),
    ...(options.historyLimit === undefined
      ? {}
      : { historyLimit: options.historyLimit }),
  })
}

function firstCell<Row extends RowData>(
  rows: readonly Row[],
  options: UseSheetOptions<Row>
): CellRange[] {
  const row = rows[0]
  const column =
    options.columns.find((c) => c.pin === "start") ?? options.columns[0]
  if (row === undefined || !column) return []
  const rowId = options.getRowId(row)
  return [
    {
      anchorRowId: rowId,
      anchorColumnId: column.id,
      focusRowId: rowId,
      focusColumnId: column.id,
    },
  ]
}
