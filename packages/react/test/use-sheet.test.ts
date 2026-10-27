// @vitest-environment jsdom
import {
  applyChange,
  builtInTypes,
  createTypeRegistry,
  defineColumnType,
  defineColumns,
  type CellRange,
  type Change,
  type KeyInput,
} from "@sheetcn/core"
import { describe, expect, it, vi } from "vitest"

import { useSheet, type Sheet, type UseSheetOptions } from "../src/index.js"
import { inAct, renderHook } from "./render.js"

type Item = {
  id: string
  name: string | null
  price: number | null
  done: boolean | null
  sku: string
}

const columns = defineColumns<Item>((c) => [
  c.text("name", { header: "Name" }),
  c.number("price", { header: "Price" }),
  c.boolean("done", { header: "Done" }),
  c.text("code", { header: "SKU", value: (r) => r.sku }),
])
const getRowId = (r: Item) => r.id

const make = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    name: `Item ${i}`,
    price: i * 10,
    done: false,
    sku: `S${i}`,
  }))

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

const viewport = { pageRows: 3, pageColumns: 2 }

function setup(options: Partial<UseSheetOptions<Item>> = {}, rows = make(5)) {
  const base: UseSheetOptions<Item> = options.data
    ? { columns, getRowId }
    : { columns, getRowId, defaultData: rows }
  const r = renderHook((o: UseSheetOptions<Item>) => useSheet<Item>(o), {
    ...base,
    ...options,
  })
  const sheet = () => r.result.current
  const key = (k: string, mods: Partial<KeyInput> = {}) => {
    const event = press(k, mods)
    let command = null as ReturnType<Sheet<Item>["handleKeyDown"]>
    inAct(() => {
      command = sheet().handleKeyDown(event, viewport)
    })
    return { command, event }
  }
  const active = () => sheet().getActiveRange()
  const value = (rowId: string, columnId: string) =>
    sheet().store.getValue(rowId, columnId)
  return { ...r, sheet, key, active, value }
}

const at = (rowIndex: number, columnIndex: number) => ({
  rowIndex,
  columnIndex,
})
const one = (r: number, c: number) => ({ anchor: at(r, c), focus: at(r, c) })

describe("useSheet", () => {
  it("returns one stable sheet and starts with the first cell active", () => {
    const { result, rerender, active } = setup()
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(active()).toEqual(one(0, 0))
    expect(first.getColumnIds()).toEqual(["name", "price", "done", "code"])
  })

  it("puts pinned columns first and starts on the first of them", () => {
    const pinned = defineColumns<Item>((c) => [
      c.text("name"),
      c.number("price", { pin: "start" }),
    ])
    const { sheet, active } = setup({ columns: pinned })
    expect(sheet().getColumnIds()).toEqual(["price", "name"])
    expect(active()).toEqual(one(0, 0))
  })

  it("does not re-render the host for selection changes", () => {
    const { result, key } = setup()
    const renders = result.renders
    key("ArrowDown")
    key("ArrowRight", { shiftKey: true })
    expect(result.renders).toBe(renders)
  })
})

describe("keyboard", () => {
  it("moves, extends, jumps and pages", () => {
    const { key, active } = setup({}, make(10))
    key("ArrowDown")
    expect(active()).toEqual(one(1, 0))
    key("ArrowRight", { shiftKey: true })
    expect(active()).toEqual({ anchor: at(1, 0), focus: at(1, 1) })
    key("PageDown")
    expect(active()).toEqual(one(4, 0))
    key("ArrowDown", { ctrlKey: true })
    expect(active()).toEqual(one(9, 0))
    key("Home", { ctrlKey: true })
    expect(active()).toEqual(one(0, 0))
    key("a", { metaKey: true })
    expect(active()).toEqual({ anchor: at(0, 0), focus: at(9, 3) })
    key("Escape")
    expect(active()).toEqual(one(0, 0))
  })

  it("jumps to the edge of the data, skipping blank cells", () => {
    const rows = make(8).map((r, i) => ({
      ...r,
      name: i === 3 ? null : r.name,
    }))
    const { key, active } = setup({}, rows)
    key("ArrowDown", { ctrlKey: true })
    expect(active()).toEqual(one(2, 0))
    key("ArrowDown", { ctrlKey: true })
    expect(active()).toEqual(one(4, 0))
  })

  it("prevents the default action of the keys it handles, and only those", () => {
    const { key } = setup()
    expect(key("ArrowDown").event.preventDefault).toHaveBeenCalled()
    const ignored = key("c", { ctrlKey: true })
    expect(ignored.command).toBeNull()
    expect(ignored.event.preventDefault).not.toHaveBeenCalled()
    const ime = key("Process")
    expect(ime.command).toMatchObject({ type: "startEdit", composing: true })
    expect(ime.event.preventDefault).not.toHaveBeenCalled()
  })
})

