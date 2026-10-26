import { describe, expect, it } from "vitest"

import {
  applyChange,
  createSheetStore,
  defineColumns,
  type Change,
  type SheetStoreOptions,
} from "../src/index.js"

type R = { id: string; a: number | null; b: string | null }

const columns = defineColumns<R>((c) => [
  c.number("a"),
  c.text("b"),
  c.text("label", { value: (r) => `${r.id}:${r.b ?? ""}` }),
])
const getRowId = (r: R) => r.id
const make = (n: number): R[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, a: i, b: null }))
const ids = (rows: readonly R[]) => rows.map((r) => r.id)

function setup(rows: R[], options: Partial<SheetStoreOptions<R>> = {}) {
  const changes: Change<R>[] = []
  let notified = 0
  let clock = 0
  const store = createSheetStore<R>({
    rows,
    columns,
    getRowId,
    onChange: (change) => changes.push(change),
    now: () => clock,
    ...options,
  })
  store.subscribe(() => notified++)
  return {
    store,
    changes,
    notified: () => notified,
    tick: (ms: number) => (clock += ms),
  }
}

describe("transaction", () => {
  it("commits one change with from values, one onChange and one notify", () => {
    const input = make(3)
    const { store, changes, notified } = setup(input)
    const change = store.transaction("paste", (tx) => {
      tx.set("r0", "a", 10)
      tx.set("r1", "b", "x")
    })
    expect(change).toEqual({
      source: "paste",
      patches: [
        { rowId: "r0", columnId: "a", from: 0, to: 10 },
        { rowId: "r1", columnId: "b", from: null, to: "x" },
      ],
    })
    expect(changes).toEqual([change])
    expect(notified()).toBe(1)
    expect(store.getValue("r0", "a")).toBe(10)
    expect(store.getValue("r1", "label")).toBe("r1:x")
    expect(input[0]?.a).toBe(0)
    expect(store.getRows()[2]).toBe(input[2])
  })

  it("keeps one patch per cell and drops cells set to their current value", () => {
    const { store, changes } = setup(make(2))
    expect(
      store.transaction("edit", (tx) => {
        tx.set("r0", "a", 5)
        tx.set("r0", "a", 0)
        tx.set("r1", "a", 1)
      })
    ).toBeNull()
    const change = store.transaction("edit", (tx) => {
      tx.set("r0", "a", 5)
      tx.set("r0", "a", 6)
    })
    expect(change?.patches).toEqual([
      { rowId: "r0", columnId: "a", from: 0, to: 6 },
    ])
    expect(changes).toHaveLength(1)
  })

  it("inserts at a position, sets cells on new rows and removes rows", () => {
    const { store } = setup(make(4))
    const change = store.transaction("paste", (tx) => {
      tx.insert(1, [{ id: "n0", a: null, b: null }])
      tx.insert(4, [
        { id: "n1", a: null, b: null },
        { id: "n2", a: null, b: null },
      ])
      tx.insert(0, [{ id: "n3", a: null, b: null }])
      tx.set("n1", "a", 7)
      tx.remove(["r2", "r2"])
    })
    expect(ids(store.getRows())).toEqual([
      "n3",
      "r0",
      "n0",
      "r1",
      "r3",
      "n1",
      "n2",
    ])
    expect(change?.insertedRows?.map((r) => [r.index, r.row.id])).toEqual([
      [0, "n3"],
      [2, "n0"],
      [6, "n1"],
      [7, "n2"],
    ])
    expect(change?.patches).toEqual([
      { rowId: "n1", columnId: "a", from: null, to: 7 },
    ])
    expect(change?.removedRowIds).toEqual(["r2"])
    expect(store.indexOf("r3")).toBe(4)
    expect(store.indexOf("r2")).toBe(-1)
    expect(store.getValue("n1", "a")).toBe(7)
  })

  it("applies nothing when the build throws or names something unknown", () => {
    const input = make(2)
    const { store, changes, notified } = setup(input)
    const attempts: [string, () => void][] = [
      [
        "boom",
        () =>
          store.transaction("edit", (tx) => {
            tx.set("r0", "a", 1)
            throw new Error("boom")
          }),
      ],
      [
        'There is no row "x"',
        () => store.transaction("edit", (tx) => tx.set("x", "a", 1)),
      ],
      [
        'Column "label" is read-only',
        () => store.transaction("edit", (tx) => tx.set("r0", "label", "y")),
      ],
      [
        "Cannot insert at 3; there are 2 rows",
        () => store.transaction("insert", (tx) => tx.insert(3, [])),
      ],
      [
        'Two rows have the id "r1"',
        () =>
          store.transaction("insert", (tx) =>
            tx.insert(0, [{ id: "r1", a: 0, b: null }])
          ),
      ],
      [
        'There is no row "x"',
        () => store.transaction("remove", (tx) => tx.remove(["x"])),
      ],
    ]
    for (const [message, attempt] of attempts) {
      expect(attempt).toThrow(message)
    }
    expect(store.getRows()).toBe(input)
    expect(changes).toEqual([])
    expect(notified()).toBe(0)
    expect(store.getHistory()).toEqual({ canUndo: false, canRedo: false })
  })
})

