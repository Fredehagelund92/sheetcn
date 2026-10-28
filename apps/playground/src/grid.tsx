import {
  cellEdges,
  formatCell,
  getCellValue,
  isCellReadOnly,
  rectsContain,
  resolveColumnType,
  validateCell,
  type CellValue,
  type Column,
  type SheetCommand,
} from "@sheetcn/core"
import {
  useRowSelectionKey,
  useSheetColumnVirtualizer,
  useSheetPointer,
  useSheetRowVirtualizer,
  useSheetSelection,
  useSheetState,
  type EditState,
  type Sheet,
  type SheetRow,
} from "@sheetcn/react"
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

import { renderCount } from "./bench"

export const ROW_HEIGHT = 32
export const HEADER_HEIGHT = 34
export const GUTTER_WIDTH = 64

/** The lines drawn between cells. */
export type Gridlines = "none" | "rows" | "columns" | "both"

/** The grid's preset: a sheet draws every line, a table only the rows. */
export type GridMode = "sheet" | "table"

export const DEFAULT_GRIDLINES: Record<GridMode, Gridlines> = {
  sheet: "both",
  table: "rows",
}

type AnySheet = Sheet<Record<string, unknown>>
type VirtualItem = ReturnType<
  ReturnType<typeof useSheetColumnVirtualizer>["getVirtualItems"]
>[number]

/** "A", "B", ... "Z", "AA", ... */
export function columnLetter(index: number): string {
  let s = ""
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  }
  return s
}

// Keyboard commands after which the focus cell is scrolled into view.
const SCROLLS = new Set<SheetCommand["type"]>([
  "move",
  "jump",
  "page",
  "rowStart",
  "rowEnd",
  "gridStart",
  "gridEnd",
  "collapse",
  "commitEdit",
])

