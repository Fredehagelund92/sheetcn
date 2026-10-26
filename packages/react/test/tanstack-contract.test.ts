// @vitest-environment jsdom
// The TanStack Table 9.3.x behaviour that @sheetcn/react relies on, pinned.
// When an upgrade breaks one of these, read the binding before moving the pin.
import { createRequire } from "node:module"

import {
  navigate,
  resolveRanges,
  type ActiveRange,
  type CellRange,
  type Direction,
} from "@sheetcn/core"
import {
  cellSelectionFeature,
  columnPinningFeature,
  tableFeatures,
  useTable,
  type CellSelectionState,
  type ColumnDef,
} from "@tanstack/react-table"
import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { sheetFeatures } from "../src/index.js"
import { inAct, inActAsync, renderHook } from "./render.js"

type R = { id: string; v: number[] }

const COLUMNS = 4
const make = (n: number): R[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    v: Array.from({ length: COLUMNS }, (_, j) => i * 10 + j),
  }))

const baseColumns = Array.from({ length: COLUMNS }, (_, j) => ({
  id: `c${j}`,
  accessorFn: (row: R) => row.v[j],
}))

const stockFeatures = tableFeatures({
  cellSelectionFeature,
  columnPinningFeature,
})

// Column c2 is pinned, so the display order is c2, c0, c1, c3.
const PINNED = { start: ["c2"], end: [] }
const DISPLAY = ["c2", "c0", "c1", "c3"]

type Setup = { data: R[]; autoReset?: boolean; selection?: CellSelectionState }

function renderTable(features: "stock" | "sheet", setup: Setup) {
  const options = ({ data, autoReset, selection = [] }: Setup) => ({
    data,
    getRowId: (r: R) => r.id,
    initialState: { columnPinning: PINNED, cellSelection: selection },
    ...(autoReset === undefined ? {} : { autoResetCellSelection: autoReset }),
  })
  const sheetColumns: ColumnDef<typeof sheetFeatures, R>[] = baseColumns
  const stockColumns: ColumnDef<typeof stockFeatures, R>[] = baseColumns
  return features === "sheet"
    ? renderHook(
        (p: Setup) =>
          useTable({
            ...options(p),
            features: sheetFeatures,
            columns: sheetColumns,
          }),
        setup
      )
    : renderHook(
        (p: Setup) =>
          useTable({
            ...options(p),
            features: stockFeatures,
            columns: stockColumns,
          }),
        setup
      )
}

const rowIndexOf = (id: string) => Number(id.slice(1))
const columnIndexOf = (id: string) => DISPLAY.indexOf(id)
const rangeOf = (a: ActiveRange): CellRange => ({
  anchorRowId: `r${a.anchor.rowIndex}`,
  anchorColumnId: DISPLAY[a.anchor.columnIndex] as string,
  focusRowId: `r${a.focus.rowIndex}`,
  focusColumnId: DISPLAY[a.focus.columnIndex] as string,
})

describe("the installed TanStack Table", () => {
  it("is 9.3.x", () => {
    const require = createRequire(import.meta.resolve("@tanstack/react-table"))
    const { version } = require("@tanstack/table-core/package.json") as {
      version: string
    }
    expect(version).toMatch(/^9\.3\./)
  })
})

