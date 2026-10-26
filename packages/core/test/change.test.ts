import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  applyChange,
  defineColumns,
  invertChange,
  type Change,
  type ChangeContext,
} from "../src/index.js"

type R = { id: string; a: number | null; b: string | null }

const ctx: ChangeContext<R> = {
  columns: defineColumns<R>((c) => [
    c.number("a"),
    c.text("b"),
    c.text("id", { value: (r) => r.id }),
  ]),
  getRowId: (r) => r.id,
}

const make = (n: number, prefix = "r"): R[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, a: i, b: null }))

/** The obvious, slow reading of a change, to compare against. */
function naive(rows: readonly R[], change: Change<R>): R[] {
  const next = rows.slice()
  for (const { index, row } of change.insertedRows ?? []) {
    next.splice(index, 0, row)
  }
  for (const p of change.patches) {
    const i = next.findIndex((r) => r.id === p.rowId)
    next[i] = { ...(next[i] as R), [p.columnId]: p.to }
  }
  const drop = new Set(change.removedRowIds)
  return next.filter((r) => !drop.has(r.id))
}

describe("applyChange", () => {
  it("copies only the patched rows and leaves the input untouched", () => {
    const rows = make(5)
    const next = applyChange(
      rows,
      {
        source: "edit",
        patches: [{ rowId: "r2", columnId: "a", from: 2, to: 20 }],
      },
      ctx
    )
    expect(next).not.toBe(rows)
    expect(next[2]).toEqual({ id: "r2", a: 20, b: null })
    expect(rows[2]).toEqual({ id: "r2", a: 2, b: null })
    for (const i of [0, 1, 3, 4]) expect(next[i]).toBe(rows[i])
  })

  it("inserts, then patches, then removes", () => {
    const rows = make(3)
    const change: Change<R> = {
      source: "paste",
      insertedRows: [
        { index: 0, row: { id: "n0", a: null, b: null } },
        { index: 2, row: { id: "n1", a: null, b: null } },
        { index: 5, row: { id: "n2", a: null, b: null } },
      ],
      patches: [
        { rowId: "n1", columnId: "b", from: null, to: "new" },
        { rowId: "r1", columnId: "a", from: 1, to: 10 },
        { rowId: "r2", columnId: "b", from: null, to: "gone" },
      ],
      removedRowIds: ["r2", "n0"],
    }
    const next = applyChange(rows, change, ctx)
    expect(next.map((r) => r.id)).toEqual(["r0", "n1", "r1", "n2"])
    expect(next).toEqual(naive(rows, change))
  })

  it("rejects unknown rows and columns, taken ids, bad indexes and read-only columns", () => {
    const rows = make(3)
    const patch = (rowId: string, columnId: string) => () =>
      applyChange(
        rows,
        { source: "edit", patches: [{ rowId, columnId, from: null, to: 1 }] },
        ctx
      )
    expect(patch("x", "a")).toThrow('There is no row "x"')
    expect(patch("r0", "x")).toThrow('There is no column "x"')
    expect(patch("r0", "id")).toThrow('Column "id" is read-only')

    const insert = (index: number, id: string) => () =>
      applyChange(
        rows,
        {
          source: "insert",
          patches: [],
          insertedRows: [{ index, row: { id, a: null, b: null } }],
        },
        ctx
      )
    expect(insert(1, "r0")).toThrow('Two rows have the id "r0"')
    expect(insert(4, "n")).toThrow("indexes must ascend")
    expect(insert(-1, "n")).toThrow("indexes must ascend")
    expect(() =>
      applyChange(
        rows,
        { source: "remove", patches: [], removedRowIds: ["x"] },
        ctx
      )
    ).toThrow('There is no row "x"')
  })

  it("rejects a write that changes the row id", () => {
    const columns = defineColumns<R>((c) => [
      c.text("b", { write: (r, v) => ({ ...r, id: v ?? "", b: v }) }),
    ])
    expect(() =>
      applyChange(
        make(1),
        {
          source: "edit",
          patches: [{ rowId: "r0", columnId: "b", from: null, to: "x" }],
        },
        { columns, getRowId: ctx.getRowId }
      )
    ).toThrow('Writing column "b" changed the id of row "r0"')
  })

  it("rejects duplicate ids in the rows", () => {
    const rows = [...make(2), { id: "r0", a: 9, b: null }]
    expect(() =>
      applyChange(
        rows,
        {
          source: "edit",
          patches: [{ rowId: "r1", columnId: "a", from: 1, to: 2 }],
        },
        ctx
      )
    ).toThrow('Two rows have the id "r0"')
  })
})

type Step = {
  inserts: { at: number; count: number }[]
  patches: { row: number; a: number }[]
  removes: number[]
}

const steps = fc.array(
  fc.record({
    inserts: fc.array(
      fc.record({ at: fc.nat(), count: fc.integer({ min: 1, max: 3 }) }),
      { maxLength: 3 }
    ),
    patches: fc.array(fc.record({ row: fc.nat(), a: fc.integer() }), {
      maxLength: 4,
    }),
    removes: fc.array(fc.nat(), { maxLength: 3 }),
  }),
  { minLength: 1, maxLength: 12 }
)

/** Turns random numbers into a valid change for the current rows. */
function toChange(
  rows: readonly R[],
  step: Step,
  serial: () => string
): Change<R> {
  const inserted: Change<R>["insertedRows"] = []
  const blocks = step.inserts
    .map(({ at, count }) => ({ at: at % (rows.length + 1), count }))
    .sort((x, y) => x.at - y.at)
  for (const { at, count } of blocks) {
    for (let k = 0; k < count; k++) {
      inserted.push({
        index: at + inserted.length,
        row: { id: serial(), a: null, b: null },
      })
    }
  }
  const after = naive(rows, {
    source: "insert",
    patches: [],
    insertedRows: inserted,
  })
  const ids = after.map((r) => r.id)
  const patches = ids.length
    ? step.patches.map(({ row, a }) => {
        const r = after[row % ids.length] as R
        return { rowId: r.id, columnId: "a", from: r.a, to: a }
      })
    : []
  const removed = ids.length
    ? [...new Set(step.removes.map((i) => ids[i % ids.length] as string))]
    : []
  const change: Change<R> = { source: "edit", patches }
  if (inserted.length) change.insertedRows = inserted
  if (removed.length) change.removedRowIds = removed
  return change
}

describe("applyChange and invertChange, on random changes", () => {
  it("match the obvious reading, and the inverse restores the rows", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), steps, (n, list) => {
        let serial = 0
        const nextId = () => `n${serial++}`
        let rows = make(n)
        for (const step of list) {
          const change = toChange(rows, step, nextId)
          const inverse = invertChange(rows, change, ctx)
          const next = applyChange(rows, change, ctx)
          expect(next).toEqual(naive(rows, change))
          // The index handed on to `next` must agree with a fresh one.
          const back = applyChange(next, inverse, ctx)
          expect(back).toEqual(rows)
          rows = next
        }
      })
    )
  })
})
