// Gate: committing one cell on 100,000 rows by 20 columns takes under 1 ms in
// the core, median over many commits. The row index is built once, on the
// first lookup, and is not part of the per-commit cost.
import { describe, expect, it } from "vitest"

import {
  applyChange,
  createSheetStore,
  defineColumns,
  type Column,
} from "../src/index.js"

type Row = { id: string } & Record<`c${number}`, number | null>

const ROWS = 100_000
const COLUMNS = 20
const BUDGET_MS = 1
const RUNS = 500

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

// Deterministic, spread over the whole sheet.
let seed = 1
const pick = (n: number) => {
  seed = (seed * 48271) % 2147483647
  return seed % n
}

function measure(commit: (i: number) => void) {
  for (let i = 0; i < 50; i++) commit(i)
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now()
    commit(i)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const at = (q: number) => times[Math.floor(q * (times.length - 1))] as number
  return { median: at(0.5), p95: at(0.95) }
}

describe(`one-cell commit on ${ROWS.toLocaleString("en")} rows`, () => {
  it(`takes under ${BUDGET_MS} ms in an uncontrolled store`, () => {
    const store = createSheetStore<Row>({ rows: makeRows(), columns, getRowId })
    const { median, p95 } = measure((i) => {
      store.transaction("edit", (tx) =>
        tx.set(`r${pick(ROWS)}`, `c${pick(COLUMNS)}`, -i)
      )
    })
    console.log(
      `uncontrolled: median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`
    )
    expect(median).toBeLessThan(BUDGET_MS)
  })

  it(`takes under ${BUDGET_MS} ms in controlled mode, applyChange included`, () => {
    let data: readonly Row[] = makeRows()
    const store = createSheetStore<Row>({
      rows: data,
      columns,
      getRowId,
      controlled: true,
      onChange: (change) => {
        data = applyChange(data, change, { columns, getRowId })
      },
    })
    const { median, p95 } = measure((i) => {
      store.transaction("edit", (tx) =>
        tx.set(`r${pick(ROWS)}`, `c${pick(COLUMNS)}`, -i)
      )
      store.setRows(data)
    })
    console.log(
      `controlled: median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`
    )
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
