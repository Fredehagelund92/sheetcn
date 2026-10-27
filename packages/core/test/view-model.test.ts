import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  createSheetStore,
  createViewModel,
  defineColumns,
  viewsEqual,
  type Column,
  type SheetView,
  type ViewResult,
} from "../src/index.js"

type Item = {
  id: string
  name: string | null
  qty: number | null
  due: string | null
  status: string | null
}

const columns: Column<Item>[] = defineColumns<Item>((c) => [
  c.text("name"),
  c.number("qty"),
  c.date("due"),
  c.select("status", {
    options: [
      { value: "open", label: "Open" },
      { value: "review", label: "Needs review" },
      { value: "shut", label: "Closed" },
    ],
  }),
])
const getRowId = (r: Item) => r.id

const rows: Item[] = [
  { id: "a", name: "pear", qty: 3, due: "2026-10-27", status: "shut" },
  { id: "b", name: "Apple", qty: null, due: "2026-09-02", status: "open" },
  { id: "c", name: "cherry", qty: 3, due: null, status: "review" },
  { id: "d", name: null, qty: 1, due: "2026-10-01", status: "open" },
  { id: "e", name: "banana", qty: 10, due: "2026-09-30", status: null },
  { id: "f", name: "Äpfel", qty: 1, due: "2026-10-27", status: "shut" },
]

const model = (view: SheetView) =>
  createViewModel({ columns, getRowId, view, today: "2026-10-27" })
const ids = (result: ViewResult<Item>) => result.rows.map((r) => r.id)

describe("createViewModel, sort", () => {
  it("orders by one key, empty cells last in both directions", () => {
    expect(
      ids(model({ sort: [{ column: "qty", dir: "asc" }] }).compute(rows))
    ).toEqual(["d", "f", "a", "c", "e", "b"])
    expect(
      ids(model({ sort: [{ column: "qty", dir: "desc" }] }).compute(rows))
    ).toEqual(["e", "a", "c", "d", "f", "b"])
  })

  it("breaks ties with the next key, then the source order", () => {
    const view: SheetView = {
      sort: [
        { column: "qty", dir: "asc" },
        { column: "name", dir: "desc" },
      ],
    }
    expect(ids(model(view).compute(rows))).toEqual([
      "f",
      "d",
      "a",
      "c",
      "e",
      "b",
    ])
  })

  it("orders text as words and a select by its options", () => {
    expect(
      ids(model({ sort: [{ column: "name", dir: "asc" }] }).compute(rows))
    ).toEqual(["f", "b", "e", "c", "a", "d"])
    expect(
      ids(model({ sort: [{ column: "status", dir: "asc" }] }).compute(rows))
    ).toEqual(["b", "d", "c", "a", "f", "e"])
  })

  it("orders many distinct texts exactly as the collator does", () => {
    const part = fc.constantFrom(
      ...["a", "A", "á", "Z", "z", "é", "E", "1", "10", "-", " ", "_", "ö"],
      ...["aa", "å", "Ab", "ab", "B2", "b10", "'", ".", "ǆ", "ss", "ß"]
    )
    const text = fc.array(part, { minLength: 0, maxLength: 4 })
    const collator = new Intl.Collator()
    fc.assert(
      fc.property(
        fc.array(text, { minLength: 1100, maxLength: 1400 }),
        fc.constantFrom<"asc" | "desc">("asc", "desc"),
        (texts, dir) => {
          const many: Item[] = texts.map((parts, i) => ({
            id: `m${i}`,
            name: i % 53 === 0 ? null : `${parts.join("")}${i % 600}`,
            qty: null,
            due: null,
            status: null,
          }))
          const filled = many
            .map((r) => r.name)
            .filter((n): n is string => n !== null)
          const expected = [...new Set(filled)].sort((a, b) =>
            dir === "asc" ? collator.compare(a, b) : collator.compare(b, a)
          )
          const got = model({ sort: [{ column: "name", dir }] }).compute(
            many
          ).rows
          const names = got.map((r) => r.name)
          expect(names.slice(filled.length)).toEqual(
            names.slice(filled.length).map(() => null)
          )
          const order = names.slice(0, filled.length) as string[]
          const seen = [...new Set(order)]
          expect(seen.length).toBe(expected.length)
          for (let i = 1; i < order.length; i++) {
            const c = collator.compare(
              order[i - 1] as string,
              order[i] as string
            )
            expect(dir === "asc" ? c <= 0 : c >= 0).toBe(true)
          }
        }
      ),
      { numRuns: 15 }
    )
  })
})

