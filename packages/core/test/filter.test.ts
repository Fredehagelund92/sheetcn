import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  applyChange,
  builtInTypes,
  compileFilter,
  countRows,
  defineColumns,
  filterCell,
  getCellValue,
  isFilterGroup,
  type Column,
  type FilterCondition,
  type FilterGroup,
  type SheetView,
} from "../src/index.js"

type Item = {
  id: string
  name: string | null
  qty: number | null
  due: string | null
  done: boolean | null
  status: string | null
}

const columns: Column<Item>[] = defineColumns<Item>((c) => [
  c.text("name", { header: "Name" }),
  c.number("qty", { header: "Qty" }),
  c.date("due", { header: "Due" }),
  c.boolean("done", { header: "Done" }),
  c.select("status", {
    header: "Status",
    options: [
      { value: "open", label: "Open" },
      { value: "review", label: "Needs review" },
      { value: "shut", label: "Closed" },
    ],
  }),
])
const getRowId = (r: Item) => r.id

let next = 0
const item = (fields: Partial<Item>): Item => ({
  id: `r${next++}`,
  name: null,
  qty: null,
  due: null,
  done: null,
  status: null,
  ...fields,
})

const TODAY = "2026-10-27" // a Tuesday

const rows: Item[] = [
  item({
    name: "Café Nordic",
    qty: 3,
    due: "2026-10-27",
    done: true,
    status: "open",
  }),
  item({
    name: "Kestrel Harbor",
    qty: 12,
    due: "2026-10-21",
    done: false,
    status: "review",
  }),
  item({
    name: "kestrel",
    qty: 0.5,
    due: "2026-10-20",
    done: true,
    status: "shut",
  }),
  item({
    name: "Atlas",
    qty: null,
    due: "2026-11-02",
    done: null,
    status: null,
  }),
  item({ name: null, qty: 7, due: null, done: false, status: "review" }),
  item({
    name: "Zephyr",
    qty: -2,
    due: "2026-09-30",
    done: true,
    status: "open",
  }),
]

const names = (filter: FilterGroup) => {
  const compiled = compileFilter(filter, columns, { today: TODAY })
  const test = compiled.bind(rows)
  return rows.filter((r, i) => test(r, i)).map((r) => r.name)
}
const all = (...items: FilterGroup["items"]): FilterGroup => ({
  match: "all",
  items,
})
const any = (...items: FilterGroup["items"]): FilterGroup => ({
  match: "any",
  items,
})
const cond = (
  column: string,
  op: string,
  values: string[] = [],
  not?: boolean
): FilterCondition =>
  not ? { column, op, values, not } : { column, op, values }

describe("compileFilter, conditions", () => {
  it("matches text ignoring case and accents", () => {
    expect(names(all(cond("name", "contains", ["cafe"])))).toEqual([
      "Café Nordic",
    ])
    expect(names(all(cond("name", "contains", ["KESTREL"])))).toEqual([
      "Kestrel Harbor",
      "kestrel",
    ])
    expect(names(all(cond("name", "is", [" Kestrel "])))).toEqual(["kestrel"])
    expect(names(all(cond("name", "startsWith", ["kes"])))).toEqual([
      "Kestrel Harbor",
      "kestrel",
    ])
  })

  it("turns any filter around with not, which passes empty cells", () => {
    expect(names(all(cond("name", "contains", ["kestrel"], true)))).toEqual([
      "Café Nordic",
      "Atlas",
      null,
      "Zephyr",
    ])
    expect(names(all(cond("name", "empty", [], true)))).toHaveLength(5)
    expect(names(all(cond("qty", "equals", ["7"], true)))).not.toContain(null)
    expect(
      names(all(cond("status", "isAnyOf", ["Open", "shut"], true)))
    ).toEqual(["Kestrel Harbor", "Atlas", null])
  })

  it("reads number operands with the type's parse", () => {
    expect(names(all(cond("qty", "lessThan", ["1"])))).toEqual([
      "kestrel",
      "Zephyr",
    ])
    expect(names(all(cond("qty", "between", ["3", "12"])))).toEqual([
      "Café Nordic",
      "Kestrel Harbor",
      null,
    ])
    expect(names(all(cond("qty", "greaterThan", ["1,000.5"])))).toEqual([])
    expect(names(all(cond("qty", "empty")))).toEqual(["Atlas"])
  })

  it("matches dates absolutely and relative to today", () => {
    expect(names(all(cond("due", "inLast", ["7", "days"])))).toEqual([
      "Café Nordic",
      "Kestrel Harbor",
    ])
    expect(names(all(cond("due", "inLast", ["1", "month"])))).toEqual([
      "Café Nordic",
      "Kestrel Harbor",
      "kestrel",
      "Zephyr",
    ])
    expect(names(all(cond("due", "inNext", ["1", "week"])))).toEqual([
      "Café Nordic",
      "Atlas",
    ])
    expect(names(all(cond("due", "within", ["thisWeek"])))).toEqual([
      "Café Nordic",
    ])
    expect(names(all(cond("due", "within", ["lastWeek"])))).toEqual([
      "Kestrel Harbor",
      "kestrel",
    ])
    expect(names(all(cond("due", "within", ["lastMonth"])))).toEqual(["Zephyr"])
    expect(names(all(cond("due", "lessThan", ["today"])))).toEqual([
      "Kestrel Harbor",
      "kestrel",
      "Zephyr",
    ])
    expect(names(all(cond("due", "equals", ["2026-11-02"])))).toEqual(["Atlas"])
  })

  it("matches booleans and select options by label or value", () => {
    expect(names(all(cond("done", "is", ["no"])))).toEqual([
      "Kestrel Harbor",
      null,
    ])
    expect(
      names(all(cond("status", "isAnyOf", ["Needs review", "shut"])))
    ).toEqual(["Kestrel Harbor", "kestrel", null])
  })
})

