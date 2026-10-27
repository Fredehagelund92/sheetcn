import {
  fillColumnWidths,
  formatCell,
  getCellValue,
  isCellReadOnly,
  keyToCommand,
  navigate,
  parseCell,
  rectsContain,
  sampleRowIndexes,
  type ActiveRange,
  type CellIndex,
  type CellRange,
  type CellRect,
  type Change,
  type Column,
  type ColumnSizing,
  type Direction,
  type EditMode,
  type KeyInput,
  type Navigation,
  type RowSpan,
  type SheetCommand,
  type SheetStore,
} from "@sheetcn/core"
import type { RowData } from "@tanstack/react-table"

import type { SheetRow, SheetTable } from "./features.js"

/** The cell being edited. */
export type EditState = {
  rowId: string
  columnId: string
  mode: EditMode
  /** The editor's text. */
  draft: string
  /** Why the draft did not parse on the last commit, or null. */
  error: string | null
}

/** Sheet state outside the data and the selection. */
export type SheetState = {
  editing: EditState | null
  /** A short message for a status line, such as "Price is read-only". */
  notice: string | null
}

/** How much of the grid the viewport shows, for PageUp and PageDown. */
export type Viewport = { pageRows: number; pageColumns: number }

/**
 * How `select` combines a range with the selection:
 * - "replace": the range becomes the whole selection.
 * - "extend": the range replaces the last (active) range; the others stay.
 * - "add": the range is added as a new active range.
 * - "exclude": the range is removed from the selection; its anchor becomes
 *   the active cell.
 */
export type SelectMode = "replace" | "extend" | "add" | "exclude"

/**
 * Measures a column's content for `fitColumn`: the width in pixels, padding
 * and borders included, that shows the column's header and each of `rows`
 * without clipping. The view supplies it, because it knows its own markup.
 */
export type ColumnMeasurer<Row> = (
  column: Column<Row>,
  rows: readonly Row[]
) => number

/** The fields of a DOM keyboard event `handleKeyDown` reads. */
export type KeyboardEventLike = KeyInput & { preventDefault(): void }

/**
 * The sheet API that `useSheet` returns. Its identity is stable for the life
 * of the component; read the current rows, selection and state through its
 * methods.
 */