describe("createViewModel, group", () => {
  it("groups by a value with counts, empty last, rows sorted inside", () => {
    const result = model({
      group: { column: "status" },
      sort: [{ column: "qty", dir: "desc" }],
    }).compute(rows)
    expect(ids(result)).toEqual(["d", "b", "c", "a", "f", "e"])
    expect(result.groups).toEqual([
      { value: "open", label: "Open", start: 0, size: 2 },
      { value: "review", label: "Needs review", start: 2, size: 1 },
      { value: "shut", label: "Closed", start: 3, size: 2 },
      { value: null, label: "", start: 5, size: 1 },
    ])
  })

  it("groups dates by month or year", () => {
    const byMonth = model({ group: { column: "due", by: "month" } }).compute(
      rows
    )
    expect(byMonth.groups?.map((g) => [g.label, g.size])).toEqual([
      ["2026-09", 2],
      ["2026-10", 3],
      ["", 1],
    ])
    const byYear = model({ group: { column: "due", by: "year" } }).compute(rows)
    expect(byYear.groups?.map((g) => [g.value, g.size])).toEqual([
      ["2026", 5],
      [null, 1],
    ])
  })

  it("orders groups the way a sort on the same column goes", () => {
    const result = model({
      group: { column: "status" },
      sort: [{ column: "status", dir: "desc" }],
    }).compute(rows)
    expect(result.groups?.map((g) => g.value)).toEqual([
      "shut",
      "review",
      "open",
      null,
    ])
  })
})

describe("createViewModel, results", () => {
  it("hands back the rows themselves when the view changes nothing", () => {
    const m = model({ hidden: ["qty"] })
    expect(m.active).toBe(false)
    const result = m.compute(rows)
    expect(result.rows).toBe(rows)
    expect(result.indexOf("c")).toBe(2)
    expect(result.sourceIndex(4)).toBe(4)
  })

  it("gives the same result for the same rows", () => {
    const m = model({ sort: [{ column: "qty", dir: "asc" }] })
    expect(m.compute(rows)).toBe(m.compute(rows))
  })

  it("maps positions both ways", () => {
    const result = model({
      filter: {
        match: "all",
        items: [{ column: "qty", op: "lessThan", values: ["5"] }],
      },
      sort: [{ column: "name", dir: "asc" }],
    }).compute(rows)
    expect(ids(result)).toEqual(["f", "c", "a", "d"])
    expect(result.indexOf("a")).toBe(2)
    expect(result.indexOf("e")).toBe(-1)
    expect(result.indexOf("nope")).toBe(-1)
    expect(result.sourceIndex(0)).toBe(5)
  })

  it("skips sort keys and groups on unknown columns", () => {
    const m = model({
      sort: [
        { column: "gone", dir: "asc" },
        { column: "qty", dir: "asc" },
      ],
      group: { column: "away" },
    })
    expect(m.issues).toEqual([
      { part: "sort", path: [0], message: 'There is no column "gone"' },
      { part: "group", path: [], message: 'There is no column "away"' },
    ])
    expect(m.compute(rows).groups).toBeNull()
    expect(ids(m.compute(rows))).toEqual(["d", "f", "a", "c", "e", "b"])
  })
})

