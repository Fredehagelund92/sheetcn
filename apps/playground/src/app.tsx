import {
  focusActiveCell,
  useSheet,
  useSheetHistory,
  useSheetSelection,
  useSheetState,
  type Sheet,
} from "@sheetcn/react"
import type { ColumnSizing, SheetView } from "@sheetcn/core"
import { useEffect, useMemo, useState } from "react"

import { installBench, measureCommits, type Stats } from "./bench"
import { columns, getRowId, makeItems, types } from "./data"
import {
  FilterBar,
  Icon,
  NEW_FILTER,
  filteredColumns,
  type FilterFlow,
} from "./filter-bar"
import {
  DEFAULT_GRIDLINES,
  SheetGrid,
  columnLetter,
  type GridMode,
  type Gridlines,
} from "./grid"
import { SAVED_VIEWS, ViewTabs, type SavedView } from "./views"

const params = new URLSearchParams(location.search)
const ROWS = Math.max(0, Number(params.get("rows") ?? 100_000) || 0)
const data = makeItems(ROWS)
// ?columns=9 shows the first nine columns, narrow enough to fill a wide screen.
const COLUMNS = Math.max(1, Number(params.get("columns")) || columns.length)
const shownColumns = columns.slice(0, COLUMNS)
const SIZING: ColumnSizing = params.get("sizing") === "fill" ? "fill" : "fixed"
// ?mode=table starts with the table's gridlines, ?gridlines=columns with those.
const MODE: GridMode = params.get("mode") === "table" ? "table" : "sheet"
const GRIDLINES: Record<Gridlines, string> = {
  none: "None",
  rows: "Rows",
  columns: "Columns",
  both: "Both",
}
const startGridlines =
  (Object.keys(GRIDLINES) as Gridlines[]).find(
    (g) => g === params.get("gridlines")
  ) ?? DEFAULT_GRIDLINES[MODE]

// The demo dates are invented and fall in 2026, so relative dates ("in the
// last 30 days") read today as 2026-10-27; ?today=YYYY-MM-DD sets another.
const TODAY = params.get("today") ?? "2026-10-27"

type AnySheet = Sheet<Record<string, unknown>>

/** Puts the focus back on the grid's active cell. */
function focusGrid(sheet: AnySheet) {
  const grid = document.querySelector<HTMLElement>("[role=grid]")
  if (grid) focusActiveCell(sheet, grid)
}

export function App() {
  const [sizing, setSizing] = useState(SIZING)
  // The grid's share of the window's width, to show "fill" without resizing
  // the window.
  const [frame, setFrame] = useState(100)
  const [gridlines, setGridlines] = useState(startGridlines)
  // The app owns the view and its saved views; the sheet shows the view.
  const [saved, setSaved] = useState<SavedView[]>(SAVED_VIEWS)
  const [picked, setPicked] = useState(0)
  const [view, setView] = useState<SheetView>(() => saved[0]?.view ?? {})
  const [flow, setFlow] = useState<FilterFlow | null>(null)
  const typed = useSheet({
    types,
    columns: shownColumns,
    getRowId,
    defaultData: data,
    sizing,
    view,
    onViewChange: setView,
    today: TODAY,
  })
  // The views read cells through the columns, so they need no row type.
  const sheet = typed as unknown as AnySheet
  const [stats, setStats] = useState<Stats | null>(null)
  const [measuring, setMeasuring] = useState(false)

  useEffect(() => installBench(sheet), [sheet])

  // Ctrl or Cmd and Shift and F opens the filter from anywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault()
        sheet.cancelEdit()
        setFlow(NEW_FILTER)
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [sheet])

  const filtered = useMemo(() => filteredColumns(view), [view])

  const measure = async () => {
    setMeasuring(true)
    setStats(await measureCommits(sheet))
    setMeasuring(false)
  }

  return (
    <div className="app">
      <header className="top">
        <h1>sheetcn playground</h1>
        <span className="muted">
          {ROWS.toLocaleString("en-US")} rows by {shownColumns.length} columns
        </span>
      </header>
      <ViewTabs
        sheet={sheet}
        saved={saved}
        current={picked}
        onPick={(i) => {
          setPicked(i)
          setFlow(null)
          setView(saved[i]?.view ?? {})
        }}
        onSave={(i, next) =>
          setSaved((list) =>
            list.map((s, j) => (j === i ? { ...s, view: next } : s))
          )
        }
      />
      <Toolbar
        sheet={sheet}
        onFilter={
          // The filter bar has its own button once it shows.
          filtered.size || flow ? null : () => setFlow(NEW_FILTER)
        }
        onMeasure={() => void measure()}
        measuring={measuring}
        gridlines={gridlines}
        onGridlines={setGridlines}
      />
      <ColumnBar
        sheet={sheet}
        sizing={sizing}
        onSizing={setSizing}
        frame={frame}
        onFrame={setFrame}
      />
      <FilterBar
        sheet={sheet}
        flow={flow}
        onFlow={setFlow}
        onGrid={() => focusGrid(sheet)}
      />
      <main className="grid-host">
        <div
          className={frame < 100 ? "grid-frame framed" : "grid-frame"}
          style={{ width: `${frame}%` }}
        >
          <SheetGrid
            sheet={sheet}
            label="Items"
            mode={MODE}
            gridlines={gridlines}
            filtered={filtered}
            onKey={(e) => {
              // In table mode F opens the filter; in a sheet it types.
              if (
                MODE === "table" &&
                e.key.toLowerCase() === "f" &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                !sheet.getState().editing
              ) {
                e.preventDefault()
                setFlow(NEW_FILTER)
                return true
              }
              return false
            }}
          />
        </div>
      </main>
      <StatusBar sheet={sheet} stats={stats} />
    </div>
  )
}

