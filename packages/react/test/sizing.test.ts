// @vitest-environment jsdom
// Column sizing through useSheet: "fixed" and "fill", fit to content, and
// resizing a column that fill has grown.
import { defineColumns, type Column } from "@sheetcn/core"
import { describe, expect, it, vi } from "vitest"

import {
  useSheet,
  type ColumnMeasurer,
  type UseSheetOptions,
} from "../src/index.js"
import { inAct, renderHook } from "./render.js"

type Item = { id: string; name: string; price: number; note: string }

const columns = defineColumns<Item>((c) => [
  c.text("name", { header: "Name", width: 200, pin: "start" }),
  c.number("price", { header: "Price", width: 100 }),
  c.text("note", { header: "Note", width: 100, minWidth: 60, maxWidth: 300 }),
])
const getRowId = (r: Item) => r.id

const make = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    name: `Item ${i}`,
    price: i,
    note: "x".repeat(i % 7),
  }))

function setup(options: Partial<UseSheetOptions<Item>> = {}, rows = make(5)) {
  const r = renderHook((o: UseSheetOptions<Item>) => useSheet<Item>(o), {
    columns,
    getRowId,
    defaultData: rows,
    ...options,
  })
  const sheet = () => r.result.current
  const widths = () =>
    sheet()
      .getColumnIds()
      .map((id) => sheet().getColumnWidth(id))
  const available = (width: number) =>
    inAct(() => sheet().setAvailableWidth(width))
  return { ...r, sheet, widths, available }
}

/** Measures a cell as 10 px per character, and the header as 50 px. */
const byLength: ColumnMeasurer<Item> = (column, rows) =>
  Math.max(
    50,
    ...rows.map((row) => 10 * String(row[column.id as keyof Item]).length)
  )

describe("fixed sizing", () => {
  it("is the default, and keeps every column at its width", () => {
    const { sheet, widths, available } = setup()
    expect(sheet().sizing).toBe("fixed")
    available(1000)
    expect(widths()).toEqual([200, 100, 100])
  })

  it("does not re-render the host when the grid's width changes", () => {
    const { result, available } = setup()
    const renders = result.renders
    available(1000)
    available(1200)
    expect(result.renders).toBe(renders)
  })
})

describe("fill sizing", () => {
  it("shares the spare width among the unpinned columns", () => {
    const { widths, available } = setup({ sizing: "fill" })
    // 400 px of columns in 600 px: 200 spare, split 100 and 100.
    available(600)
    expect(widths()).toEqual([200, 200, 200])
  })

  it("keeps the widths, so the grid scrolls, when they do not fit", () => {
    const { widths, available } = setup({ sizing: "fill" })
    available(300)
    expect(widths()).toEqual([200, 100, 100])
  })

  it("re-renders the host when the grid's width changes", () => {
    const { result, available } = setup({ sizing: "fill" })
    const renders = result.renders
    available(800)
    expect(result.renders).toBe(renders + 1)
    available(800)
    expect(result.renders).toBe(renders + 1)
  })

  it("follows each column's grow weight and max width", () => {
    const weighted = defineColumns<Item>((c) => [
      c.text("name", { width: 100, grow: 0 }),
      c.number("price", { width: 100, grow: 1 }),
      c.text("note", { width: 100, grow: 1, maxWidth: 150 }),
    ])
    const { widths, available } = setup({ sizing: "fill", columns: weighted })
    available(500)
    expect(widths()).toEqual([100, 250, 150])
  })

  it("switches between modes on the next render", () => {
    const { widths, available, rerender } = setup({ sizing: "fill" })
    available(600)
    rerender({ columns, getRowId, defaultData: make(5), sizing: "fixed" })
    expect(widths()).toEqual([200, 100, 100])
  })
})