describe("editing", () => {
  it("Enter edits with the value kept, and Enter commits and moves down", () => {
    const { key, sheet, active, value } = setup()
    key("ArrowRight")
    key("Enter")
    expect(sheet().getState().editing).toMatchObject({
      rowId: "r0",
      columnId: "price",
      mode: "edit",
      draft: "0",
    })
    inAct(() => sheet().setDraft("12.5"))
    key("Enter")
    expect(value("r0", "price")).toBe(12.5)
    expect(sheet().getState().editing).toBeNull()
    expect(active()).toEqual(one(1, 1))
  })

  it("typing replaces the value, and arrows commit and move", () => {
    const { key, sheet, value, active } = setup()
    key("Z")
    expect(sheet().getState().editing).toMatchObject({
      mode: "replace",
      draft: "Z",
    })
    key("ArrowRight")
    expect(value("r0", "name")).toBe("Z")
    expect(active()).toEqual(one(0, 1))
  })

  it("keeps the editor open when the draft does not parse", () => {
    const { key, sheet, value } = setup()
    key("ArrowRight")
    key("x")
    key("Enter")
    expect(sheet().getState().editing).toMatchObject({
      draft: "x",
      error: '"x" is not a number',
    })
    expect(value("r0", "price")).toBe(0)
    inAct(() => sheet().setDraft("7"))
    expect(sheet().getState().editing?.error).toBeNull()
    key("Tab")
    expect(value("r0", "price")).toBe(7)
  })

  it("Escape cancels without writing", () => {
    const { key, sheet, value } = setup()
    key("Q")
    key("Escape")
    expect(sheet().getState().editing).toBeNull()
    expect(value("r0", "name")).toBe("Item 0")
  })

  it("toggles booleans instead of editing them", () => {
    const { key, sheet, value } = setup()
    key("ArrowRight")
    key("ArrowRight")
    key(" ")
    expect(value("r0", "done")).toBe(true)
    key("Enter")
    expect(value("r0", "done")).toBe(false)
    expect(sheet().getState().editing).toBeNull()
  })

  it("ignores typing and composition on a boolean cell", () => {
    const { key, sheet, value } = setup()
    key("ArrowRight")
    key("ArrowRight")
    for (const k of ["a", "7", "Dead", "Process"]) {
      const { command, event } = key(k)
      expect(command).toEqual({ type: "ignore" })
      expect(event.preventDefault).toHaveBeenCalled()
      expect(value("r0", "done")).toBe(false)
      expect(sheet().getState().editing).toBeNull()
    }
    key(" ")
    expect(value("r0", "done")).toBe(true)
    key("Enter")
    expect(value("r0", "done")).toBe(false)
  })

  it("refuses read-only cells with a notice", () => {
    const { key, sheet } = setup()
    key("End")
    key("Enter")
    expect(sheet().getState().editing).toBeNull()
    expect(sheet().getState().notice).toBe("SKU is read-only")
  })
})

describe("a registry's types", () => {
  // A type whose cells are not edited in place, and a toggle of its own.
  const stamp = defineColumnType({
    id: "stamp",
    label: "Stamp",
    defaultOptions: {},
    parse: (text) => ({ ok: true, value: text || null }),
    format: (value: string) => value,
    edit: "none",
  })
  const flag = defineColumnType({
    id: "flag",
    label: "Flag",
    defaultOptions: {},
    parse: (text) => ({ ok: true, value: text === "on" }),
    format: (value: boolean) => (value ? "on" : "off"),
    edit: "toggle",
  })
  const types = createTypeRegistry([...builtInTypes, stamp, flag])
  const typed = types.defineColumns<Item>((c) => [
    c.stamp("name"),
    c.flag("done"),
  ])

  it("open no editor on a cell that is not edited in place", () => {
    const { key, sheet, value } = setup({ columns: typed, types })
    for (const k of ["Enter", "a", " "]) {
      expect(key(k).command).toEqual({ type: "ignore" })
    }
    expect(sheet().startEdit()).toBe(false)
    expect(sheet().getState().editing).toBeNull()
    key("Delete")
    expect(value("r0", "name")).toBeNull()
  })

  it("toggle a toggle type of their own", () => {
    const { key, value } = setup({ columns: typed, types })
    key("ArrowRight")
    key(" ")
    expect(value("r0", "done")).toBe(true)
  })

  it("must include the columns' types", () => {
    expect(() => setup({ columns: typed })).toThrow(
      'Column "name" has the type "stamp", which this sheet\'s types do not include'
    )
  })
})