function Toolbar({
  sheet,
  onFilter,
  onMeasure,
  measuring,
  gridlines,
  onGridlines,
}: {
  sheet: AnySheet
  onFilter: (() => void) | null
  onMeasure: () => void
  measuring: boolean
  gridlines: Gridlines
  onGridlines: (gridlines: Gridlines) => void
}) {
  const history = useSheetHistory(sheet)
  const address = useSheetSelection(sheet, (s) => {
    const active = s.getActiveRange()
    if (!active) return ""
    const name = (r: number, c: number) => `${columnLetter(c)}${r + 1}`
    const { anchor, focus } = active
    const a = name(anchor.rowIndex, anchor.columnIndex)
    return anchor.rowIndex === focus.rowIndex &&
      anchor.columnIndex === focus.columnIndex
      ? a
      : `${a}:${name(focus.rowIndex, focus.columnIndex)}`
  })
  return (
    <div role="toolbar" aria-label="Sheet" className="toolbar">
      <output aria-label="Selected range" className="address">
        {address || "-"}
      </output>
      {onFilter && (
        <button
          type="button"
          title="Filter (Ctrl or Cmd, Shift and F)"
          aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
          onClick={onFilter}
        >
          <Icon name="filter" />
          Filter
        </button>
      )}
      <button type="button" disabled={!history.canUndo} onClick={sheet.undo}>
        Undo
      </button>
      <button type="button" disabled={!history.canRedo} onClick={sheet.redo}>
        Redo
      </button>
      <button type="button" disabled={measuring} onClick={onMeasure}>
        {measuring ? "Measuring..." : "Measure commit"}
      </button>
      <span aria-hidden className="muted">
        Grid lines
      </span>
      <div role="group" aria-label="Grid lines" className="segmented">
        {(Object.keys(GRIDLINES) as Gridlines[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={gridlines === value}
            onClick={() => onGridlines(value)}
          >
            {GRIDLINES[value]}
          </button>
        ))}
      </div>
      <span className="muted hint">
        Click, Shift+click or drag to select. Enter or type to edit.
      </span>
    </div>
  )
}

function ColumnBar({
  sheet,
  sizing,
  onSizing,
  frame,
  onFrame,
}: {
  sheet: AnySheet
  sizing: ColumnSizing
  onSizing: (sizing: ColumnSizing) => void
  frame: number
  onFrame: (frame: number) => void
}) {
  const activeColumn = useSheetSelection(sheet, (s) => {
    const index = s.getActiveRange()?.anchor.columnIndex
    return index === undefined ? null : (s.getColumnIds()[index] ?? null)
  })
  const header = activeColumn ? sheet.getColumn(activeColumn)?.header : null
  return (
    <div role="toolbar" aria-label="Columns" className="toolbar">
      <div role="group" aria-label="Column sizing" className="segmented">
        {(["fixed", "fill"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={sizing === mode}
            onClick={() => onSizing(mode)}
          >
            {mode === "fixed" ? "Fixed widths" : "Fill width"}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!activeColumn}
        onClick={() => activeColumn && sheet.fitColumn(activeColumn)}
      >
        {header ? `Fit ${header}` : "Fit column"}
      </button>
      <button type="button" onClick={sheet.fitAllColumns}>
        Fit all columns
      </button>
      <label className="frame">
        <span className="muted">Grid width</span>
        <input
          type="range"
          min={30}
          max={100}
          value={frame}
          onChange={(e) => onFrame(Number(e.target.value))}
        />
        <output className="muted">{frame}%</output>
      </label>
      <span className="muted hint">
        Double-click a column&apos;s right edge to fit it.
      </span>
    </div>
  )
}

function StatusBar({ sheet, stats }: { sheet: AnySheet; stats: Stats | null }) {
  const count = useSheetSelection(sheet, (s) => s.table.getSelectedCellCount())
  const notice = useSheetState(sheet, (s) => s.notice)
  return (
    <footer className="status">
      <span aria-live="polite" className="notice">
        {notice}
      </span>
      {stats && (
        <span className="measure">
          One-cell commit to paint: median {stats.median} ms, p95 {stats.p95}{" "}
          ms, max {stats.max} ms over {stats.runs} commits,{" "}
          {stats.rowRendersPerCommit} row renders each
        </span>
      )}
      <span className="count">
        {count > 1 ? `${count.toLocaleString("en-US")} cells selected` : ""}
      </span>
    </footer>
  )
}
