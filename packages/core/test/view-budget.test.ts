// Gates for filter, sort and group on 100,000 rows, in the core: applying a
// filter takes under 10 ms and a sort under 100 ms. A one-cell commit with a
// view on is gated in view-commit.perf.test.ts. The folded text that text filters match, and the ranks a sort
// reads, are built on first use and kept with the rows, as the value index
// is; the first fold is timed on its own, and sorts are timed both ways.
//
// A filter or a sort is several milliseconds of work in one piece, so other
// work on the machine (the suite runs its files in parallel) lands inside
// some runs. Those gates take the fastest of several runs, the one least
// disturbed, and log the median beside it. The first sort by text, which is
// one sort through the collator, is gated in text-sort.perf.test.ts.
import { describe, expect, it } from "vitest"

import type { SheetView } from "../src/index.js"
import { makeRows, model, ROWS, show, time } from "./budget-data.js"

const threeFilters: SheetView = {
  filter: {
    match: "all",
    items: [
      { column: "status", op: "isAnyOf", values: ["review", "Conflict"] },
      { column: "score", op: "lessThan", values: ["0.8"] },
      { column: "updated", op: "inLast", values: ["30", "days"] },
    ],
  },
}

describe(`filter, sort and group on ${ROWS.toLocaleString("en")} rows`, () => {
  const rows = makeRows()

  it("applies three filters in under 10 ms", () => {
    let shown = 0
    const t = time(30, () => {
      shown = model(threeFilters).compute(rows).rows.length
    })
    console.log(`three filters: ${show(t)}, ${shown} rows`)
    expect(shown).toBeGreaterThan(0)
    expect(t.fastest).toBeLessThan(10)
  })

  it("applies a text filter in under 10 ms once the text is folded", () => {
    const contains = (needle: string): SheetView => ({
      filter: {
        match: "all",
        items: [{ column: "account", op: "contains", values: [needle] }],
      },
    })
    const start = performance.now()
    model(contains("cafe")).compute(rows)
    const first = performance.now() - start
    // Typed letter by letter, as the value popover filters.
    const needles = ["k", "ke", "kes", "kest", "kestr", "kestre", "kestrel"]
    const t = time(28, (i) => {
      model(
        contains(needles[Math.max(i, 0) % needles.length] as string)
      ).compute(rows)
    })
    console.log(
      `contains: ${show(t)}; folding the column first ${first.toFixed(1)} ms`
    )
    expect(t.fastest).toBeLessThan(10)
  })

  it("sorts by a number and in groups in under 100 ms, and again by any column", () => {
    // A fresh array has no ranks yet, so this sorts the column's values
    // (cold). Sorting the same array again, as a filter change does with a
    // sort on, reads the ranks kept with it (warm).
    const both = (view: SheetView) => ({
      cold: time(7, () => {
        model(view).compute(rows.slice())
      }),
      warm: time(7, () => {
        model(view).compute(rows)
      }),
    })
    const number = both({ sort: [{ column: "score", dir: "asc" }] })
    const text = both({ sort: [{ column: "account", dir: "asc" }] })
    const grouped = both({
      group: { column: "status" },
      sort: [{ column: "score", dir: "desc" }],
    })
    for (const [name, t] of [
      ["number", number],
      ["text", text],
      ["grouped by status and sorted", grouped],
    ] as const) {
      console.log(`sort, ${name}: ${show(t.cold)}; again ${show(t.warm)}`)
    }
    expect(number.cold.fastest).toBeLessThan(100)
    expect(grouped.cold.fastest).toBeLessThan(100)
    for (const { warm } of [number, text, grouped]) {
      expect(warm.fastest).toBeLessThan(100)
    }
  }, 60_000)
})
