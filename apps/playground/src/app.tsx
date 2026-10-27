import {
  useSheet,
  useSheetHistory,
  useSheetSelection,
  useSheetState,
  type Sheet,
} from "@sheetcn/react"
import type { ColumnSizing } from "@sheetcn/core"
import { useEffect, useState } from "react"

import { installBench, measureCommits, type Stats } from "./bench"
import { columns, getRowId, makeItems } from "./data"
import { SheetGrid, columnLetter } from "./grid"

const params = new URLSearchParams(location.search)
const ROWS = Math.max(0, Number(params.get("rows") ?? 100_000) || 0)
const data = makeItems(ROWS)
// ?columns=9 shows the first nine columns, narrow enough to fill a wide screen.
const COLUMNS = Math.max(1, Number(params.get("columns")) || columns.length)
const shownColumns = columns.slice(0, COLUMNS)
const SIZING: ColumnSizing = params.get("sizing") === "fill" ? "fill" : "fixed"

type AnySheet = Sheet<Record<string, unknown>>

export function App() {
  const [sizing, setSizing] = useState(SIZING)
  // The grid's share of the window's width, to show "fill" without resizing
  // the window.
  const [frame, setFrame] = useState(100)
  const typed = useSheet({
    columns: shownColumns,
    getRowId,
    defaultData: data,
    sizing,
  })
  // The views read cells through the columns, so they need no row type.
  const sheet = typed as unknown as AnySheet
  const [stats, setStats] = useState<Stats | null>(null)
  const [measuring, setMeasuring] = useState(false)

  useEffect(() => installBench(sheet), [sheet])

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
      <Toolbar
        sheet={sheet}
        onMeasure={() => void measure()}
        measuring={measuring}
      />
      <ColumnBar
        sheet={sheet}
        sizing={sizing}
        onSizing={setSizing}
        frame={frame}
        onFrame={setFrame}
      />
      <main className="grid-host">
        <div
          className={frame < 100 ? "grid-frame framed" : "grid-frame"}
          style={{ width: `${frame}%` }}
        >
          <SheetGrid sheet={sheet} label="Items" />
        </div>
      </main>
      <StatusBar sheet={sheet} stats={stats} />
    </div>
  )
}

function Toolbar({
  sheet,
  onMeasure,
  measuring,
}: {
  sheet: AnySheet
  onMeasure: () => void
  measuring: boolean
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
      <button type="button" disabled={!history.canUndo} onClick={sheet.undo}>
        Undo
      </button>
      <button type="button" disabled={!history.canRedo} onClick={sheet.redo}>
        Redo
      </button>
      <button type="button" disabled={measuring} onClick={onMeasure}>
        {measuring ? "Measuring..." : "Measure commit"}
      </button>
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
