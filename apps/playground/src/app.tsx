import {
  useSheet,
  useSheetHistory,
  useSheetSelection,
  useSheetState,
  type Sheet,
} from "@sheetcn/react"
import { useEffect, useState } from "react"

import { installBench, measureCommits, type Stats } from "./bench"
import { columns, getRowId, makeItems } from "./data"
import { SheetGrid, columnLetter } from "./grid"

const params = new URLSearchParams(location.search)
const ROWS = Math.max(0, Number(params.get("rows") ?? 100_000) || 0)
const data = makeItems(ROWS)

type AnySheet = Sheet<Record<string, unknown>>

export function App() {
  const typed = useSheet({ columns, getRowId, defaultData: data })
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
          {ROWS.toLocaleString("en-US")} rows by {columns.length} columns
        </span>
      </header>
      <Toolbar
        sheet={sheet}
        onMeasure={() => void measure()}
        measuring={measuring}
      />
      <main className="grid-host">
        <SheetGrid sheet={sheet} label="Items" />
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
