// @vitest-environment jsdom
import { defineColumns } from "@sheetcn/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  rangeForTargets,
  targetOfElement,
  useSheet,
  useSheetPointer,
  type PointerTarget,
} from "../src/index.js"
import { inAct, renderHook } from "./render.js"

type Item = { id: string; a: number | null; b: number | null; c: number | null }
const columns = defineColumns<Item>((c) => [
  c.number("a"),
  c.number("b"),
  c.number("c"),
])
const rows: Item[] = Array.from({ length: 10 }, (_, i) => ({
  id: `r${i}`,
  a: i,
  b: i,
  c: i,
}))

const at = (rowIndex: number, columnIndex: number) => ({
  rowIndex,
  columnIndex,
})
const cell = (r: number, c: number): PointerTarget => ({
  type: "cell",
  rowIndex: r,
  columnIndex: c,
})
const size = { rowCount: 10, columnCount: 3 }

describe("rangeForTargets", () => {
  it("drags from cell to cell", () => {
    expect(rangeForTargets(cell(2, 1), cell(5, 0), size)).toEqual({
      anchor: at(2, 1),
      focus: at(5, 0),
    })
  })

  it("keeps the given anchor (Shift)", () => {
    expect(rangeForTargets(cell(2, 1), cell(2, 1), size, at(7, 2))).toEqual({
      anchor: at(7, 2),
      focus: at(2, 1),
    })
  })

  it("selects whole rows and columns from headers", () => {
    const row = { type: "rowHeader", rowIndex: 3 } as const
    expect(
      rangeForTargets(row, { type: "rowHeader", rowIndex: 5 }, size)
    ).toEqual({ anchor: at(3, 0), focus: at(5, 2) })
    // Dragging from a row header over cells follows their rows.
    expect(rangeForTargets(row, cell(1, 2), size)).toEqual({
      anchor: at(3, 0),
      focus: at(1, 2),
    })
    const column = { type: "columnHeader", columnIndex: 1 } as const
    expect(rangeForTargets(column, column, size)).toEqual({
      anchor: at(0, 1),
      focus: at(9, 1),
    })
    expect(rangeForTargets({ type: "corner" }, cell(0, 0), size)).toEqual({
      anchor: at(0, 0),
      focus: at(9, 2),
    })
  })
})

describe("targetOfElement", () => {
  it("reads targets from data attributes", () => {
    document.body.innerHTML = `
      <div data-row-position="4"><div data-column-index="2"><span id="in-cell"></span></div></div>
      <div data-row-index="7" id="row-header"></div>
      <div data-column-index="1" id="column-header"></div>
      <div data-sheet-corner id="corner"></div>
      <div id="outside"></div>`
    const el = (id: string) => document.getElementById(id)
    expect(targetOfElement(el("in-cell"))).toEqual(cell(4, 2))
    expect(targetOfElement(el("row-header"))).toEqual({
      type: "rowHeader",
      rowIndex: 7,
    })
    expect(targetOfElement(el("column-header"))).toEqual({
      type: "columnHeader",
      columnIndex: 1,
    })
    expect(targetOfElement(el("corner"))).toEqual({ type: "corner" })
    expect(targetOfElement(el("outside"))).toBeNull()
  })
})

// A grid of 10 by 3 cells, each 10 by 10 pixels, at the viewport origin.
function setup() {
  const scroller = document.createElement("div")
  Object.defineProperties(scroller, {
    clientWidth: { value: 30 },
    clientHeight: { value: 100 },
  })
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 30, 100)
  scroller.scrollBy = vi.fn()
  scroller.tabIndex = -1
  document.body.replaceChildren(scroller)
  const hitTest = (x: number, y: number) =>
    cell(Math.floor(y / 10), Math.floor(x / 10))
  const r = renderHook(() => {
    const sheet = useSheet({
      columns,
      getRowId: (row: Item) => row.id,
      defaultData: rows,
    })
    return { sheet, ...useSheetPointer(sheet, { hitTest }) }
  }, undefined)
  const down = (
    x: number,
    y: number,
    init: Partial<{
      button: number
      pointerType: string
      shiftKey: boolean
      ctrlKey: boolean
      target: EventTarget
    }> = {}
  ) =>
    inAct(() =>
      r.result.current.onPointerDown({
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        target: scroller,
        currentTarget: scroller,
        ...init,
      })
    )
  const fire = (type: string, x: number, y: number) =>
    inAct(() => {
      const e = new Event(type)
      Object.assign(e, { clientX: x, clientY: y, pointerId: 1 })
      window.dispatchEvent(e)
    })
  const mouseDown = (target: EventTarget) => {
    const preventDefault = vi.fn()
    inAct(() =>
      r.result.current.onMouseDown({
        target,
        currentTarget: scroller,
        preventDefault,
      })
    )
    return preventDefault
  }
  const active = () => r.result.current.sheet.getActiveRange()
  const ranges = () => r.result.current.sheet.getSelection()
  return { ...r, down, fire, mouseDown, active, ranges, scroller }
}