// Property: after any run of edits, the result a model updates in place is
// the one a new model works out from the same rows.
describe("createViewModel, one-row updates", () => {
  const views: SheetView[] = [
    {
      filter: {
        match: "all",
        items: [{ column: "qty", op: "lessThan", values: ["5"] }],
      },
    },
    {
      sort: [
        { column: "qty", dir: "desc" },
        { column: "name", dir: "asc" },
      ],
    },
    {
      filter: {
        match: "any",
        items: [{ column: "name", op: "contains", values: ["a"] }],
      },
      sort: [{ column: "due", dir: "asc" }],
    },
    { group: { column: "status" }, sort: [{ column: "qty", dir: "asc" }] },
    {
      group: { column: "due", by: "month" },
      filter: {
        match: "all",
        items: [{ column: "status", op: "empty", values: [], not: true }],
      },
      sort: [{ column: "name", dir: "desc" }],
    },
  ]
  const edit = fc.oneof(
    fc.record({
      column: fc.constant("qty"),
      value: fc.constantFrom(null, 0, 1, 3, 5, 10),
    }),
    fc.record({
      column: fc.constant("name"),
      value: fc.constantFrom(null, "apple", "Banana", "kiwi", "pear"),
    }),
    fc.record({
      column: fc.constant("due"),
      value: fc.constantFrom(null, "2026-09-02", "2026-10-15", "2026-11-30"),
    }),
    fc.record({
      column: fc.constant("status"),
      value: fc.constantFrom(null, "open", "review", "shut"),
    })
  )
  const steps = fc.array(
    fc.array(fc.tuple(fc.nat({ max: 39 }), edit), {
      minLength: 1,
      maxLength: 4,
    }),
    { minLength: 1, maxLength: 12 }
  )

  it("match a fresh model", () => {
    fc.assert(
      fc.property(fc.constantFrom(...views), steps, (view, batches) => {
        const start: Item[] = Array.from({ length: 40 }, (_, i) => ({
          id: `r${i}`,
          name: ["apple", null, "fig", "Pear"][i % 4] as string | null,
          qty: i % 7 === 0 ? null : i % 6,
          due:
            i % 5 === 0
              ? null
              : `2026-${i % 2 ? "09" : "10"}-${String((i % 28) + 1).padStart(2, "0")}`,
          status: [null, "open", "review", "shut"][i % 4] as string | null,
        }))
        const store = createSheetStore<Item>({ rows: start, columns, getRowId })
        const live = model(view)
        live.compute(store.getRows())
        for (const batch of batches) {
          store.transaction("edit", (tx) => {
            for (const [row, { column, value }] of batch)
              tx.set(`r${row}`, column, value)
          })
          const now = store.getRows()
          const got = live.compute(now)
          const want = model(view).compute(now)
          expect(ids(got)).toEqual(ids(want))
          expect(got.groups).toEqual(want.groups)
          for (let p = 0; p < got.rows.length; p++) {
            expect(got.sourceIndex(p)).toBe(want.sourceIndex(p))
          }
        }
      }),
      { numRuns: 200 }
    )
  })

  it("follows inserts and removes by working them out afresh", () => {
    const store = createSheetStore<Item>({ rows, columns, getRowId })
    const live = model({ sort: [{ column: "qty", dir: "asc" }] })
    live.compute(store.getRows())
    store.transaction("insert", (tx) =>
      tx.insert(0, [{ id: "n", name: "new", qty: 2, due: null, status: null }])
    )
    expect(ids(live.compute(store.getRows()))).toEqual([
      "d",
      "f",
      "n",
      "a",
      "c",
      "e",
      "b",
    ])
    store.transaction("remove", (tx) => tx.remove(["d", "e"]))
    expect(ids(live.compute(store.getRows()))).toEqual([
      "f",
      "n",
      "a",
      "c",
      "b",
    ])
  })
})

describe("viewsEqual", () => {
  const base: SheetView = {
    filter: {
      match: "all",
      items: [
        { column: "status", op: "isAnyOf", values: ["review"] },
        {
          match: "any",
          items: [
            { column: "qty", op: "lessThan", values: ["0.6"] },
            { column: "name", op: "empty", values: [] },
          ],
        },
      ],
    },
    sort: [{ column: "qty", dir: "asc" }],
    group: { column: "due", by: "month" },
    hidden: ["a", "b"],
  }

  it("is true for the same view and its JSON copy", () => {
    expect(
      viewsEqual(base, JSON.parse(JSON.stringify(base)) as SheetView)
    ).toBe(true)
  })

  it("treats missing parts as empty ones", () => {
    expect(
      viewsEqual(
        {},
        { filter: { match: "any", items: [] }, sort: [], hidden: [] }
      )
    ).toBe(true)
    expect(
      viewsEqual(
        { group: { column: "due" } },
        { group: { column: "due", by: "day" } }
      )
    ).toBe(true)
    expect(
      viewsEqual(
        {
          filter: {
            match: "all",
            items: [{ column: "a", op: "is", values: ["x"], not: false }],
          },
        },
        {
          filter: {
            match: "all",
            items: [{ column: "a", op: "is", values: ["x"] }],
          },
        }
      )
    ).toBe(true)
    expect(viewsEqual({ hidden: ["b", "a"] }, { hidden: ["a", "b"] })).toBe(
      true
    )
  })

  it("is false when anything shown differs", () => {
    const edits: SheetView[] = [
      { ...base, sort: [{ column: "qty", dir: "desc" }] },
      { ...base, group: { column: "due", by: "year" } },
      { ...base, hidden: ["a"] },
      { ...base, filter: { ...base.filter!, match: "any" } },
      {
        ...base,
        filter: {
          match: "all",
          items: [
            { column: "status", op: "isAnyOf", values: ["review"], not: true },
          ],
        },
      },
    ]
    for (const edited of edits) expect(viewsEqual(base, edited)).toBe(false)
  })
})