describe("history", () => {
  it("records nothing when a write throws", () => {
    const strict = defineColumns<R>((c) => [
      c.number("a", {
        write: (r, v) => {
          if (v !== null && v < 0) throw new Error("No negatives")
          return { ...r, a: v }
        },
      }),
    ])
    const input = make(1)
    const { store, changes } = setup(input, { columns: strict })
    expect(() =>
      store.transaction("edit", (tx) => tx.set("r0", "a", -1))
    ).toThrow("No negatives")
    expect(store.getRows()).toBe(input)
    expect(store.getHistory().canUndo).toBe(false)
    expect(changes).toEqual([])
  })

  it("undoes and redoes every kind of step, with its source", () => {
    const input = make(3)
    const { store, changes } = setup(input, { mergeWindowMs: 0 })
    store.transaction("edit", (tx) => tx.set("r1", "b", "x"))
    store.transaction("insert", (tx) =>
      tx.insert(1, [{ id: "n0", a: null, b: null }])
    )
    store.transaction("remove", (tx) => tx.remove(["r0", "r2"]))
    const after = store.getRows()
    expect(ids(after)).toEqual(["n0", "r1"])

    store.undo()
    expect(ids(store.getRows())).toEqual(["r0", "n0", "r1", "r2"])
    store.undo()
    store.undo()
    expect(store.getRows()).toEqual(input)
    expect(store.undo()).toBeNull()
    expect(store.getHistory()).toEqual({ canUndo: false, canRedo: true })

    store.redo()
    store.redo()
    store.redo()
    expect(store.getRows()).toEqual(after)
    expect(store.redo()).toBeNull()
    expect(changes.map((c) => c.source)).toEqual([
      "edit",
      "insert",
      "remove",
      "undo",
      "undo",
      "undo",
      "redo",
      "redo",
      "redo",
    ])
  })

  it("brings a removed row back as it was, after patches in the same step", () => {
    const { store } = setup(make(3))
    store.transaction("cut", (tx) => {
      tx.set("r1", "b", "moved")
      tx.remove(["r1"])
    })
    const undo = store.undo()
    expect(undo?.insertedRows).toEqual([
      { index: 1, row: { id: "r1", a: 1, b: "moved" } },
    ])
    expect(store.getRows()[1]).toEqual({ id: "r1", a: 1, b: null })
  })

  it("clears redo on a new step and keeps at most historyLimit steps", () => {
    const { store } = setup(make(1), { historyLimit: 3, mergeWindowMs: 0 })
    for (let v = 1; v <= 5; v++)
      store.transaction("edit", (tx) => tx.set("r0", "a", v))
    store.undo()
    expect(store.getHistory()).toEqual({ canUndo: true, canRedo: true })
    store.transaction("edit", (tx) => tx.set("r0", "a", 9))
    expect(store.getHistory()).toEqual({ canUndo: true, canRedo: false })
    let undone = 0
    while (store.undo()) undone++
    // Kept: 2 to 3, 3 to 4, then 4 to 9 (the undone 4 to 5 is gone).
    expect(undone).toBe(3)
    expect(store.getValue("r0", "a")).toBe(2)
  })

  it("merges a typing burst on the same cells into one step", () => {
    const { store, changes, tick } = setup(make(2), { mergeWindowMs: 1000 })
    store.transaction("edit", (tx) => tx.set("r0", "b", "h"))
    tick(300)
    store.transaction("edit", (tx) => tx.set("r0", "b", "he"))
    tick(900)
    store.transaction("edit", (tx) => tx.set("r0", "b", "hey"))
    expect(changes).toHaveLength(3)
    store.undo()
    expect(store.getValue("r0", "b")).toBeNull()
    expect(store.getHistory().canUndo).toBe(false)
    store.redo()
    expect(store.getValue("r0", "b")).toBe("hey")
  })

  it("does not merge across a pause, other cells, other sources or an undo", () => {
    const { store, tick } = setup(make(2), { mergeWindowMs: 1000 })
    const steps = () => {
      let n = 0
      while (store.undo()) n++
      while (store.redo()) {
        /* replay */
      }
      return n
    }
    store.transaction("edit", (tx) => tx.set("r0", "a", 1))
    tick(1001)
    store.transaction("edit", (tx) => tx.set("r0", "a", 2))
    store.transaction("edit", (tx) => tx.set("r1", "a", 2))
    store.transaction("paste", (tx) => tx.set("r1", "a", 3))
    store.transaction("paste", (tx) => tx.set("r1", "a", 4))
    expect(steps()).toBe(5)
    store.undo()
    store.transaction("edit", (tx) => tx.set("r1", "a", 5))
    expect(steps()).toBe(5)
  })

  it("drops a burst that types the cell back to where it started", () => {
    const { store } = setup(make(1))
    store.transaction("edit", (tx) => tx.set("r0", "b", "x"))
    store.transaction("edit", (tx) => tx.set("r0", "b", null))
    expect(store.getHistory().canUndo).toBe(false)
  })

  it("clearHistory forgets every step", () => {
    const { store, notified } = setup(make(1))
    store.transaction("edit", (tx) => tx.set("r0", "a", 1))
    store.clearHistory()
    expect(store.getHistory()).toEqual({ canUndo: false, canRedo: false })
    expect(notified()).toBe(2)
  })

  it("keeps the history object stable until it changes", () => {
    const { store } = setup(make(2), { mergeWindowMs: 0 })
    const empty = store.getHistory()
    store.transaction("edit", (tx) => tx.set("r0", "a", 1))
    const one = store.getHistory()
    expect(one).not.toBe(empty)
    store.transaction("edit", (tx) => tx.set("r1", "a", 1))
    expect(store.getHistory()).toBe(one)
  })
})