describe("clear, undo and redo", () => {
  it("clears writable cells in one step and undo selects them again", () => {
    const { key, value, active, sheet } = setup()
    key("ArrowDown", { shiftKey: true })
    key("End", { shiftKey: true })
    key("Delete")
    expect(value("r0", "name")).toBeNull()
    expect(value("r1", "price")).toBeNull()
    expect(value("r1", "code")).toBe("S1")
    expect(sheet().getState().notice).toBe("Skipped 2 read-only cells")
    key("ArrowDown", { ctrlKey: true })
    key("z", { ctrlKey: true })
    expect(value("r0", "name")).toBe("Item 0")
    expect(active()).toEqual({ anchor: at(0, 0), focus: at(1, 2) })
    key("z", { ctrlKey: true, shiftKey: true })
    expect(value("r0", "name")).toBeNull()
  })
})

describe("select", () => {
  it("takes a range by ids or by position, and combines ranges by mode", () => {
    const { sheet, active } = setup()
    inAct(() =>
      sheet().select({
        anchorRowId: "r1",
        anchorColumnId: "price",
        focusRowId: "r3",
        focusColumnId: "done",
      })
    )
    expect(active()).toEqual({ anchor: at(1, 1), focus: at(3, 2) })
    inAct(() => sheet().select(one(0, 0), "add"))
    expect(sheet().getSelection()).toHaveLength(2)
    inAct(() => sheet().select(one(2, 2), "exclude"))
    expect(sheet().isSelected(at(2, 2))).toBe(false)
    expect(sheet().isSelected(at(2, 1))).toBe(true)
    // A position outside the grid is ignored.
    inAct(() => sheet().select(one(99, 0)))
    expect(sheet().getSelection()).toHaveLength(3)
  })
})

describe("controlled data and selection", () => {
  it("never changes controlled rows; the app applies each change", () => {
    let data = make(3)
    const changes: Change<Item>[] = []
    const onChange = (change: Change<Item>) => {
      changes.push(change)
      data = applyChange(data, change, { columns, getRowId })
    }
    const r = setup({ data, onChange })
    const before = r.sheet().getRows()
    r.key("x")
    r.key("Enter")
    expect(changes).toHaveLength(1)
    // Not applied until the app renders the new rows.
    expect(r.sheet().getRows()).toBe(before)
    const renders = r.result.renders
    r.rerender({ columns, getRowId, data, onChange })
    expect(r.result.renders).toBe(renders + 1)
    expect(r.value("r0", "name")).toBe("x")
    expect(r.sheet().getRows()[0]?.original.name).toBe("x")
  })

  it("drops an edit whose row went away", () => {
    const onChange = vi.fn()
    const r = setup({ data: make(3), onChange })
    r.key("ArrowDown")
    r.key("x")
    r.rerender({
      columns,
      getRowId,
      data: make(3).filter((row) => row.id !== "r1"),
      onChange,
    })
    r.key("Enter")
    expect(r.sheet().getState().editing).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("reports selection changes and follows a controlled selection", () => {
    const seen: CellRange[][] = []
    const r = setup({ onSelectionChange: (ranges) => seen.push(ranges) })
    r.key("ArrowDown")
    expect(seen.at(-1)).toEqual([
      {
        anchorRowId: "r1",
        anchorColumnId: "name",
        focusRowId: "r1",
        focusColumnId: "name",
      },
    ])
    expect(r.active()).toEqual(one(1, 0))

    // Controlled: the selection moves only when the app passes it back.
    let selection: CellRange[] = [
      {
        anchorRowId: "r2",
        anchorColumnId: "price",
        focusRowId: "r2",
        focusColumnId: "price",
      },
    ]
    const onSelectionChange = (ranges: CellRange[]) => (selection = ranges)
    const props = () => ({
      columns,
      getRowId,
      defaultData: make(5),
      selection,
      onSelectionChange,
    })
    r.rerender(props())
    expect(r.active()).toEqual(one(2, 1))
    r.key("ArrowDown")
    expect(r.active()).toEqual(one(2, 1))
    r.rerender(props())
    expect(r.active()).toEqual(one(3, 1))
  })
})

describe("one-cell commits", () => {
  it("rebuild only the changed TanStack row", () => {
    const { key, sheet } = setup({}, make(50))
    const before = sheet().getRows().slice()
    key("x")
    key("Enter")
    const after = sheet().getRows()
    expect(after[0]).not.toBe(before[0])
    expect(after.slice(1).every((row, i) => row === before[i + 1])).toBe(true)
  })
})
