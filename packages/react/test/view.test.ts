// @vitest-environment jsdom
import { defineColumns, type KeyInput, type SheetView } from "@sheetcn/core"
import { describe, expect, it, vi } from "vitest"

import { useSheet, type Sheet, type UseSheetOptions } from "../src/index.js"
import { inAct, renderHook } from "./render.js"

type Item = {
  id: string
  name: string | null
  price: number | null
  done: boolean | null
}

const columns = defineColumns<Item>((c) => [
  c.text("name", { header: "Name" }),
  c.number("price", { header: "Price" }),
  c.boolean("done", { header: "Done" }),
])
const getRowId = (r: Item) => r.id

// r0 to r5, prices 50, 10, 40, 20, 60, 30; even rows done.
const make = (): Item[] =>
  [50, 10, 40, 20, 60, 30].map((price, i) => ({
    id: `r${i}`,
    name: `Item ${i}`,
    price,
    done: i % 2 === 0,
  }))

const under45: SheetView = {
  filter: {
    match: "all",
    items: [{ column: "price", op: "lessThan", values: ["45"] }],
  },
}
const byPrice: SheetView = { sort: [{ column: "price", dir: "asc" }] }

function press(key: string, mods: Partial<KeyInput> = {}) {
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
    preventDefault: vi.fn(),
  }
}

function setup(options: Partial<UseSheetOptions<Item>> = {}) {
  const r = renderHook((o: UseSheetOptions<Item>) => useSheet<Item>(o), {
    columns,
    getRowId,
    defaultData: make(),
    ...options,
  })
  const sheet = (): Sheet<Item> => r.result.current
  const key = (k: string, mods: Partial<KeyInput> = {}) =>
    inAct(() => {
      sheet().handleKeyDown(press(k, mods), { pageRows: 3, pageColumns: 2 })
    })
  const ids = () =>
    sheet()
      .getRows()
      .map((row) => row.id)
  const activeId = () => {
    const a = sheet().getActiveRange()
    return a
      ? [
          sheet().getRows()[a.anchor.rowIndex]?.id,
          sheet().getColumnIds()[a.anchor.columnIndex],
        ]
      : null
  }
  return { ...r, sheet, key, ids, activeId }
}

describe("a sheet's view", () => {
  it("shows the rows it filters and sorts, and counts all of them", () => {
    const { sheet, ids } = setup({ defaultView: { ...under45, ...byPrice } })
    expect(ids()).toEqual(["r1", "r3", "r5", "r2"])
    expect(sheet().getTotalRowCount()).toBe(6)
    expect(sheet().countRows(under45)).toBe(4)
    expect(sheet().countRows({})).toBe(6)
  })

  it("changes when set, and reports the change", () => {
    const onViewChange = vi.fn()
    const { sheet, ids } = setup({ onViewChange })
    expect(ids()).toHaveLength(6)
    inAct(() => sheet().setView(byPrice))
    expect(ids()).toEqual(["r1", "r3", "r5", "r2", "r0", "r4"])
    expect(onViewChange).toHaveBeenLastCalledWith(byPrice)
    inAct(() => sheet().setView((v) => ({ ...v, ...under45 })))
    expect(ids()).toEqual(["r1", "r3", "r5", "r2"])
    expect(sheet().getView()).toEqual({ ...byPrice, ...under45 })
  })

  it("follows a controlled view and never changes it", () => {
    const onViewChange = vi.fn()
    const { sheet, ids, rerender } = setup({ view: under45, onViewChange })
    expect(ids()).toEqual(["r1", "r2", "r3", "r5"])
    inAct(() => sheet().setView(byPrice))
    expect(onViewChange).toHaveBeenCalledWith(byPrice)
    expect(ids()).toEqual(["r1", "r2", "r3", "r5"])
    rerender({
      columns,
      getRowId,
      defaultData: make(),
      view: byPrice,
      onViewChange,
    })
    expect(ids()).toEqual(["r1", "r3", "r5", "r2", "r0", "r4"])
  })

  it("starts on the first row and column the view shows", () => {
    const { activeId } = setup({
      defaultView: { ...byPrice, hidden: ["name"] },
    })
    expect(activeId()).toEqual(["r1", "price"])
  })

  it("leaves hidden columns out of the layout and the keys", () => {
    const { sheet, key, activeId } = setup({
      defaultView: { hidden: ["price"] },
    })
    expect(sheet().getColumnIds()).toEqual(["name", "done"])
    key("ArrowRight")
    expect(activeId()).toEqual(["r0", "done"])
  })

  it("lists what cannot apply", () => {
    const { sheet } = setup({
      defaultView: { sort: [{ column: "gone", dir: "asc" }] },
    })
    expect(sheet().getViewIssues()).toEqual([
      { part: "sort", path: [0], message: 'There is no column "gone"' },
    ])
  })
})

