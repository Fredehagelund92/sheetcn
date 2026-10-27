import {
  createSheetStore,
  createViewModel,
  getCellValue,
  type CellRange,
  type CellValue,
  type Change,
  type Column,
  type ColumnSizing,
  type SheetStore,
  type SheetView,
  type TypeRegistry,
  type ViewModel,
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

import { createSheetFeatures, type SheetFeatures } from "./features.js"
import { SheetController, type Sheet } from "./sheet.js"
import { ViewHolder } from "./view-row-model.js"

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
  /**
   * Controlled view: what the sheet shows of its rows, as plain data (a
   * filter, sort keys, a grouping and hidden columns; see `SheetView`). The
   * app keeps it, and can save it anywhere. The sheet never changes it: it
   * calls `onViewChange` with the next view, and the app passes that back.
   */
  view?: SheetView
  /** The starting view when the sheet keeps its own (uncontrolled). */
  defaultView?: SheetView
  /** Called with the next view whenever the view changes. */
  onViewChange?: (view: SheetView) => void
  /**
   * Today's date in ISO form, for relative date filters such as "in the last
   * 7 days". Default: the local date when the view was last set.
   */
  today?: string
}

const NO_VIEW: SheetView = {}
const noSubscription = () => () => {}
const noRows = () => null

const DEFAULT_WIDTH = 120
const DEFAULT_MIN_WIDTH = 48

function visibilityOf(view: SheetView): Record<string, boolean> {
  const visibility: Record<string, boolean> = {}
  for (const id of view.hidden ?? []) visibility[id] = false
  return visibility
}

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
 * It shows the rows through a view (`view` or `defaultView`): filtered,
 * grouped and sorted in the core, with hidden columns left out of the layout.
 * Keys and selection work over the rows and columns shown.
 *
 * Rendering stays cheap at 100,000 rows: a one-cell commit rebuilds only the
 * changed row (see `createSheetCoreRowModel`), and with a view on, only moves
 * that row; this hook re-renders only for data, view and column layout
 * changes, never for selection. Views subscribe to the selection per row
 * (`useRowSelectionKey`).
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

  const [ownView, setOwnView] = useState(options.defaultView ?? NO_VIEW)
  const view = options.view ?? ownView
  latest.ownView(setOwnView)
  const viewModel = useMemo(
    () =>
      createViewModel({
        columns: options.columns,
        getRowId: latest.getRowId,
        view,
        ...(options.today === undefined ? {} : { today: options.today }),
      }),
    [options.columns, view, options.today, latest]
  )
  const columnVisibility = useMemo(() => visibilityOf(view), [view])
  // The row model reads the view from here; set before the table reads rows.
  const [features] = useState(() => {
    const holder = new ViewHolder()
    return { holder, features: createSheetFeatures(holder) }
  })
  features.holder.show(viewModel as ViewModel<never>)

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
    cellSelection: firstCell(viewModel.compute(rows).rows, view, options),
  }))

  const selectionOptions: {
    onCellSelectionChange?: (updater: Updater<CellSelectionState>) => void
  } = {}
  if (options.selection || options.onSelectionChange) {
    selectionOptions.onCellSelectionChange = latest.onCellSelectionChange
  }

  const table = useTable(
    {
      features: features.features,
      columns: columnDefs,
      data: rows,
      getRowId: latest.getRowId,
      // Edits change `data`; the selection must survive them.
      autoResetCellSelection: false,
      columnResizeMode: "onChange",
      // The view sorts; TanStack's own sorting is not used.
      enableSorting: false,
      initialState,
      state: options.selection
        ? { columnVisibility, cellSelection: options.selection }
        : { columnVisibility },
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
    view,
    viewModel,
    setView: latest.setView,
    ...(options.today === undefined ? {} : { today: options.today }),
  }
  const [sheet] = useState(() => new SheetController<Row>(source))
  sheet.update(source)
  latest.attach(sheet)
  // A view change or an edit can hide the active cell's row; keep a cell
  // active among the rows shown.
  useLayoutEffect(() => {
    sheet.keepActiveCell()
  }, [sheet, viewModel, rows])
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

  #setOwnView: (view: SheetView) => void = () => {}

  /** Points `setView` at the sheet's own view state, for an uncontrolled view. */
  ownView(set: (view: SheetView) => void) {
    this.#setOwnView = set
  }

  setView = (view: SheetView) => {
    if (this.#options.view === undefined) this.#setOwnView(view)
    this.#options.onViewChange?.(view)
  }

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

/** The first cell the view shows. */
function firstCell<Row extends RowData>(
  rows: readonly Row[],
  view: SheetView,
  options: UseSheetOptions<Row>
): CellRange[] {
  const row = rows[0]
  const hidden = new Set(view.hidden)
  const shown = options.columns.filter((c) => !hidden.has(c.id))
  const column = shown.find((c) => c.pin === "start") ?? shown[0]
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
