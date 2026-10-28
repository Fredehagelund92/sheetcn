// The gate for a one-cell commit on 100,000 rows with a filter, a sort and a
// group on, the view updated after it: under 1 ms in the core, the median
// of 300 commits, as the other commit gates are. A median of work this small
// moves with the load on the machine, so this file runs only in the
// performance job and nightly (`pnpm test:perf`), not in `pnpm test`.
import { describe, expect, it } from "vitest"

import { createSheetStore, type SheetView } from "../src/index.js"
import {
  columns,
  getRowId,
  makeRows,
  model,
  random,
  ROWS,
  time,
  type Row,
} from "./budget-data.js"

const view: SheetView = {
  filter: {
    match: "all",
    items: [
      { column: "status", op: "isAnyOf", values: ["review", "Conflict"] },
      { column: "score", op: "lessThan", values: ["0.8"] },
      { column: "updated", op: "inLast", values: ["30", "days"] },
    ],
  },
  sort: [{ column: "score", dir: "asc" }],
  group: { column: "status" },
}

describe(`one-cell commit on ${ROWS.toLocaleString("en")} rows with a view on`, () => {
  it("takes under 1 ms, the median of 300 commits", () => {
    const store = createSheetStore<Row>({ rows: makeRows(), columns, getRowId })
    const shown = model(view)
    shown.compute(store.getRows())
    const t = time(300, (i) => {
      const id = `r${Math.floor(random() * ROWS)}`
      store.transaction("edit", (tx) =>
        tx.set(id, i % 2 ? "score" : "status", i % 2 ? random() : "review")
      )
      shown.compute(store.getRows())
    })
    console.log(`commit and view update: median ${t.median.toFixed(3)} ms`)
    expect(t.median).toBeLessThan(1)
  }, 60_000)
})