export type Sheet<Row extends RowData> = {
  /**
   * The TanStack table, for layout (headers, sizes, pinning, resizing) and
   * selection reads. Call its methods; its `options` and `state` fields are
   * a snapshot of one render.
   */
  readonly table: SheetTable<Row>
  /** The core store: rows, transactions and history. */
  readonly store: SheetStore<Row>
  readonly columns: readonly Column<Row>[]

  /** Rows in display order. */
  getRows(this: void): readonly SheetRow<Row>[]
  /** Column ids in display order: pinned columns first. */
  getColumnIds(this: void): readonly string[]
  getColumn(this: void, columnId: string): Column<Row> | undefined
  /** The row's display index, or -1. */
  rowIndexOf(this: void, rowId: string): number
  /** The column's display index, or -1. */
  columnIndexOf(this: void, columnId: string): number

  /** How columns use the grid's width, from the `sizing` option. */
  readonly sizing: ColumnSizing
  /**
   * The width a column shows at, in pixels: its size, and with "fill" sizing
   * its share of the spare width. Lay columns out with this, not with the
   * TanStack column's `getSize()`.
   */
  getColumnWidth(this: void, columnId: string): number
  /**
   * The width the columns can fill: the grid's client width, less a row
   * number gutter. `useSheetColumnVirtualizer` sets it from the scroll
   * element.
   */
  setAvailableWidth(this: void, width: number): void
  /**
   * The rows on screen, which `fitColumn` always measures.
   * `useSheetRowVirtualizer` sets them.
   */
  setVisibleRows(this: void, rows: RowSpan | null): void
  /** Sets how `fitColumn` measures content, or clears it with null. */
  setColumnMeasurer(this: void, measurer: ColumnMeasurer<Row> | null): void
  /**
   * Sizes a column to its widest content, within its min and max widths: the
   * header, the rows on screen and up to 500 rows in all, spread over the
   * rest. With "fill" sizing the column then keeps that width and the other
   * columns share the spare width. Returns false when no measurer is set.
   */
  fitColumn(this: void, columnId: string): boolean
  /**
   * Sizes every column to its content, as `fitColumn` does. With "fill"
   * sizing the fitted widths become the minimums, and every column grows
   * again, so the grid still fills its width.
   */
  fitAllColumns(this: void): boolean
  /**
   * The pointer handler for a column's resize handle (mouse down or touch
   * start). Use it in place of the TanStack header's `getResizeHandler()`:
   * with "fill" sizing, a drag starts from the width the column shows, and
   * the column then keeps the width it was given.
   */
  getColumnResizeHandler(this: void, columnId: string): (event: unknown) => void

  getSelection(this: void): readonly CellRange[]
  /** The selected cells as disjoint rectangles of display indexes. */
  getSelectionRects(this: void): readonly CellRect[]
  /** The last range by position; its anchor is the active cell. */
  getActiveRange(this: void): ActiveRange | null
  /** Selects a range given by ids, or by position. */
  select(this: void, range: CellRange | ActiveRange, mode?: SelectMode): void
  isSelected(this: void, cell: CellIndex): boolean

  getState(this: void): SheetState
  /** Called when `getState()` changes. Returns an unsubscribe. */
  subscribe(this: void, listener: () => void): () => void

  /** The command a key press maps to in the current state, or null. */
  commandForKey(this: void, event: KeyInput): SheetCommand | null
  /** Runs a command. Returns false when it did nothing. */
  execute(this: void, command: SheetCommand, viewport?: Viewport): boolean
  /**
   * Maps a key press to a command and runs it. Prevents the key's default
   * action unless an input method is composing. Returns the command run.
   */
  handleKeyDown(
    this: void,
    event: KeyboardEventLike,
    viewport: Viewport
  ): SheetCommand | null

  /** Opens the editor on the active cell. Returns false when it cannot. */
  startEdit(this: void, mode?: EditMode, text?: string): boolean
  setDraft(this: void, draft: string): void
  /**
   * Parses the draft and commits it, then moves the active cell. Returns
   * false and keeps the editor open when the draft does not parse.
   */
  commitEdit(this: void, move?: Direction | null): boolean
  cancelEdit(this: void): void
  undo(this: void): void
  redo(this: void): void
}

const NO_STATE: SheetState = { editing: null, notice: null }
const DEFAULT_VIEWPORT: Viewport = { pageRows: 20, pageColumns: 5 }

const isEmpty = (v: unknown) => v === null || v === ""

/** The most rows `fitColumn` measures, the rows on screen included. */
const FIT_SAMPLE_ROWS = 500

/** What the controller reads from the latest render. */
export type SheetSource<Row extends RowData> = {
  table: SheetTable<Row>
  store: SheetStore<Row>
  columns: readonly Column<Row>[]
  sizing?: ColumnSizing
}

type FillWidths = { key: readonly unknown[]; widths: Map<string, number> }

/**
 * The sheet API over a TanStack table and a core store. `useSheet` creates
 * one per component and points it at each render's table and store.
 */
export class SheetController<Row extends RowData> implements Sheet<Row> {
  #source: SheetSource<Row>
  #state = NO_STATE
  #columnsById = new Map<string, Column<Row>>()
  readonly #listeners = new Set<() => void>()
  // Column layout outside TanStack's state. A change re-renders the host
  // through `subscribeLayout`.
  #available = Number.NaN
  /** Columns the user sized (resized or fitted), which no longer grow. */
  #userSized: ReadonlySet<string> = new Set()
  #fill: FillWidths | null = null
  #visibleRows: RowSpan | null = null
  #measurer: ColumnMeasurer<Row> | null = null
  #layoutVersion = 0
  readonly #layoutListeners = new Set<() => void>()

  constructor(source: SheetSource<Row>) {
    this.#source = source
    this.#indexColumns()
  }

  /** Points the controller at a new render's table, store and columns. */
  update(source: SheetSource<Row>): void {
    const columnsChanged = source.columns !== this.#source.columns
    this.#source = source
    if (columnsChanged) this.#indexColumns()
  }