describe("useSheetPointer", () => {
  // The edge auto-scroll loop never runs a frame here.
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1)
    vi.stubGlobal("cancelAnimationFrame", () => undefined)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("selects on press and extends while dragging", () => {
    const p = setup()
    p.down(15, 25)
    expect(p.active()).toEqual({ anchor: at(2, 1), focus: at(2, 1) })
    p.fire("pointermove", 25, 55)
    expect(p.active()).toEqual({ anchor: at(2, 1), focus: at(5, 2) })
    // Past the bottom edge: the drag stops at the last visible row.
    p.fire("pointermove", 25, 400)
    expect(p.active()).toEqual({ anchor: at(2, 1), focus: at(9, 2) })
    p.fire("pointerup", 25, 400)
    p.fire("pointermove", 5, 5)
    expect(p.active()).toEqual({ anchor: at(2, 1), focus: at(9, 2) })
  })

  it("extends with Shift and adds or removes ranges with Ctrl", () => {
    const p = setup()
    p.down(5, 5)
    p.fire("pointerup", 5, 5)
    p.down(25, 35, { shiftKey: true })
    p.fire("pointerup", 25, 35)
    expect(p.active()).toEqual({ anchor: at(0, 0), focus: at(3, 2) })
    p.down(5, 85, { ctrlKey: true })
    p.fire("pointerup", 5, 85)
    expect(p.ranges()).toHaveLength(2)
    // Ctrl on a selected cell removes it.
    p.down(15, 15, { ctrlKey: true })
    p.fire("pointerup", 15, 15)
    expect(p.ranges().at(-1)?.operation).toBe("exclude")
    expect(p.result.current.sheet.isSelected(at(1, 1))).toBe(false)
    expect(p.result.current.sheet.isSelected(at(1, 0))).toBe(true)
  })

  it("ignores buttons other than the primary one", () => {
    const p = setup()
    p.down(25, 55, { button: 2 })
    expect(p.active()).toEqual({ anchor: at(0, 0), focus: at(0, 0) })
  })

  it("selects on a touch tap, and not when the touch scrolls", () => {
    const p = setup()
    p.down(25, 55, { pointerType: "touch" })
    expect(p.active()).toEqual({ anchor: at(0, 0), focus: at(0, 0) })
    p.fire("pointerup", 26, 56)
    expect(p.active()).toEqual({ anchor: at(5, 2), focus: at(5, 2) })

    p.down(5, 5, { pointerType: "touch" })
    p.fire("pointerup", 5, 60)
    expect(p.active()).toEqual({ anchor: at(5, 2), focus: at(5, 2) })
    p.down(5, 5, { pointerType: "touch" })
    p.fire("pointercancel", 5, 5)
    expect(p.active()).toEqual({ anchor: at(5, 2), focus: at(5, 2) })
  })

  it("keeps DOM focus on the active cell after a press, not on what was pressed", () => {
    const p = setup()
    const header = document.createElement("div")
    const cellElement = document.createElement("div")
    cellElement.dataset.columnIndex = "2"
    cellElement.tabIndex = -1
    const rowElement = document.createElement("div")
    rowElement.dataset.rowPosition = "5"
    rowElement.append(cellElement)
    p.scroller.append(header, rowElement)
    p.down(25, 55)
    const prevented = p.mouseDown(header)
    expect(prevented).toHaveBeenCalled()
    expect(document.activeElement).toBe(cellElement)
    // The active cell is not rendered: the grid itself takes focus.
    p.down(5, 5)
    p.mouseDown(header)
    expect(document.activeElement).toBe(p.scroller)
  })

  it("leaves presses inside a form control (the editor) to the control", () => {
    const p = setup()
    const { sheet } = p.result.current
    const input = document.createElement("input")
    p.scroller.append(input)
    inAct(() => sheet.startEdit("replace", "oops"))
    p.down(25, 55, { target: input })
    expect(sheet.getState().editing?.error).toBeNull()
    expect(p.mouseDown(input)).not.toHaveBeenCalled()
  })

  it("commits an open editor first, and stays when the draft does not parse", () => {
    const p = setup()
    const { sheet } = p.result.current
    inAct(() => sheet.startEdit("replace", "oops"))
    p.down(25, 55)
    expect(sheet.getState().editing?.error).toBe('"oops" is not a number')
    expect(p.active()).toEqual({ anchor: at(0, 0), focus: at(0, 0) })
    inAct(() => sheet.setDraft("42"))
    p.down(25, 55)
    expect(sheet.store.getValue("r0", "a")).toBe(42)
    expect(p.active()).toEqual({ anchor: at(5, 2), focus: at(5, 2) })
  })

  it("never reads the selected cells or uses TanStack's mouse handlers", () => {
    // These build a Cell per selected cell (hundreds of MB at millions of
    // cells) or duplicate what the binding does.
    const p = setup()
    const { sheet } = p.result.current
    const table = sheet.table as unknown as Record<string, unknown>
    const cellProto = Object.getPrototypeOf(
      sheet.table.getRowModel().rows[0]!.getAllCells()[0]!
    ) as Record<string, unknown>
    const targets: [Record<string, unknown>, string][] = [
      [table, "getSelectedCellRangesData"],
      [table, "getSelectedCellIds"],
      [cellProto, "getSelectionStartHandler"],
      [cellProto, "getSelectionExtendHandler"],
    ]
    const spies = targets.map(([object, name]) => {
      expect(typeof object[name]).toBe("function")
      return vi.spyOn(object as Record<string, () => unknown>, name)
    })
    p.down(5, 5)
    p.fire("pointermove", 25, 55)
    p.fire("pointerup", 25, 55)
    p.down(15, 15, { ctrlKey: true })
    p.fire("pointerup", 15, 15)
    const keys = (k: string, mods = {}) =>
      inAct(() => {
        sheet.handleKeyDown(
          {
            key: k,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            ...mods,
            preventDefault: () => undefined,
          },
          { pageRows: 3, pageColumns: 2 }
        )
      })
    keys("ArrowDown", { shiftKey: true })
    keys("a", { ctrlKey: true })
    keys("Escape")
    keys("Delete")
    inAct(() => sheet.select({ anchor: at(0, 0), focus: at(9, 2) }))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})