describe("fitColumn", () => {
  it("does nothing until the view sets a measurer", () => {
    const { sheet, widths } = setup()
    let fitted = true
    inAct(() => {
      fitted = sheet().fitColumn("price")
    })
    expect(fitted).toBe(false)
    expect(widths()).toEqual([200, 100, 100])
  })

  it("sizes the column to the widest content the measurer reports", () => {
    const { sheet, widths } = setup({}, make(10))
    const measure = vi.fn(byLength)
    sheet().setColumnMeasurer(measure)
    inAct(() => sheet().fitColumn("note"))
    // "xxxxxx" is the longest note: 60 px.
    expect(widths()).toEqual([200, 100, 60])
    const [column, rows] = measure.mock.calls[0] as [Column<Item>, Item[]]
    expect(column.id).toBe("note")
    expect(rows).toHaveLength(10)
  })

  it("keeps the fitted width within the column's min and max", () => {
    const { sheet, widths } = setup()
    sheet().setColumnMeasurer(() => 20)
    inAct(() => sheet().fitColumn("note"))
    expect(widths()[2]).toBe(60)
    sheet().setColumnMeasurer(() => 999.2)
    inAct(() => sheet().fitColumn("note"))
    expect(widths()[2]).toBe(300)
    // Fractions round up, so the content is never clipped.
    sheet().setColumnMeasurer(() => 81.2)
    inAct(() => sheet().fitColumn("note"))
    expect(widths()[2]).toBe(82)
  })

  it("measures the rows on screen and a bounded sample of 100,000 rows", () => {
    const rows = make(100_000)
    const { sheet } = setup({}, rows)
    const measure = vi.fn(byLength)
    sheet().setColumnMeasurer(measure)
    sheet().setVisibleRows({ startIndex: 50_000, endIndex: 50_029 })
    inAct(() => sheet().fitColumn("note"))
    const measured = (measure.mock.calls[0] as [Column<Item>, Item[]])[1]
    expect(measured.length).toBeLessThanOrEqual(500)
    for (let i = 50_000; i <= 50_029; i++) {
      expect(measured).toContain(rows[i])
    }
    expect(measured).toContain(rows[0])
    expect(measured).toContain(rows[99_999])
  })

  it("in fill sizing, keeps the fitted width while the others grow", () => {
    const { sheet, widths, available } = setup({ sizing: "fill" })
    available(600)
    sheet().setColumnMeasurer(() => 120)
    inAct(() => sheet().fitColumn("price"))
    // name is pinned (200), price is fitted (120), note takes the rest.
    expect(widths()).toEqual([200, 120, 280])
  })

  it("lets a fitted column grow again once its size is reset", () => {
    const { sheet, widths, available } = setup({ sizing: "fill" })
    available(600)
    sheet().setColumnMeasurer(() => 120)
    inAct(() => sheet().fitColumn("price"))
    inAct(() => sheet().table.getColumn("price")?.resetSize())
    expect(widths()).toEqual([200, 200, 200])
  })
})

describe("fitAllColumns", () => {
  it("fits every column, pinned ones included", () => {
    const { sheet, widths } = setup({}, make(10))
    sheet().setColumnMeasurer(byLength)
    let fitted = false
    inAct(() => {
      fitted = sheet().fitAllColumns()
    })
    expect(fitted).toBe(true)
    // "Item 9" is 60 px, prices are at most 50 px, notes at most 60 px.
    expect(widths()).toEqual([60, 50, 60])
  })

  it("in fill sizing, makes the fitted widths the minimums and still fills", () => {
    const { sheet, widths, available } = setup({ sizing: "fill" })
    available(600)
    sheet().setColumnMeasurer(() => 80)
    inAct(() => sheet().fitColumn("price"))
    inAct(() => sheet().fitAllColumns())
    // Every column is 80 (note's min is 60); the two unpinned ones share
    // 600 - 240 = 360 spare and grow again, the fitted one included.
    expect(widths()).toEqual([80, 260, 260])
  })
})

describe("getColumnResizeHandler", () => {
  function drag(
    sheet: ReturnType<typeof setup>["sheet"],
    columnId: string,
    by: number
  ) {
    inAct(() =>
      sheet().getColumnResizeHandler(columnId)(
        new MouseEvent("mousedown", { clientX: 100 })
      )
    )
    inAct(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 + by }))
    })
    inAct(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { clientX: 100 + by }))
    })
  }

  it("resizes from the column's width in fixed sizing", () => {
    const { sheet, widths } = setup()
    drag(sheet, "price", 30)
    expect(widths()).toEqual([200, 130, 100])
  })

  it("in fill sizing, starts from the width the column shows and keeps it", () => {
    const { sheet, widths, available } = setup({ sizing: "fill" })
    available(600)
    expect(widths()).toEqual([200, 200, 200])
    drag(sheet, "price", 40)
    // The edge follows the pointer: 200 + 40. note takes what is left.
    expect(widths()).toEqual([200, 240, 160])
  })
})

describe("switching to fill after sizing columns", () => {
  it("keeps the columns the user resized or fitted at their widths", () => {
    const { sheet, widths, available, rerender } = setup()
    available(700)
    sheet().setColumnMeasurer(() => 90)
    inAct(() => sheet().fitColumn("price"))
    inAct(() =>
      sheet().getColumnResizeHandler("note")(
        new MouseEvent("mousedown", { clientX: 0 })
      )
    )
    inAct(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { clientX: 20 }))
    })
    expect(widths()).toEqual([200, 90, 120])
    rerender({ columns, getRowId, defaultData: make(5), sizing: "fill" })
    // Nothing left to grow: name is pinned, price and note were sized.
    expect(widths()).toEqual([200, 90, 120])
  })
})