describe("controlled mode", () => {
  it("leaves the rows to the app, which applies each change", () => {
    let data: readonly R[] = make(3)
    const store = createSheetStore<R>({
      rows: data,
      columns,
      getRowId,
      controlled: true,
      onChange: (change) => {
        data = applyChange(data, change, { columns, getRowId })
      },
    })
    const sync = () => store.setRows(data)

    store.transaction("edit", (tx) => tx.set("r0", "a", 10))
    expect(store.getValue("r0", "a")).toBe(0)
    expect(data[0]?.a).toBe(10)
    sync()
    expect(store.getValue("r0", "a")).toBe(10)

    store.transaction("insert", (tx) =>
      tx.insert(0, [{ id: "n0", a: null, b: null }])
    )
    sync()
    store.transaction("remove", (tx) => tx.remove(["r1"]))
    sync()
    expect(ids(data)).toEqual(["n0", "r0", "r2"])
    expect(store.indexOf("r2")).toBe(2)

    store.undo()
    sync()
    store.undo()
    sync()
    store.undo()
    sync()
    expect(data).toEqual(make(3))
    store.redo()
    sync()
    expect(store.getValue("r0", "a")).toBe(10)
  })

  it("keeps history when the app hands back rows", () => {
    const { store } = setup(make(1), { controlled: true })
    store.transaction("edit", (tx) => tx.set("r0", "a", 1))
    store.setRows([{ id: "r0", a: 1, b: null }])
    expect(store.getHistory().canUndo).toBe(true)
  })
})

describe("row index", () => {
  it("stays right through inserts and removes at any position", () => {
    const { store } = setup(make(50), { mergeWindowMs: 0 })
    let next = 0
    const check = () => {
      store.getRows().forEach((r, i) => {
        expect(store.indexOf(r.id)).toBe(i)
      })
    }
    for (const at of [0, 25, 50, 10, 3]) {
      store.transaction("insert", (tx) =>
        tx.insert(at, [{ id: `n${next++}`, a: null, b: null }])
      )
      check()
    }
    store.transaction("remove", (tx) => tx.remove(["r0", "n1", "r49"]))
    check()
    expect(store.indexOf("r0")).toBe(-1)
    while (store.undo()) check()
  })
})
