// @vitest-environment jsdom
// Gate: a one-cell commit on 100,000 rows by 20 columns, through useSheet and
// the TanStack row model, takes under 3 ms (median). It covers the store
// commit, the React render of the hook and the reads a grid makes after it:
// the row model, the display order and the selection bounds. The browser
// gate (commit to paint) is measured in the playground.
import { defineColumns, type Column } from "@sheetcn/core"
import {
  cellSelectionFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { describe, expect, it } from "vitest"

import { useSheet } from "../src/index.js"
import { inAct, renderHook } from "./render.js"

type Row = { id: string } & Record<`c${number}`, number | null>

const ROWS = 100_000
const COLUMNS = 20
const BUDGET_MS = 3
const RUNS = 200

const columns: Column<Row>[] = defineColumns<Row>((c) =>
  Array.from({ length: COLUMNS }, (_, j) => c.number(`c${j}`))
)
const getRowId = (r: Row) => r.id

function makeRows(): Row[] {
  return Array.from({ length: ROWS }, (_, i) => {
    const row: Row = { id: `r${i}` }
    for (let j = 0; j < COLUMNS; j++) row[`c${j}`] = i + j
    return row
  })
}

let seed = 7
const pick = (n: number) => {
  seed = (seed * 48271) % 2147483647
  return seed % n
}

function measure(commit: (i: number) => void, runs = RUNS) {
  for (let i = 0; i < 20; i++) commit(i)
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    commit(i)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const at = (q: number) => times[Math.floor(q * (times.length - 1))] as number
  return { median: at(0.5), p95: at(0.95) }
}

function measureSheet() {
  const rows = makeRows()
  const { result, unmount } = renderHook(
    () => useSheet<Row>({ columns, getRowId, defaultData: rows }),
    undefined
  )
  const sheet = () => result.current
  const times = measure((i) => {
    inAct(() => {
      sheet().store.transaction("edit", (tx) =>
        tx.set(`r${pick(ROWS)}`, `c${pick(COLUMNS)}`, -i)
      )
    })
    sheet().getRows()
    sheet().getSelectionRects()
  })
  unmount()
  return times
}

// The same table with TanStack's default core row model, its data swapped
// one row at a time as the store does.
function measureStock() {
  const features = tableFeatures({
    cellSelectionFeature,
    columnSizingFeature,
    columnResizingFeature,
    columnPinningFeature,
  })
  let data = makeRows()
  const defs = columns.map((c) => ({
    id: c.id,
    accessorFn: (row: Row) => row[c.id as `c${number}`],
  }))
  const r = renderHook(
    (d: Row[]) =>
      useTable({
        features,
        columns: defs,
        data: d,
        getRowId,
        autoResetCellSelection: false,
      }),
    data
  )
  const times = measure((i) => {
    const next = data.slice()
    const k = pick(ROWS)
    next[k] = { ...(data[k] as Row), c0: -i }
    data = next
    r.rerender(data)
    r.result.current.getRowsInDisplayOrder()
    r.result.current.getCellSelectionBounds()
  }, 20)
  r.unmount()
  return times
}

describe(`one-cell commit through useSheet on ${ROWS.toLocaleString("en")} rows`, () => {
  it(`takes under ${BUDGET_MS} ms, a tenth or less of TanStack's own row model`, () => {
    const ours = measureSheet()
    const stock = measureStock()
    console.log(
      `useSheet: median ${ours.median.toFixed(3)} ms, p95 ${ours.p95.toFixed(3)} ms; ` +
        `TanStack core row model: median ${stock.median.toFixed(3)} ms`
    )
    expect(ours.median).toBeLessThan(BUDGET_MS)
    expect(ours.median * 10).toBeLessThan(stock.median)
  }, 60_000)
})