describe("compileFilter, groups", () => {
  it("joins all and any, and nests", () => {
    // Needs review, and (under 10 or no name).
    const filter = all(
      cond("status", "isAnyOf", ["review"]),
      any(cond("qty", "lessThan", ["10"]), cond("name", "empty"))
    )
    expect(names(filter)).toEqual([null])
    expect(
      names(
        any(cond("name", "startsWith", ["z"]), cond("qty", "equals", ["3"]))
      )
    ).toEqual(["Café Nordic", "Zephyr"])
    const deep = all(any(all(any(cond("name", "is", ["atlas"])))))
    expect(names(deep)).toEqual(["Atlas"])
  })

  it("passes every row when nothing applies", () => {
    expect(names(all())).toHaveLength(rows.length)
    expect(names(any())).toHaveLength(rows.length)
    expect(names(all(any(), all()))).toHaveLength(rows.length)
    expect(compileFilter(undefined, columns).active).toBe(false)
    expect(compileFilter(all(any()), columns).active).toBe(false)
  })

  it("skips what cannot apply and says where", () => {
    const filter = all(
      cond("qty", "lessThan", ["10"]),
      cond("gone", "contains", ["x"]),
      any(
        cond("name", "between", ["a", "b"]),
        cond("qty", "greaterThan", ["lots"]),
        cond("qty", "between", ["1"]),
        cond("name", "contains", ["  "]),
        cond("status", "isAnyOf", ["Open", "Paused"])
      )
    )
    const compiled = compileFilter(filter, columns, { today: TODAY })
    expect(compiled.issues).toEqual([
      { part: "filter", path: [1], message: 'There is no column "gone"' },
      {
        part: "filter",
        path: [2, 0],
        message: 'Column "Name" (Text) has no filter "between"',
      },
      { part: "filter", path: [2, 1], message: '"lots" is not a number' },
      { part: "filter", path: [2, 2], message: "Two values are needed" },
      { part: "filter", path: [2, 3], message: "A value is needed" },
      {
        part: "filter",
        path: [2, 4],
        message: '"Paused" is not one of the options',
      },
    ])
    // Only the first condition applies; the empty "any" group drops out.
    expect(names(filter)).toEqual(names(all(cond("qty", "lessThan", ["10"]))))
  })

  it("rejects a today that is not a date", () => {
    expect(() =>
      compileFilter(all(), columns, { today: "27/10/2026" })
    ).toThrow('"27/10/2026" is not a date in YYYY-MM-DD form')
  })

  it("survives JSON", () => {
    const view: SheetView = {
      filter: all(
        cond("status", "isAnyOf", ["review"]),
        any(cond("qty", "lessThan", ["10"]), cond("name", "empty", [], true))
      ),
    }
    const copy = JSON.parse(JSON.stringify(view)) as SheetView
    expect(names(copy.filter as FilterGroup)).toEqual(
      names(view.filter as FilterGroup)
    )
  })
})

describe("countRows", () => {
  it("counts what a view's filter keeps", () => {
    const view: SheetView = {
      filter: all(cond("status", "isAnyOf", ["review"])),
      sort: [{ column: "qty", dir: "desc" }],
    }
    expect(countRows(rows, columns, view)).toBe(2)
    expect(countRows(rows, columns, {})).toBe(rows.length)
  })
})