describe("getCellSelectionBounds", () => {
  it("normalizes corners into display-order indexes, pinned columns first", () => {
    const { result } = renderTable("sheet", { data: make(6) })
    const table = result.current
    inAct(() =>
      table.selectCellRange({
        anchorRowId: "r3",
        anchorColumnId: "c0",
        focusRowId: "r1",
        focusColumnId: "c2",
      })
    )
    expect(table.getCellSelectionBounds()).toEqual([
      { minRowIndex: 1, maxRowIndex: 3, minColumnIndex: 0, maxColumnIndex: 1 },
    ])
    expect(table.getCellSelectionColumnIndexes()).toEqual({
      c2: 0,
      c0: 1,
      c1: 2,
      c3: 3,
    })
  })

  it("omits a range whose corner no longer resolves", () => {
    const { result } = renderTable("sheet", { data: make(6) })
    inAct(() =>
      result.current.setCellSelection([
        {
          anchorRowId: "r1",
          anchorColumnId: "c0",
          focusRowId: "gone",
          focusColumnId: "c1",
        },
      ])
    )
    expect(result.current.getCellSelectionBounds()).toEqual([])
  })

  it("is memoized: the same array until the selection or rows change", () => {
    const { result } = renderTable("sheet", { data: make(6) })
    const table = result.current
    inAct(() => table.setFocusedCell("r1", "c1"))
    const first = table.getCellSelectionBounds()
    expect(table.getCellSelectionBounds()).toBe(first)
    inAct(() => table.setFocusedCell("r2", "c1"))
    expect(table.getCellSelectionBounds()).not.toBe(first)
  })

  it("matches the core's resolveRanges for any include and exclude ranges", () => {
    const { result } = renderTable("sheet", { data: make(6) })
    const table = result.current
    const row = fc.integer({ min: 0, max: 5 })
    const column = fc.integer({ min: 0, max: COLUMNS - 1 })
    const range = fc
      .tuple(row, column, row, column, fc.boolean())
      .map(([r0, c0, r1, c1, exclude]) => ({
        ...rangeOf({
          anchor: { rowIndex: r0, columnIndex: c0 },
          focus: { rowIndex: r1, columnIndex: c1 },
        }),
        ...(exclude ? { operation: "exclude" as const } : {}),
      }))
    fc.assert(
      fc.property(fc.array(range, { maxLength: 5 }), (ranges) => {
        inAct(() => table.setCellSelection(ranges))
        const ours = resolveRanges(ranges, rowIndexOf, columnIndexOf)
        // Both are disjoint and row-major; they may cut a shape differently,
        // so compare the cells they cover.
        const cells = (rects: typeof ours) =>
          rects
            .flatMap((r) =>
              Array.from(
                { length: r.maxRowIndex - r.minRowIndex + 1 },
                (_, i) =>
                  Array.from(
                    { length: r.maxColumnIndex - r.minColumnIndex + 1 },
                    (_, j) => `${r.minRowIndex + i},${r.minColumnIndex + j}`
                  )
              ).flat()
            )
            .sort()
        expect(cells(table.getCellSelectionBounds())).toEqual(cells(ours))
      }),
      { numRuns: 200 }
    )
  })
})

describe("autoResetCellSelection", () => {
  const one = [
    {
      anchorRowId: "r1",
      anchorColumnId: "c0",
      focusRowId: "r1",
      focusColumnId: "c0",
    },
  ]
  const patched = (data: R[]) => {
    const next = data.slice()
    next[2] = { ...(data[2] as R), v: [0, 0, 0, 0] }
    return next
  }

  for (const features of ["stock", "sheet"] as const) {
    it(`defaults to on: a data change resets the selection (${features} row model)`, async () => {
      const data = make(6)
      const { result, rerender } = renderTable(features, { data })
      inAct(() => result.current.setCellSelection(one))
      // The row model is lazy and skips the reset on its first build; the
      // reset runs in a microtask after a view reads the rebuilt model.
      inAct(() => result.current.getRowModel())
      rerender({ data: patched(data) })
      await inActAsync(() => result.current.getRowModel())
      expect(result.current.atoms.cellSelection.get()).toEqual([])
    })

    it(`keeps the selection across data changes when off (${features} row model)`, async () => {
      const data = make(6)
      const { result, rerender } = renderTable(features, {
        data,
        autoReset: false,
      })
      inAct(() => result.current.setCellSelection(one))
      inAct(() => result.current.getRowModel())
      rerender({ data: patched(data), autoReset: false })
      await inActAsync(() => result.current.getRowModel())
      expect(result.current.atoms.cellSelection.get()).toEqual(one)
    })
  }
})