export function SheetGrid({
  sheet,
  label,
  mode = "sheet",
  gridlines = DEFAULT_GRIDLINES[mode],
  filtered,
  onKey,
}: {
  sheet: AnySheet
  label: string
  mode?: GridMode
  /** Columns a filter names, which get a mark in their header. */
  filtered?: ReadonlySet<string>
  /**
   * Sees each key press before the sheet does, for the app's own keys such
   * as the filter shortcut. Return true when it handled the key.
   */
  onKey?: (e: KeyboardEvent<HTMLDivElement>) => boolean
  /**
   * The lines between cells. The header's bottom line, the row numbers' edge
   * and the pinned columns' edge always show. Set as one attribute on the
   * grid, so changing it renders no rows.
   */
  gridlines?: Gridlines
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { table } = sheet
  const rows = sheet.getRows()
  const startColumns = table.getPinnedVisibleLeafColumns("start")
  const centerColumns = table.getPinnedVisibleLeafColumns("center")
  const width = sheet.getColumnWidth
  const pinnedWidth = startColumns.reduce(
    (w, c) => w + width(c.id),
    GUTTER_WIDTH
  )
  const totalWidth = centerColumns.reduce(
    (w, c) => w + width(c.id),
    pinnedWidth
  )
  const sizingKey = [...startColumns, ...centerColumns]
    .map((c) => width(c.id))
    .join(",")

  const getScrollElement = useCallback(() => scrollRef.current, [])
  const rowVirtualizer = useSheetRowVirtualizer(sheet, {
    getScrollElement,
    rowHeight: ROW_HEIGHT,
    paddingStart: HEADER_HEIGHT,
  })
  const columnVirtualizer = useSheetColumnVirtualizer(sheet, {
    getScrollElement,
    gutterWidth: GUTTER_WIDTH,
  })
  const { onPointerDown, onMouseDown } = useSheetPointer(sheet, {
    insets: () => ({ top: HEADER_HEIGHT, left: pinnedWidth }),
  })
  useEffect(() => {
    sheet.setColumnMeasurer((column, rows) => {
      const host = scrollRef.current
      return host ? measureColumn(host, sheet, column, rows) : Number.NaN
    })
    return () => sheet.setColumnMeasurer(null)
  }, [sheet])

  const viewport = () => {
    const el = scrollRef.current
    return {
      pageRows: el
        ? Math.max(
            1,
            Math.floor((el.clientHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1
          )
        : 20,
      pageColumns: Math.max(1, columnVirtualizer.getVirtualItems().length - 1),
    }
  }

  const scrollToFocus = () => {
    const active = sheet.getActiveRange()
    if (!active) return
    rowVirtualizer.scrollToIndex(active.focus.rowIndex, { align: "auto" })
    const column = active.focus.columnIndex - startColumns.length
    if (column >= 0) columnVirtualizer.scrollToIndex(column, { align: "auto" })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onKey?.(e)) return
    const command = sheet.handleKeyDown(e.nativeEvent, viewport())
    if (command && SCROLLS.has(command.type)) scrollToFocus()
  }

  const virtualRows = rowVirtualizer.getVirtualItems()
  const virtualColumns = columnVirtualizer.getVirtualItems()
  const leftSpacer = (virtualColumns[0]?.start ?? pinnedWidth) - pinnedWidth

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={label}
      aria-rowcount={rows.length + 1}
      aria-colcount={startColumns.length + centerColumns.length + 1}
      aria-multiselectable="true"
      className="grid-scroll"
      data-gridlines={gridlines}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
    >
      <div
        className="grid-canvas"
        style={{ width: totalWidth, height: rowVirtualizer.getTotalSize() }}
      >
        <div
          role="rowgroup"
          className="grid-head"
          style={{ width: totalWidth }}
        >
          <div role="row" aria-rowindex={1} className="grid-row-head">
            <div
              role="columnheader"
              aria-colindex={1}
              aria-label="Select all"
              data-sheet-corner=""
              className="corner"
              style={{ width: GUTTER_WIDTH }}
              title="Select all"
            />
            {startColumns.map((c, i) => (
              <HeaderCell
                key={c.id}
                sheet={sheet}
                columnId={c.id}
                columnIndex={i}
                left={GUTTER_WIDTH + c.getStart("start")}
                width={width(c.id)}
                last={i === startColumns.length - 1}
                filtered={filtered?.has(c.id) ?? false}
              />
            ))}
            <div aria-hidden style={{ width: leftSpacer, flex: "none" }} />
            {virtualColumns.map((v) => {
              const c = centerColumns[v.index]
              if (!c) return null
              return (
                <HeaderCell
                  key={c.id}
                  sheet={sheet}
                  columnId={c.id}
                  columnIndex={startColumns.length + v.index}
                  width={width(c.id)}
                  filtered={filtered?.has(c.id) ?? false}
                />
              )
            })}
          </div>
        </div>
        <div role="rowgroup">
          {virtualRows.map((v) => {
            const row = rows[v.index]
            if (!row) return null
            return (
              <SheetRowView
                key={row.id}
                sheet={sheet}
                row={row}
                rowIndex={v.index}
                start={v.start}
                virtualColumns={virtualColumns}
                leftSpacer={leftSpacer}
                totalWidth={totalWidth}
                sizingKey={sizingKey}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

const HeaderCell = memo(function HeaderCell({
  sheet,
  columnId,
  columnIndex,
  width,
  left,
  last,
  filtered,
}: {
  sheet: AnySheet
  columnId: string
  columnIndex: number
  width: number
  left?: number
  last?: boolean
  filtered: boolean
}) {
  const selected = useSheetSelection(sheet, (s) =>
    s
      .getSelectionRects()
      .some(
        (r) =>
          r.minColumnIndex <= columnIndex && columnIndex <= r.maxColumnIndex
      )
  )
  const column = sheet.getColumn(columnId)
  const header = sheet.table
    .getFlatHeaders()
    .find((h) => h.column.id === columnId)
  const pinned = left !== undefined
  return (
    <div
      role="columnheader"
      aria-colindex={columnIndex + 2}
      data-column-index={columnIndex}
      className={cx(
        "head-cell",
        pinned && "pinned",
        last && "pinned-last",
        selected && "selected",
        column && isEndAligned(column) && "numeric"
      )}
      style={{ width, left }}
    >
      <HeaderContent
        columnIndex={columnIndex}
        title={column?.header ?? ""}
        filtered={filtered}
      />
      {header?.column.getCanResize() && (
        <div
          aria-hidden
          className={cx("resize", header.column.getIsResizing() && "resizing")}
          title="Drag to resize, double-click to fit"
          // Resizing is not a selection.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={sheet.getColumnResizeHandler(columnId)}
          onTouchStart={sheet.getColumnResizeHandler(columnId)}
          onDoubleClick={() => sheet.fitColumn(columnId)}
        />
      )}
    </div>
  )
})

function HeaderContent({
  columnIndex,
  title,
  filtered = false,
}: {
  columnIndex: number
  title: string
  /** A filter names the column: a mark beside its letter. */
  filtered?: boolean
}) {
  return (
    <>
      <span aria-hidden className="letter">
        {columnLetter(columnIndex)}
        {filtered && (
          <svg className="filtered" viewBox="0 0 16 16">
            <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" />
          </svg>
        )}
      </span>
      <span className="title">
        {title}
        {filtered && <span className="sr-only">(filtered)</span>}
      </span>
    </>
  )
}

type RowProps = {
  sheet: AnySheet
  row: SheetRow<Record<string, unknown>>
  rowIndex: number
  start: number
  virtualColumns: VirtualItem[]
  leftSpacer: number
  totalWidth: number
  sizingKey: string
}

/**
 * A row's shell: where it is (its place, its number, its display index for
 * hit testing). A row that only moved renders this and nothing below it.
 */
const SheetRowView = memo(function SheetRowView({
  sheet,
  row,
  rowIndex,
  start,
  virtualColumns,
  leftSpacer,
  totalWidth,
  sizingKey,
}: RowProps) {
  // Re-render only when what the selection draws on this row changes.
  const selectionKey = useRowSelectionKey(sheet, rowIndex)
  const editing = useSheetState(sheet, (s) =>
    s.editing?.rowId === row.id ? s.editing : null
  )
  const rects = selectionKey ? sheet.getSelectionRects() : null
  const anchor = selectionKey ? sheet.getActiveRange()?.anchor : undefined
  const rowSelected =
    rects?.some(
      (r) => r.minRowIndex <= rowIndex && rowIndex <= r.maxRowIndex
    ) ?? false
  // The body depends on the display index only through the selection.
  const selection = useMemo(
    () =>
      rects
        ? {
            rowIndex,
            rects,
            activeColumn:
              anchor?.rowIndex === rowIndex ? anchor.columnIndex : -1,
          }
        : null,
    [rects, rowIndex, anchor]
  )

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      data-row-position={rowIndex}
      className={cx("grid-row", editing && "editing")}
      style={{ transform: `translateY(${start}px)`, width: totalWidth }}
    >
      <div
        role="rowheader"
        aria-colindex={1}
        data-row-index={rowIndex}
        className={cx("gutter", rowSelected && "selected")}
        style={{ width: GUTTER_WIDTH }}
      >
        {(rowIndex + 1).toLocaleString("en-US")}
      </div>
      <SheetRowBody
        sheet={sheet}
        original={row.original}
        rowId={row.id}
        selection={selection}
        editing={editing}
        virtualColumns={virtualColumns}
        leftSpacer={leftSpacer}
        sizingKey={sizingKey}
      />
    </div>
  )
})

type RowSelection = {
  rowIndex: number
  rects: ReturnType<AnySheet["getSelectionRects"]>
  activeColumn: number
}

/** A row's cells, which do not depend on where the row is shown. */
const SheetRowBody = memo(function SheetRowBody({
  sheet,
  original,
  selection,
  editing,
  virtualColumns,
  leftSpacer,
}: {
  sheet: AnySheet
  original: Record<string, unknown>
  rowId: string
  selection: RowSelection | null
  editing: EditState | null
  virtualColumns: VirtualItem[]
  leftSpacer: number
  sizingKey: string
}) {
  useLayoutEffect(() => {
    renderCount.rows++
  })
  const { table } = sheet
  const startColumns = table.getPinnedVisibleLeafColumns("start")
  const centerColumns = table.getPinnedVisibleLeafColumns("center")

  const cell = (
    columnId: string,
    columnIndex: number,
    width: number,
    left?: number
  ) => {
    const column = sheet.getColumn(columnId)
    if (!column) return null
    const rects = selection?.rects ?? []
    const rowIndex = selection?.rowIndex ?? -1
    return (
      <Cell
        key={columnId}
        sheet={sheet}
        column={column}
        original={original}
        columnIndex={columnIndex}
        width={width}
        left={left}
        pinnedLast={
          left !== undefined && columnIndex === startColumns.length - 1
        }
        selected={rectsContain(rects, rowIndex, columnIndex)}
        edges={rects.length ? cellEdges(rects, rowIndex, columnIndex) : null}
        active={selection?.activeColumn === columnIndex}
        editing={editing?.columnId === columnId ? editing : null}
      />
    )
  }

  return (
    <>
      {startColumns.map((c, i) =>
        cell(
          c.id,
          i,
          sheet.getColumnWidth(c.id),
          GUTTER_WIDTH + c.getStart("start")
        )
      )}
      <div aria-hidden style={{ width: leftSpacer, flex: "none" }} />
      {virtualColumns.map((v) => {
        const c = centerColumns[v.index]
        return c
          ? cell(
              c.id,
              startColumns.length + v.index,
              sheet.getColumnWidth(c.id)
            )
          : null
      })}
    </>
  )
})

function Cell({
  sheet,
  column,
  original,
  columnIndex,
  width,
  left,
  pinnedLast,
  selected,
  edges,
  active,
  editing,
}: {
  sheet: AnySheet
  column: Column<Record<string, unknown>>
  original: Record<string, unknown>
  columnIndex: number
  width: number
  left: number | undefined
  pinnedLast: boolean
  selected: boolean
  edges: ReturnType<typeof cellEdges> | null
  active: boolean
  editing: EditState | null
}) {
  const value = getCellValue(column, original)
  const issue = validateCell(column, value, original, sheet.store.getRows())
  const readOnly = isCellReadOnly(column, original)
  const outline = edges
    ? [
        edges.top && "inset 0 2px 0 0 var(--accent)",
        edges.bottom && "inset 0 -2px 0 0 var(--accent)",
        edges.left && "inset 2px 0 0 0 var(--accent)",
        edges.right && "inset -2px 0 0 0 var(--accent)",
      ]
        .filter(Boolean)
        .join(",")
    : ""
  return (
    <div
      role="gridcell"
      aria-colindex={columnIndex + 2}
      aria-selected={selected}
      aria-readonly={readOnly || undefined}
      aria-invalid={issue ? true : undefined}
      title={issue?.message}
      data-column-index={columnIndex}
      tabIndex={active && !editing ? 0 : -1}
      ref={active && !editing ? focusIfGridHasFocus : undefined}
      onDoubleClick={() => sheet.startEdit("edit")}
      className={cx(
        "cell",
        left !== undefined && "pinned",
        pinnedLast && "pinned-last",
        isEndAligned(column) && "numeric",
        readOnly && "read-only",
        selected && !active && "selected"
      )}
      style={{ width, left, boxShadow: outline || undefined }}
    >
      <CellContent column={column} value={value} row={original} />
      {issue && <span aria-hidden className="flag" />}
      {active && !editing && <span aria-hidden className="active-ring" />}
      {editing && <Editor sheet={sheet} column={column} editing={editing} />}
    </div>
  )
}

function CellContent({
  column,
  value,
  row,
}: {
  column: Column<Record<string, unknown>>
  value: CellValue
  row?: Record<string, unknown>
}) {
  const { def } = resolveColumnType(column)
  if (def.edit === "toggle") {
    return (
      <span className={cx("check", value === true && "on")}>
        {value === true ? "Yes" : "No"}
      </span>
    )
  }
  const text = formatCell(column, value, row)
  if (column.type === "select" && text)
    return <span className="chip">{text}</span>
  if (column.type === "longtext") {
    // The first line, and "..." when there are more.
    const end = text.indexOf("\n")
    return (
      <span className="text">
        {end < 0 ? text : `${text.slice(0, end)} ...`}
      </span>
    )
  }
  return (
    <span className={cx("text", column.type === "identifier" && "mono")}>
      {text}
    </span>
  )
}

function Editor({
  sheet,
  column,
  editing,
}: {
  sheet: AnySheet
  column: Column<Record<string, unknown>>
  editing: EditState
}) {
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])
  const props = {
    ref: inputRef,
    "aria-label": `Edit ${column.header}`,
    "aria-invalid": editing.error ? true : undefined,
    value: editing.draft,
    // Keys bubble to the grid, which knows the editor is open.
    onBlur: () => sheet.commitEdit(),
  }
  return (
    <>
      {column.type === "longtext" ? (
        <textarea
          {...props}
          className={cx("editor", "multiline", editing.error && "invalid")}
          onChange={(e) => sheet.setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Alt+Enter starts a new line; Enter commits, through the grid.
            if (e.key !== "Enter" || !e.altKey) return
            e.preventDefault()
            const el = e.currentTarget
            el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end")
            sheet.setDraft(el.value)
          }}
        />
      ) : (
        <input
          {...props}
          className={cx("editor", editing.error && "invalid")}
          onChange={(e) => sheet.setDraft(e.target.value)}
        />
      )}
      {editing.error && (
        <span role="alert" className="editor-error">
          {editing.error}
        </span>
      )}
    </>
  )
}

/**
 * Measures a column as it renders, for `sheet.fitColumn`: its header and the
 * cells of `rows` are drawn off screen inside the grid, with the grid's own
 * markup and classes, and the widest one wins. Each distinct text is drawn
 * once, so a column of a few options costs a few elements.
 */
function measureColumn(
  host: HTMLElement,
  sheet: AnySheet,
  column: Column<Record<string, unknown>>,
  rows: readonly Record<string, unknown>[]
): number {
  const numeric = isEndAligned(column)
  const seen = new Set<string>()
  const cells: ReactElement[] = []
  for (const row of rows) {
    const value = getCellValue(column, row)
    const text = formatCell(column, value)
    if (seen.has(text)) continue
    seen.add(text)
    cells.push(
      <div key={text} className={cx("cell", numeric && "numeric")}>
        <CellContent column={column} value={value} />
      </div>
    )
  }
  const box = document.createElement("div")
  box.className = "measure"
  host.append(box)
  const root = createRoot(box)
  flushSync(() =>
    root.render(
      <>
        <div className={cx("head-cell", numeric && "numeric")}>
          <HeaderContent
            columnIndex={sheet.columnIndexOf(column.id)}
            title={column.header}
          />
        </div>
        {cells}
      </>
    )
  )
  let width = 0
  for (const element of box.children) {
    width = Math.max(width, element.getBoundingClientRect().width)
  }
  root.unmount()
  box.remove()
  return width
}

/**
 * Roving focus: called when the active cell element attaches (it became
 * active, mounted after a scroll, or its editor closed). Takes DOM focus only
 * when the grid has it or focus fell to the page body, never from another
 * control.
 */
function focusIfGridHasFocus(el: HTMLElement | null) {
  if (!el) return
  const grid = el.closest("[role=grid]")
  const current = document.activeElement
  if (
    grid &&
    (current === document.body || current === null || grid.contains(current))
  ) {
    el.focus({ preventScroll: true })
  }
}

/** Numbers and the like sit at the end of their cells. */
function isEndAligned(column: Column<Record<string, unknown>>) {
  return resolveColumnType(column).def.align === "end"
}

function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ")
}
