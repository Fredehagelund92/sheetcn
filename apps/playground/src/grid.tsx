import {
  cellEdges,
  formatCell,
  getCellValue,
  isCellReadOnly,
  rectsContain,
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
  useRef,
  type KeyboardEvent,
} from "react"

import { renderCount } from "./bench"

export const ROW_HEIGHT = 32
export const HEADER_HEIGHT = 34
export const GUTTER_WIDTH = 64

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
}: {
  sheet: AnySheet
  label: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { table } = sheet
  const rows = sheet.getRows()
  const startColumns = table.getPinnedLeafColumns("start")
  const centerColumns = table.getPinnedLeafColumns("center")
  const pinnedWidth = startColumns.reduce(
    (w, c) => w + c.getSize(),
    GUTTER_WIDTH
  )
  const totalWidth = centerColumns.reduce(
    (w, c) => w + c.getSize(),
    pinnedWidth
  )
  const sizingKey = [...startColumns, ...centerColumns]
    .map((c) => c.getSize())
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
                width={c.getSize()}
                last={i === startColumns.length - 1}
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
                  width={c.getSize()}
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
}: {
  sheet: AnySheet
  columnId: string
  columnIndex: number
  width: number
  left?: number
  last?: boolean
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
        column?.type === "number" && "numeric"
      )}
      style={{ width, left }}
    >
      <span aria-hidden className="letter">
        {columnLetter(columnIndex)}
      </span>
      <span className="title">{column?.header}</span>
      {header?.column.getCanResize() && (
        <div
          aria-hidden
          className={cx("resize", header.column.getIsResizing() && "resizing")}
          // Resizing is not a selection.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onDoubleClick={() => header.column.resetSize()}
        />
      )}
    </div>
  )
})

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

const SheetRowView = memo(function SheetRowView({
  sheet,
  row,
  rowIndex,
  start,
  virtualColumns,
  leftSpacer,
  totalWidth,
}: RowProps) {
  useLayoutEffect(() => {
    renderCount.rows++
  })
  // Re-render only when what the selection draws on this row changes.
  const selectionKey = useRowSelectionKey(sheet, rowIndex)
  const editing = useSheetState(sheet, (s) =>
    s.editing?.rowId === row.id ? s.editing : null
  )
  const { table } = sheet
  const startColumns = table.getPinnedLeafColumns("start")
  const centerColumns = table.getPinnedLeafColumns("center")
  const rects = selectionKey ? sheet.getSelectionRects() : []
  const active = selectionKey ? sheet.getActiveRange()?.anchor : undefined
  const activeColumn = active?.rowIndex === rowIndex ? active.columnIndex : -1
  const rowSelected = rects.some(
    (r) => r.minRowIndex <= rowIndex && rowIndex <= r.maxRowIndex
  )

  const cell = (
    columnId: string,
    columnIndex: number,
    width: number,
    left?: number
  ) => {
    const column = sheet.getColumn(columnId)
    if (!column) return null
    return (
      <Cell
        key={columnId}
        sheet={sheet}
        column={column}
        original={row.original}
        rowIndex={rowIndex}
        columnIndex={columnIndex}
        width={width}
        left={left}
        pinnedLast={
          left !== undefined && columnIndex === startColumns.length - 1
        }
        selected={rectsContain(rects, rowIndex, columnIndex)}
        edges={rects.length ? cellEdges(rects, rowIndex, columnIndex) : null}
        active={activeColumn === columnIndex}
        editing={editing?.columnId === columnId ? editing : null}
      />
    )
  }

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
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
      {startColumns.map((c, i) =>
        cell(c.id, i, c.getSize(), GUTTER_WIDTH + c.getStart("start"))
      )}
      <div aria-hidden style={{ width: leftSpacer, flex: "none" }} />
      {virtualColumns.map((v) => {
        const c = centerColumns[v.index]
        return c ? cell(c.id, startColumns.length + v.index, c.getSize()) : null
      })}
    </div>
  )
})

function Cell({
  sheet,
  column,
  original,
  rowIndex,
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
  rowIndex: number
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
  const issue = validateCell(column, value, original)
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
      data-row-index={rowIndex}
      data-column-index={columnIndex}
      tabIndex={active && !editing ? 0 : -1}
      ref={active && !editing ? focusIfGridHasFocus : undefined}
      onDoubleClick={() => sheet.startEdit("edit")}
      className={cx(
        "cell",
        left !== undefined && "pinned",
        pinnedLast && "pinned-last",
        column.type === "number" && "numeric",
        readOnly && "read-only",
        selected && !active && "selected"
      )}
      style={{ width, left, boxShadow: outline || undefined }}
    >
      <CellContent column={column} value={value} />
      {issue && <span aria-hidden className="flag" />}
      {active && !editing && <span aria-hidden className="active-ring" />}
      {editing && <Editor sheet={sheet} column={column} editing={editing} />}
    </div>
  )
}

function CellContent({
  column,
  value,
}: {
  column: Column<Record<string, unknown>>
  value: CellValue
}) {
  if (column.type === "boolean") {
    return (
      <span className={cx("check", value === true && "on")}>
        {value === true ? "Yes" : "No"}
      </span>
    )
  }
  const text = formatCell(column, value)
  if (column.type === "select" && text)
    return <span className="chip">{text}</span>
  return <span className="text">{text}</span>
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
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])
  return (
    <>
      <input
        ref={inputRef}
        aria-label={`Edit ${column.header}`}
        aria-invalid={editing.error ? true : undefined}
        className={cx("editor", editing.error && "invalid")}
        value={editing.draft}
        onChange={(e) => sheet.setDraft(e.target.value)}
        // Keys bubble to the grid, which knows the editor is open.
        onBlur={() => sheet.commitEdit()}
      />
      {editing.error && (
        <span role="alert" className="editor-error">
          {editing.error}
        </span>
      )}
    </>
  )
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

function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ")
}