describe("folded text kept with the rows", () => {
  const ctx = { columns, getRowId }
  const filter = all(cond("name", "contains", ["harbor"]))
  const count = (data: readonly Item[]) => {
    const test = compileFilter(filter, columns).bind(data)
    return data.filter((r, i) => test(r, i)).length
  }

  it("follows patches, inserts and removes", () => {
    const data = rows.slice()
    expect(count(data)).toBe(1)
    const patched = applyChange(
      data,
      {
        source: "edit",
        patches: [
          {
            rowId: data[0]!.id,
            columnId: "name",
            from: "Café Nordic",
            to: "Harbor Café",
          },
        ],
      },
      ctx
    )
    expect(count(patched)).toBe(2)
    // The array it branched from keeps its own answer.
    expect(count(data)).toBe(1)
    const inserted = applyChange(
      patched,
      {
        source: "insert",
        patches: [],
        insertedRows: [{ index: 0, row: item({ name: "harbor" }) }],
      },
      ctx
    )
    expect(count(inserted)).toBe(3)
    const removed = applyChange(
      inserted,
      { source: "remove", patches: [], removedRowIds: [inserted[1]!.id] },
      ctx
    )
    expect(count(removed)).toBe(2)
  })
})

// Property: a compiled tree agrees with running each condition on its own
// with filterCell, then joining the answers by hand.
describe("compileFilter, against filterCell", () => {
  const condition = fc.oneof(
    fc.record({
      column: fc.constant("name"),
      op: fc.constantFrom("contains", "is", "startsWith", "empty"),
      values: fc.constantFrom(["kes"], ["café"], ["atlas"], ["E"]),
      not: fc.boolean(),
    }),
    fc.record({
      column: fc.constant("qty"),
      op: fc.constantFrom("equals", "lessThan", "greaterThan", "empty"),
      values: fc.constantFrom(["3"], ["0.5"], ["10"], ["-2"]),
      not: fc.boolean(),
    }),
    fc.record({
      column: fc.constant("due"),
      op: fc.constantFrom("inLast", "inNext"),
      values: fc.constantFrom(["7", "days"], ["1", "months"], ["2", "weeks"]),
      not: fc.boolean(),
    }),
    fc.record({
      column: fc.constant("status"),
      op: fc.constant("isAnyOf"),
      values: fc.constantFrom(["open"], ["Closed", "review"]),
      not: fc.boolean(),
    })
  )
  const tree = fc.letrec((tie) => ({
    group: fc.record({
      match: fc.constantFrom("all" as const, "any" as const),
      items: fc.array(
        fc.oneof({ depthSize: "small" }, condition, tie("group")),
        {
          maxLength: 4,
        }
      ),
    }),
  })).group as fc.Arbitrary<FilterGroup>

  const byId = new Map(columns.map((c) => [c.id, c]))
  // undefined: nothing in it applies.
  const reference = (node: FilterGroup, row: Item): boolean | undefined => {
    const answers = node.items
      .map((child) => {
        if (isFilterGroup(child)) return reference(child, row)
        const column = byId.get(child.column) as Column<Item>
        const v = filterCell(
          column,
          child.op,
          getCellValue(column, row),
          child.values,
          {
            today: TODAY,
          }
        )
        return child.not ? !v : v
      })
      .filter((a) => a !== undefined)
    if (!answers.length) return undefined
    return node.match === "all" ? answers.every(Boolean) : answers.some(Boolean)
  }

  it("gives the same rows", () => {
    fc.assert(
      fc.property(tree, (filter) => {
        const test = compileFilter(filter, columns, { today: TODAY }).bind(rows)
        rows.forEach((row, i) => {
          expect(test(row, i)).toBe(reference(filter, row) ?? true)
        })
      }),
      { numRuns: 300 }
    )
  })
})

describe("built-in filters", () => {
  it("label the negations a menu lists", () => {
    const text = builtInTypes.find((d) => d.id === "text")
    expect(text?.filters?.map((f) => [f.label, f.notLabel])).toEqual([
      ["contains", "does not contain"],
      ["is", "is not"],
      ["starts with", "does not start with"],
      ["is empty", "is not empty"],
    ])
    const number = builtInTypes.find((d) => d.id === "number")
    expect(number?.filters?.map((f) => f.label)).toEqual([
      "is",
      "less than",
      "greater than",
      "between",
      "is empty",
    ])
    const date = builtInTypes.find((d) => d.id === "date")
    expect(date?.filters?.map((f) => f.label)).toEqual([
      "in the last",
      "in the next",
      "is within",
      "is",
      "before",
      "after",
      "between",
      "is empty",
    ])
  })
})
