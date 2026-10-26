// @vitest-environment jsdom
// A one-cell commit on 100,000 rows by 20 columns, through useSheet and the
// TanStack row model, builds exactly one new Row and reuses all the others.
// That is what keeps the commit O(changed rows). The timing is logged, not
// asserted: the commit to paint gate (5 ms, 25 ms at 4x CPU) is measured in
// the browser, in the playground.
import { defineColumns, type Column } from "@sheetcn/core"
import { describe, expect, it } from "vitest"

import { useSheet } from "../src/index.js"
import { inAct, renderHook } from "./render.js"

type Row = { id: string } & Record<`c${number}`, number | null>

const ROWS = 100_000
const COLUMNS = 20

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

describe(`one-cell commit through useSheet on ${ROWS.toLocaleString("en")} rows`, () => {
  it("builds one new Row and reuses all the others", () => {
    const { result, unmount } = renderHook(
      () => useSheet<Row>({ columns, getRowId, defaultData: makeRows() }),
      undefined
    )
    const sheet = () => result.current
    const before = sheet().getRows().slice()
    const byId = sheet().table.getRowModel().rowsById
    expect(before).toHaveLength(ROWS)

    const start = performance.now()
    inAct(() => {
      sheet().store.transaction("edit", (tx) => tx.set("r54321", "c3", -1))
    })
    const after = sheet().getRows()
    sheet().getSelectionRects()
    const elapsed = performance.now() - start
    console.log(`useSheet one-cell commit: ${elapsed.toFixed(3)} ms`)

    expect(after).toHaveLength(ROWS)
    const replaced: number[] = []
    for (let i = 0; i < ROWS; i++) {
      if (after[i] !== before[i]) replaced.push(i)
    }
    expect(replaced).toEqual([54321])
    expect(after[54321]?.original.c3).toBe(-1)
    expect(sheet().table.getRowModel().rowsById).toBe(byId)
    expect(byId.r54321).toBe(after[54321])
    unmount()
  }, 60_000)
})