describe("moveCellSelection and extendCellSelection (stepCoordinate)", () => {
  // The binding moves with the core's navigate instead, which needs no scan
  // of the rows per key press. TanStack's own moves stay available to apps,
  // so both must agree.
  const directions: Direction[] = ["up", "down", "left", "right"]
  const size = {
    rowCount: 4,
    columnCount: COLUMNS,
    pageRows: 1,
    pageColumns: 1,
  }

  it("agrees with the core's navigate from every cell, both moving and extending", () => {
    const { result } = renderTable("sheet", { data: make(4) })
    const table = result.current
    const resolve = () => {
      const r = table.atoms.cellSelection.get().at(-1) as CellRange
      return {
        anchor: {
          rowIndex: rowIndexOf(r.anchorRowId),
          columnIndex: columnIndexOf(r.anchorColumnId),
        },
        focus: {
          rowIndex: rowIndexOf(r.focusRowId),
          columnIndex: columnIndexOf(r.focusColumnId),
        },
      }
    }
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < COLUMNS; c++) {
        for (const direction of directions) {
          for (const extend of [false, true]) {
            // A move starts from the active cell, an extend from the focus.
            const cell = { rowIndex: r, columnIndex: c }
            const start = extend
              ? { anchor: { rowIndex: 1, columnIndex: 1 }, focus: cell }
              : { anchor: cell, focus: cell }
            inAct(() => table.setCellSelection([rangeOf(start)]))
            inAct(() =>
              extend
                ? table.extendCellSelection(direction)
                : table.moveCellSelection(direction)
            )
            const ours = navigate(
              start,
              { type: "move", direction, extend },
              size
            )
            expect(resolve()).toEqual(ours)
          }
        }
      }
    }
  })
})

describe("getSelectedCellRangesData", () => {
  it("reads every selected cell, so it must not run for big ranges", () => {
    // It builds a Cell per selected cell and caches it on the row (about
    // 300 MB retained after selecting 2,000,000 cells). The binding reads
    // `row.original` for the cells it needs instead.
    const { result } = renderTable("sheet", { data: make(6) })
    inAct(() => result.current.selectAllCells())
    const [grid] = result.current.getSelectedCellRangesData()
    expect(grid?.flat()).toHaveLength(6 * COLUMNS)
  })
})

describe("useTable", () => {
  it("returns a new wrapper each render whose methods share one table", () => {
    const data = make(3)
    const { result, rerender } = renderTable("sheet", { data })
    const first = result.current
    rerender({ data: make(5) })
    expect(result.current).not.toBe(first)
    expect(first.getRowModel().rows).toHaveLength(5)
  })
})

describe("the sheet core row model", () => {
  it("rebuilds only the changed row on a one-cell change", () => {
    const data = make(6)
    const { result, rerender } = renderTable("sheet", {
      data,
      autoReset: false,
    })
    const before = result.current.getRowModel()
    const rows = before.rows.slice()
    inAct(() => result.current.setFocusedCell("r4", "c1"))
    const bounds = result.current.getCellSelectionBounds()

    const next = data.slice()
    next[2] = { ...(data[2] as R), v: [7, 7, 7, 7] }
    rerender({ data: next, autoReset: false })
    const after = result.current.getRowModel()

    expect(after.rows).not.toBe(before.rows)
    after.rows.forEach((row, i) => {
      if (i === 2) expect(row).not.toBe(rows[i])
      else expect(row).toBe(rows[i])
    })
    expect(after.rowsById).toBe(before.rowsById)
    expect(after.rowsById.r2).toBe(after.rows[2])
    expect(after.rows[2]?.getValue("c0")).toBe(7)
    expect(after.rows[2]?.getDisplayIndex()).toBe(2)
    expect(result.current.getCellSelectionBounds()).toEqual(bounds)
  })

  it("keeps the model when the array changes but no row does", () => {
    const data = make(6)
    const { result, rerender } = renderTable("sheet", { data })
    const before = result.current.getRowModel()
    rerender({ data: data.slice() })
    expect(result.current.getRowModel().rows).toBe(before.rows)
  })

  it("rebuilds everything when rows are added, removed or moved", () => {
    const data = make(6)
    const { result, rerender } = renderTable("sheet", { data })
    const before = result.current.getRowModel()

    rerender({ data: [...data, { id: "new", v: [1, 2, 3, 4] }] })
    const added = result.current.getRowModel()
    expect(added.rowsById).not.toBe(before.rowsById)
    expect(added.rows.map((r) => r.id)).toEqual([
      ...data.map((r) => r.id),
      "new",
    ])

    const swapped = data.slice()
    ;[swapped[0], swapped[1]] = [swapped[1] as R, swapped[0] as R]
    rerender({ data: swapped })
    const moved = result.current.getRowModel()
    expect(moved.rows.map((r) => r.id).slice(0, 2)).toEqual(["r1", "r0"])
    expect(moved.rows[0]?.getDisplayIndex()).toBe(0)
    expect(moved.rowsById.r0?.getDisplayIndex()).toBe(1)
  })
})