describe("keys and selection over a view", () => {
  it("move over the rows shown", () => {
    const { key, activeId } = setup({ defaultView: under45 })
    expect(activeId()).toEqual(["r1", "name"])
    key("ArrowDown")
    expect(activeId()).toEqual(["r2", "name"])
    key("ArrowDown", { ctrlKey: true })
    expect(activeId()).toEqual(["r5", "name"])
  })

  it("Enter commits and moves to the row that was below, when the edit hides its row", () => {
    const { sheet, key, ids, activeId } = setup({ defaultView: under45 })
    key("ArrowRight")
    key("9")
    inAct(() => sheet().setDraft("99"))
    key("Enter")
    expect(ids()).toEqual(["r2", "r3", "r5"])
    expect(activeId()).toEqual(["r2", "price"])
  })

  it("Enter moves to the row that was below when the edit moves its row", () => {
    const { sheet, key, ids, activeId } = setup({ defaultView: byPrice })
    key("ArrowRight")
    key("9")
    inAct(() => sheet().setDraft("99"))
    key("Enter")
    expect(ids()).toEqual(["r3", "r5", "r2", "r0", "r4", "r1"])
    expect(activeId()).toEqual(["r3", "price"])
  })

  it("keeps the active cell in its place when a toggle hides its row", () => {
    const doneOnly: SheetView = {
      filter: {
        match: "all",
        items: [{ column: "done", op: "is", values: ["yes"] }],
      },
    }
    const { key, ids, activeId } = setup({ defaultView: doneOnly })
    expect(ids()).toEqual(["r0", "r2", "r4"])
    key("ArrowDown")
    key("ArrowRight")
    key("ArrowRight")
    key(" ")
    expect(ids()).toEqual(["r0", "r4"])
    expect(activeId()).toEqual(["r4", "done"])
  })

  it("moves the active cell to its place when the view hides its row", () => {
    const { sheet, key, activeId } = setup()
    key("ArrowDown")
    key("ArrowDown")
    key("ArrowDown")
    key("ArrowDown")
    expect(activeId()).toEqual(["r4", "name"])
    inAct(() => sheet().setView(under45))
    // Four rows are shown; the active cell goes to the last of them.
    expect(activeId()).toEqual(["r5", "name"])
  })

  it("rebuilds no TanStack row but the edited one", () => {
    const { sheet, key } = setup({ defaultView: byPrice })
    const before = new Set(sheet().getRows())
    key("x")
    key("Enter")
    const after = sheet().getRows()
    expect(after.filter((row) => !before.has(row))).toHaveLength(1)
  })

  it.each([
    ["sorted", byPrice],
    ["filtered and sorted", { ...under45, ...byPrice }],
  ])("lists the rows a view of a sheet shows as a fresh one would after each commit, %s", (_, view) => {
    const { sheet, ids } = setup({ defaultView: view })
    const price = sheet().columnIndexOf("price")
    // Edits that move a row up, down, out of the filter and back in.
    for (const [rowIndex, value] of [
      [0, "5"],
      [2, "99"],
      [0, "35"],
      [1, "1"],
      [0, "44"],
    ] as const) {
      inAct(() => {
        sheet().select({
          anchor: { rowIndex, columnIndex: price },
          focus: { rowIndex, columnIndex: price },
        })
        sheet().startEdit("replace", value)
        sheet().commitEdit(null)
      })
      const data = sheet().store.getRows()
      const fresh = data
        .filter((r) => !("filter" in view) || (r.price ?? Infinity) < 45)
        .toSorted((a, b) => (a.price ?? 0) - (b.price ?? 0))
        .map((r) => r.id)
      expect(ids()).toEqual(fresh)
      ids().forEach((id, position) => {
        expect(sheet().rowIndexOf(id)).toBe(position)
      })
    }
  })
})
