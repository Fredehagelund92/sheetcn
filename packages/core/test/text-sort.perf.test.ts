// The gate for the first sort by text on 100,000 rows: under 100 ms, on the
// median of rounds. One sort through the collator is work that shared CI
// runners time too unevenly for every pull request, so this file runs only
// in the performance job and nightly (`pnpm test:perf`), not in `pnpm test`.
import { describe, expect, it } from "vitest"

import type { SheetView } from "../src/index.js"
import { makeRows, model, show, time } from "./budget-data.js"

describe("first sort by text on 100,000 rows", () => {
  const rows = makeRows()
  const view: SheetView = { sort: [{ column: "account", dir: "asc" }] }

  it("takes under 100 ms, the median of rounds", () => {
    // A fresh array has no ranks yet, so this sorts the column's texts.
    const round = () =>
      time(15, () => {
        model(view).compute(rows.slice())
      })
    const rounds = [round(), round(), round()]
    for (const t of rounds) console.log(`sort, text: ${show(t)}`)
    const medians = rounds.map((t) => t.median).sort((a, b) => a - b)
    expect(medians[1]).toBeLessThan(100)
  }, 120_000)
})