  get table() {
    return this.#source.table
  }
  get store() {
    return this.#source.store
  }
  get columns() {
    return this.#source.columns
  }
  get sizing(): ColumnSizing {
    return this.#source.sizing ?? "fixed"
  }

  #indexColumns() {
    this.#columnsById = new Map(this.#source.columns.map((c) => [c.id, c]))
  }

  // Layout -------------------------------------------------------------------

  getRows = () => this.table.getRowsInDisplayOrder()

  getColumnIds = (): readonly string[] =>
    // The column index map is memoized by TanStack on column layout state.
    columnIdsFor(this.table.getCellSelectionColumnIndexes())

  getColumn = (columnId: string) => this.#columnsById.get(columnId)

  rowIndexOf = (rowId: string): number =>
    this.table.getRowModel().rowsById[rowId]?.getDisplayIndex() ?? -1

  columnIndexOf = (columnId: string): number =>
    this.table.getCellSelectionColumnIndexes()[columnId] ?? -1

  #size() {
    return {
      rowCount: this.getRows().length,
      columnCount: this.getColumnIds().length,
    }
  }

  #rowIdAt = (rowIndex: number) =>
    (this.getRows()[rowIndex] as SheetRow<Row>).id
  #columnIdAt = (columnIndex: number) =>
    this.getColumnIds()[columnIndex] as string

  // Column sizing ------------------------------------------------------------

  /**
   * Called when a column width may have changed outside TanStack's state:
   * the available width in "fill" sizing, or which columns the user sized.
   * `useSheet` re-renders the host on it.
   */
  subscribeLayout = (listener: () => void) => {
    this.#layoutListeners.add(listener)
    return () => {
      this.#layoutListeners.delete(listener)
    }
  }

  getLayoutVersion = () => this.#layoutVersion

  #layoutChanged() {
    this.#layoutVersion++
    for (const listener of this.#layoutListeners) listener()
  }

  getColumnWidth = (columnId: string): number => {
    if (this.sizing === "fill") {
      const width = this.#fillWidths().get(columnId)
      if (width !== undefined) return width
    }
    return this.table.getColumn(columnId)?.getSize() ?? 0
  }

  /** The fill widths, computed again only when an input changed. */
  #fillWidths(): Map<string, number> {
    const { table } = this
    const sizing = table.atoms.columnSizing.get()
    const key = [
      sizing,
      table.atoms.columnPinning.get(),
      table.options.columns,
      this.#available,
      this.#userSized,
    ]
    const cached = this.#fill
    if (cached && key.every((k, i) => Object.is(k, cached.key[i]))) {
      return cached.widths
    }
    const pinned = table.getPinnedLeafColumns("start")
    const leaves = [...pinned, ...table.getPinnedLeafColumns("center")]
    const input = leaves.map((c, i) => {
      const userSized = this.#userSized.has(c.id) && c.id in sizing
      const grow = userSized ? 0 : this.getColumn(c.id)?.grow
      return {
        width: c.getSize(),
        maxWidth: c.columnDef.maxSize ?? Infinity,
        pinned: i < pinned.length,
        ...(grow === undefined ? {} : { grow }),
      }
    })
    const widths = fillColumnWidths(this.#available, input)
    const map = new Map(leaves.map((c, i) => [c.id, widths[i] as number]))
    this.#fill = { key, widths: map }
    return map
  }

  setAvailableWidth = (width: number) => {
    if (Object.is(width, this.#available)) return
    this.#available = width
    if (this.sizing === "fill") this.#layoutChanged()
  }

  setVisibleRows = (rows: RowSpan | null) => {
    this.#visibleRows = rows
  }

  setColumnMeasurer = (measurer: ColumnMeasurer<Row> | null) => {
    this.#measurer = measurer
  }

  /** Gives columns widths the user chose, so that they no longer grow. */
  #setUserWidths(widths: Record<string, number>, grow = false) {
    const ids = Object.keys(widths)
    if (!ids.length) return
    const userSized = new Set(this.#userSized)
    for (const id of ids) {
      if (grow) userSized.delete(id)
      else userSized.add(id)
    }
    this.#userSized = userSized
    this.table.setColumnSizing((old) => ({ ...old, ...widths }))
    this.#layoutChanged()
  }

  /** The content width of a column within its limits, or null. */
  #measure(columnId: string, rows: readonly Row[]): number | null {
    const column = this.getColumn(columnId)
    const def = this.table.getColumn(columnId)?.columnDef
    if (!this.#measurer || !column || !def) return null
    const width = this.#measurer(column, rows)
    if (!Number.isFinite(width)) return null
    const min = def.minSize ?? 0
    const max = def.maxSize ?? Infinity
    return Math.min(Math.max(Math.ceil(width), min), max)
  }

  /** The rows a fit measures: the rows on screen and a sample of the rest. */
  #fitRows(): Row[] {
    const rows = this.getRows()
    return sampleRowIndexes(
      rows.length,
      this.#visibleRows,
      FIT_SAMPLE_ROWS
    ).map((i) => (rows[i] as SheetRow<Row>).original)
  }

  fitColumn = (columnId: string): boolean => {
    if (!this.#measurer) return false
    const width = this.#measure(columnId, this.#fitRows())
    if (width === null) return false
    this.#setUserWidths({ [columnId]: width })
    return true
  }

  fitAllColumns = (): boolean => {
    if (!this.#measurer) return false
    const rows = this.#fitRows()
    const widths: Record<string, number> = {}
    for (const id of this.getColumnIds()) {
      const width = this.#measure(id, rows)
      if (width !== null) widths[id] = width
    }
    // In "fill" sizing, the fitted widths are the minimums and the columns
    // share the spare width again, so the grid still fills.
    this.#setUserWidths(widths, true)
    return Object.keys(widths).length > 0
  }

  getColumnResizeHandler = (columnId: string) => (event: unknown) => {
    const header = this.table
      .getFlatHeaders()
      .find((h) => h.column.id === columnId)
    if (!header?.column.getCanResize()) return
    // TanStack starts the drag from the column's size. Make that the width
    // the column shows, which in "fill" sizing includes its share, so the
    // edge stays under the pointer.
    this.#setUserWidths({ [columnId]: this.getColumnWidth(columnId) })
    header.getResizeHandler()(event)
  }

  // Selection ----------------------------------------------------------------

  getSelection = (): readonly CellRange[] =>
    this.table.atoms.cellSelection.get()

  getSelectionRects = (): readonly CellRect[] =>
    this.table.getCellSelectionBounds()

  getActiveRange = (): ActiveRange | null => {
    const range = this.getSelection().at(-1)
    if (!range) return null
    const anchor = {
      rowIndex: this.rowIndexOf(range.anchorRowId),
      columnIndex: this.columnIndexOf(range.anchorColumnId),
    }
    const focus = {
      rowIndex: this.rowIndexOf(range.focusRowId),
      columnIndex: this.columnIndexOf(range.focusColumnId),
    }
    if (
      anchor.rowIndex < 0 ||
      anchor.columnIndex < 0 ||
      focus.rowIndex < 0 ||
      focus.columnIndex < 0
    ) {
      return null
    }
    return { anchor, focus }
  }

  isSelected = (cell: CellIndex) =>
    rectsContain(this.getSelectionRects(), cell.rowIndex, cell.columnIndex)

  select = (target: CellRange | ActiveRange, mode: SelectMode = "replace") => {
    let range: CellRange
    if ("anchorRowId" in target) {
      range = {
        anchorRowId: target.anchorRowId,
        anchorColumnId: target.anchorColumnId,
        focusRowId: target.focusRowId,
        focusColumnId: target.focusColumnId,
      }
    } else {
      const { rowCount, columnCount } = this.#size()
      const inside = (c: CellIndex) =>
        c.rowIndex >= 0 &&
        c.rowIndex < rowCount &&
        c.columnIndex >= 0 &&
        c.columnIndex < columnCount
      if (!inside(target.anchor) || !inside(target.focus)) return
      range = {
        anchorRowId: this.#rowIdAt(target.anchor.rowIndex),
        anchorColumnId: this.#columnIdAt(target.anchor.columnIndex),
        focusRowId: this.#rowIdAt(target.focus.rowIndex),
        focusColumnId: this.#columnIdAt(target.focus.columnIndex),
      }
    }
    if (mode === "exclude") range.operation = "exclude"
    this.table.setCellSelection((old) => {
      if (mode === "replace") return [range]
      if (mode === "extend" && old.length) {
        const last = old.at(-1) as CellRange
        // Keep the active range's operation: extending an exclusion
        // excludes more.
        const next = last.operation
          ? { ...range, operation: last.operation }
          : range
        return [...old.slice(0, -1), next]
      }
      return [...old, range]
    })
  }

  // State --------------------------------------------------------------------

  getState = () => this.#state

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #setState(patch: Partial<SheetState>) {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }

  #notify(notice: string | null) {
    if (notice !== this.#state.notice) this.#setState({ notice })
  }

  // Keyboard -----------------------------------------------------------------

  commandForKey = (event: KeyInput): SheetCommand | null => {
    const active = this.getActiveRange()
    const columnId = active && this.#columnIdAt(active.anchor.columnIndex)
    return keyToCommand(event, {
      editing: this.#state.editing?.mode ?? null,
      activeColumnType: columnId
        ? (this.getColumn(columnId)?.type ?? null)
        : null,
    })
  }

  handleKeyDown = (event: KeyboardEventLike, viewport: Viewport) => {
    const command = this.commandForKey(event)
    if (!command) return null
    if (!(command.type === "startEdit" && command.composing)) {
      event.preventDefault()
    }
    this.execute(command, viewport)
    return command
  }

  execute = (
    command: SheetCommand,
    viewport: Viewport = DEFAULT_VIEWPORT
  ): boolean => {
    switch (command.type) {
      case "startEdit":
        return this.startEdit(command.mode, command.text)
      case "setEditMode": {
        const editing = this.#state.editing
        if (!editing) return false
        this.#setState({ editing: { ...editing, mode: command.mode } })
        return true
      }
      case "commitEdit":
        return this.commitEdit(command.move)
      case "cancelEdit":
        this.cancelEdit()
        return true
      case "toggle":
        return this.#toggle()
      case "clear":
        return this.#clear()
      case "undo":
        this.undo()
        return true
      case "redo":
        this.redo()
        return true
      case "ignore":
        return false
      case "cancelCut":
        // Cut and paste arrive with the clipboard work; nothing is pending yet.
        return false
      default:
        return this.#navigate(command, viewport)
    }
  }

  #navigate(nav: Navigation, viewport: Viewport): boolean {
    const size = { ...this.#size(), ...viewport }
    const rows = this.getRows()
    const ids = this.getColumnIds()
    const isBlank = (r: number, c: number) => {
      const column = this.getColumn(ids[c] as string)
      const row = rows[r]
      return !column || !row || isEmpty(getCellValue(column, row.original))
    }
    const next = navigate(this.getActiveRange(), nav, size, isBlank)
    if (!next) return false
    const extend = "extend" in nav && nav.extend
    this.select(next, extend ? "extend" : "replace")
    return true
  }

  // Editing ------------------------------------------------------------------

  #activeCell() {
    const active = this.getActiveRange()
    if (!active) return null
    const row = this.getRows()[active.anchor.rowIndex]
    const column = this.getColumn(this.#columnIdAt(active.anchor.columnIndex))
    return row && column ? { row, column, index: active.anchor } : null
  }

  startEdit = (mode: EditMode = "edit", text?: string): boolean => {
    const cell = this.#activeCell()
    if (!cell) return false
    const { row, column } = cell
    if (isCellReadOnly(column, row.original)) {
      this.#notify(`${column.header} is read-only`)
      return false
    }
    if (column.type === "boolean") return this.#toggle()
    const draft = text ?? formatCell(column, getCellValue(column, row.original))
    this.#setState({
      editing: {
        rowId: row.id,
        columnId: column.id,
        mode,
        draft,
        error: null,
      },
      notice: null,
    })
    return true
  }

  setDraft = (draft: string) => {
    const editing = this.#state.editing
    if (!editing || editing.draft === draft) return
    this.#setState({ editing: { ...editing, draft, error: null } })
  }

  cancelEdit = () => {
    if (this.#state.editing) this.#setState({ editing: null })
  }

  commitEdit = (move: Direction | null = null): boolean => {
    const editing = this.#state.editing
    if (!editing) return true
    const column = this.getColumn(editing.columnId)
    if (!column) {
      this.#setState({ editing: null })
      return true
    }
    if (this.store.getRow(editing.rowId) === undefined) {
      // The row went away while it was being edited.
      this.#setState({ editing: null })
      return true
    }
    const parsed = parseCell(column, editing.draft)
    if (!parsed.ok) {
      this.#setState({ editing: { ...editing, error: parsed.error } })
      return false
    }
    this.#setState({ editing: null })
    this.store.transaction("edit", (tx) =>
      tx.set(editing.rowId, editing.columnId, parsed.value)
    )
    if (move) {
      this.#navigate(
        { type: "move", direction: move, extend: false },
        DEFAULT_VIEWPORT
      )
    }
    return true
  }

  #toggle(): boolean {
    const cell = this.#activeCell()
    if (!cell || cell.column.type !== "boolean") return false
    const { row, column } = cell
    if (isCellReadOnly(column, row.original)) {
      this.#notify(`${column.header} is read-only`)
      return false
    }
    const value = getCellValue(column, row.original)
    this.store.transaction("edit", (tx) => tx.set(row.id, column.id, !value))
    return true
  }

  /** Empties every writable cell in the selection, as one undo step. */
  #clear(): boolean {
    const rects = this.getSelectionRects()
    if (!rects.length) return false
    const rows = this.getRows()
    const columns = this.getColumnIds().map((id) => this.getColumn(id))
    let skipped = 0
    const change = this.store.transaction("clear", (tx) => {
      for (const rect of rects) {
        for (let r = rect.minRowIndex; r <= rect.maxRowIndex; r++) {
          const row = rows[r]
          if (!row) continue
          for (let c = rect.minColumnIndex; c <= rect.maxColumnIndex; c++) {
            const column = columns[c]
            if (!column) continue
            if (isCellReadOnly(column, row.original)) {
              skipped++
              continue
            }
            if (getCellValue(column, row.original) !== null) {
              tx.set(row.id, column.id, null)
            }
          }
        }
      }
    })
    this.#notify(
      skipped
        ? `Skipped ${skipped.toLocaleString("en-US")} read-only cells`
        : null
    )
    return change !== null
  }

  // History ------------------------------------------------------------------

  undo = () => {
    this.cancelEdit()
    this.#selectChanged(this.store.undo())
  }

  redo = () => {
    this.cancelEdit()
    this.#selectChanged(this.store.redo())
  }

  /** Selects the bounding rectangle of the cells a change touched. */
  #selectChanged(change: Change<Row> | null) {
    if (!change?.patches.length) return
    let minRow = Infinity
    let maxRow = -1
    let minColumn = Infinity
    let maxColumn = -1
    for (const p of change.patches) {
      const r = this.rowIndexOf(p.rowId)
      const c = this.columnIndexOf(p.columnId)
      if (r < 0 || c < 0) continue
      minRow = Math.min(minRow, r)
      maxRow = Math.max(maxRow, r)
      minColumn = Math.min(minColumn, c)
      maxColumn = Math.max(maxColumn, c)
    }
    if (maxRow < 0) return
    this.select({
      anchor: { rowIndex: minRow, columnIndex: minColumn },
      focus: { rowIndex: maxRow, columnIndex: maxColumn },
    })
  }
}

// One id list per column index map; TanStack memoizes the map.
const columnIdLists = new WeakMap<Record<string, number>, string[]>()

function columnIdsFor(indexes: Record<string, number>): string[] {
  let ids = columnIdLists.get(indexes)
  if (!ids) {
    ids = []
    for (const id in indexes) ids[indexes[id] as number] = id
    columnIdLists.set(indexes, ids)
  }
  return ids
}
