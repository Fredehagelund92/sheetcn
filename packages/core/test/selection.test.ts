import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  boundingRect,
  cellEdges,
  intersectRects,
  jumpCell,
  navigate,
  rangeFromIndexes,
  rangeToRect,
  rectArea,
  rectFromCorners,
  rectsContain,
  resolveRanges,
  rowSelectionKey,
  stepCell,
  type ActiveRange,
  type CellIndex,
  type CellRange,
  type CellRect,
  type GridSize,
  type Navigation,
} from "../src/index.js"

const at = (rowIndex: number, columnIndex: number): CellIndex => ({
  rowIndex,
  columnIndex,
})
const rect = (r0: number, r1: number, c0: number, c1: number): CellRect => ({
  minRowIndex: r0,
  maxRowIndex: r1,
  minColumnIndex: c0,
  maxColumnIndex: c1,
})

// Ids are "r<i>" and "c<j>", so a range can be written by position.
const rowIndexOf = (id: string) =>
  id.startsWith("r") ? Number(id.slice(1)) : -1
const columnIndexOf = (id: string) =>
  id.startsWith("c") ? Number(id.slice(1)) : -1
const range = (
  a: CellIndex,
  f: CellIndex,
  operation?: "exclude"
): CellRange => ({
  ...rangeFromIndexes(
    { anchor: a, focus: f },
    (i) => `r${i}`,
    (j) => `c${j}`
  ),
  ...(operation ? { operation } : {}),
})

describe("rectangles", () => {
  it("normalizes corners and measures area", () => {
    const r = rectFromCorners(at(5, 1), at(2, 3))
    expect(r).toEqual(rect(2, 5, 1, 3))
    expect(rectArea(r)).toBe(12)
  })

  it("intersects, or returns null when apart", () => {
    expect(intersectRects(rect(0, 4, 0, 4), rect(3, 9, 2, 2))).toEqual(
      rect(3, 4, 2, 2)
    )
    expect(intersectRects(rect(0, 1, 0, 1), rect(2, 3, 0, 1))).toBeNull()
  })

  it("bounds a list of rectangles", () => {
    expect(boundingRect([])).toBeNull()
    expect(boundingRect([rect(2, 3, 5, 5), rect(0, 1, 7, 9)])).toEqual(
      rect(0, 3, 5, 9)
    )
  })

  it("maps a range to a rectangle and skips one that no longer resolves", () => {
    expect(
      rangeToRect(range(at(4, 2), at(1, 0)), rowIndexOf, columnIndexOf)
    ).toEqual(rect(1, 4, 0, 2))
    const gone = { ...range(at(0, 0), at(1, 1)), focusRowId: "x" }
    expect(rangeToRect(gone, rowIndexOf, columnIndexOf)).toBeNull()
  })
})

describe("resolveRanges", () => {
  it("adds overlapping ranges without counting a cell twice", () => {
    const rects = resolveRanges(
      [range(at(0, 0), at(2, 2)), range(at(1, 1), at(3, 3))],
      rowIndexOf,
      columnIndexOf
    )
    expect(rects.reduce((n, r) => n + rectArea(r), 0)).toBe(9 + 9 - 4)
  })

  it("subtracts an exclude range from the ranges before it", () => {
    const rects = resolveRanges(
      [range(at(0, 0), at(2, 2)), range(at(1, 1), at(1, 1), "exclude")],
      rowIndexOf,
      columnIndexOf
    )
    expect(rects.reduce((n, r) => n + rectArea(r), 0)).toBe(8)
    expect(rectsContain(rects, 1, 1)).toBe(false)
  })

  // Brute force: a set of cells built range by range.
  const cellsOf = (ranges: CellRange[]) => {
    const cells = new Set<string>()
    for (const r of ranges) {
      const b = rangeToRect(r, rowIndexOf, columnIndexOf)
      if (!b) continue
      for (let i = b.minRowIndex; i <= b.maxRowIndex; i++) {
        for (let j = b.minColumnIndex; j <= b.maxColumnIndex; j++) {
          if (r.operation === "exclude") cells.delete(`${i},${j}`)
          else cells.add(`${i},${j}`)
        }
      }
    }
    return cells
  }
  const SIZE = 8
  const index = fc.integer({ min: 0, max: SIZE - 1 })
  const arbRange = fc
    .tuple(index, index, index, index, fc.boolean())
    .map(([a, b, c, d, exclude]) =>
      range(at(a, b), at(c, d), exclude ? "exclude" : undefined)
    )

  it("covers exactly the cells of the ranges, with disjoint rectangles", () => {
    fc.assert(
      fc.property(fc.array(arbRange, { maxLength: 6 }), (ranges) => {
        const rects = resolveRanges(ranges, rowIndexOf, columnIndexOf)
        const expected = cellsOf(ranges)
        expect(rects.reduce((n, r) => n + rectArea(r), 0)).toBe(expected.size)
        for (let i = 0; i < SIZE; i++) {
          for (let j = 0; j < SIZE; j++) {
            expect(rectsContain(rects, i, j)).toBe(expected.has(`${i},${j}`))
          }
        }
      })
    )
  })
})

describe("cellEdges", () => {
  it("marks the outline of a union of rectangles", () => {
    // An L shape: rows 0-2 of column 0, and row 2 of columns 0-2.
    const rects = [rect(0, 1, 0, 0), rect(2, 2, 0, 2)]
    expect(cellEdges(rects, 0, 0)).toEqual({
      top: true,
      right: true,
      bottom: false,
      left: true,
    })
    expect(cellEdges(rects, 2, 0)).toEqual({
      top: false,
      right: false,
      bottom: true,
      left: true,
    })
    expect(cellEdges(rects, 2, 1).top).toBe(true)
    expect(cellEdges(rects, 1, 1)).toEqual({
      top: false,
      right: false,
      bottom: false,
      left: false,
    })
  })
})

describe("rowSelectionKey", () => {
  it("is empty for a row the selection does not reach", () => {
    expect(rowSelectionKey([rect(10, 12, 0, 3)], 5, null)).toBe("")
    // The row just above a range draws nothing but its key still changes,
    // because the range's top edge depends on it.
    expect(rowSelectionKey([rect(10, 12, 0, 3)], 9, null)).not.toBe("")
  })

  it("does not change for a far row when the selection grows elsewhere", () => {
    const before = rowSelectionKey([rect(100, 200, 0, 3)], 150, at(100, 0))
    const after = rowSelectionKey([rect(100, 201, 0, 3)], 150, at(100, 0))
    expect(after).toBe(before)
  })

  it("names the active cell's column on its row only", () => {
    expect(rowSelectionKey([rect(3, 3, 2, 2)], 3, at(3, 2))).toContain("@2")
    expect(rowSelectionKey([rect(3, 4, 2, 2)], 4, at(3, 2))).not.toContain("@")
  })

  // What a row draws: selected cells, their edges, and the active cell.
  const drawing = (
    rects: CellRect[],
    active: CellIndex | null,
    row: number,
    columns: number
  ) =>
    JSON.stringify({
      edges: Array.from({ length: columns }, (_, j) =>
        cellEdges(rects, row, j)
      ),
      selected: Array.from({ length: columns }, (_, j) =>
        rectsContain(rects, row, j)
      ),
      active: active?.rowIndex === row ? active.columnIndex : null,
    })

  it("is equal for two selections only when the row draws the same", () => {
    const SIZE = 6
    const index = fc.integer({ min: 0, max: SIZE - 1 })
    const selection = fc.record({
      ranges: fc.array(
        fc
          .tuple(index, index, index, index)
          .map(([a, b, c, d]) => range(at(a, b), at(c, d))),
        { minLength: 1, maxLength: 3 }
      ),
      active: fc.option(fc.tuple(index, index).map(([r, c]) => at(r, c))),
    })
    fc.assert(
      fc.property(selection, selection, index, (x, y, row) => {
        const rx = resolveRanges(x.ranges, rowIndexOf, columnIndexOf)
        const ry = resolveRanges(y.ranges, rowIndexOf, columnIndexOf)
        if (
          rowSelectionKey(rx, row, x.active) ===
          rowSelectionKey(ry, row, y.active)
        ) {
          expect(drawing(rx, x.active, row, SIZE)).toBe(
            drawing(ry, y.active, row, SIZE)
          )
        }
      }),
      { numRuns: 2000 }
    )
  })
})

const grid: GridSize = {
  rowCount: 100,
  columnCount: 5,
  pageRows: 20,
  pageColumns: 2,
}
const one = (r: number, c: number): ActiveRange => ({
  anchor: at(r, c),
  focus: at(r, c),
})

describe("stepCell and jumpCell", () => {
  it("steps and stops at the grid edge", () => {
    expect(stepCell(at(0, 0), "up", grid)).toEqual(at(0, 0))
    expect(stepCell(at(0, 0), "down", grid, 30)).toEqual(at(30, 0))
    expect(stepCell(at(90, 4), "down", grid, 30)).toEqual(at(99, 4))
    expect(stepCell(at(1, 3), "right", grid, 30)).toEqual(at(1, 4))
  })

  it("jumps to the grid edge without blank information", () => {
    expect(jumpCell(at(40, 2), "down", grid)).toEqual(at(99, 2))
    expect(jumpCell(at(40, 2), "left", grid)).toEqual(at(40, 0))
  })

  // Column 0 of a 10-row grid: filled at rows 2-4 and 7.
  const filled = new Set([2, 3, 4, 7])
  const isBlank = (r: number) => !filled.has(r)
  const tall = { rowCount: 10, columnCount: 1 }
  const down = (r: number) => jumpCell(at(r, 0), "down", tall, isBlank).rowIndex
  const up = (r: number) => jumpCell(at(r, 0), "up", tall, isBlank).rowIndex

  it("follows the spreadsheet rule with blank information", () => {
    expect(down(0)).toBe(2) // blank: to the next filled cell
    expect(down(2)).toBe(4) // inside a run: to its end
    expect(down(4)).toBe(7) // end of a run: to the next filled cell
    expect(down(7)).toBe(9) // nothing filled below: to the grid edge
    expect(down(9)).toBe(9)
    expect(up(9)).toBe(7)
    expect(up(4)).toBe(2)
    expect(up(2)).toBe(0)
  })
})

describe("navigate", () => {
  const go = (active: ActiveRange | null, nav: Navigation) =>
    navigate(active, nav, grid)

  it("selects the first cell when nothing is selected", () => {
    expect(
      go(null, { type: "move", direction: "down", extend: false })
    ).toEqual(one(0, 0))
  })

  it("returns null for an empty grid", () => {
    const empty = { ...grid, rowCount: 0 }
    expect(navigate(one(0, 0), { type: "selectAll" }, empty)).toBeNull()
  })

  it("moves from the active cell and collapses a range", () => {
    const active = { anchor: at(5, 1), focus: at(9, 3) }
    expect(
      go(active, { type: "move", direction: "down", extend: false })
    ).toEqual(one(6, 1))
  })

  it("extends by moving the focus and keeping the anchor", () => {
    const active = { anchor: at(5, 1), focus: at(9, 3) }
    expect(
      go(active, { type: "move", direction: "down", extend: true })
    ).toEqual({ anchor: at(5, 1), focus: at(10, 3) })
    expect(
      go(active, { type: "jump", direction: "right", extend: true })
    ).toEqual({ anchor: at(5, 1), focus: at(9, 4) })
  })

  it("pages by the viewport, rows or columns", () => {
    expect(
      go(one(5, 0), { type: "page", direction: "down", extend: false })
    ).toEqual(one(25, 0))
    expect(
      go(one(5, 0), { type: "page", direction: "up", extend: false })
    ).toEqual(one(0, 0))
    expect(
      go(one(5, 0), { type: "page", direction: "right", extend: true })
    ).toEqual({ anchor: at(5, 0), focus: at(5, 2) })
  })

  it("goes to row and grid ends", () => {
    expect(go(one(5, 2), { type: "rowStart", extend: false })).toEqual(
      one(5, 0)
    )
    expect(go(one(5, 2), { type: "rowEnd", extend: true })).toEqual({
      anchor: at(5, 2),
      focus: at(5, 4),
    })
    expect(go(one(5, 2), { type: "gridStart", extend: false })).toEqual(
      one(0, 0)
    )
    expect(go(one(5, 2), { type: "gridEnd", extend: false })).toEqual(
      one(99, 4)
    )
  })

  it("selects all, whole rows and whole columns", () => {
    expect(go(one(5, 2), { type: "selectAll" })).toEqual({
      anchor: at(0, 0),
      focus: at(99, 4),
    })
    const active = { anchor: at(5, 2), focus: at(7, 3) }
    expect(go(active, { type: "selectRows" })).toEqual({
      anchor: at(5, 0),
      focus: at(7, 4),
    })
    expect(go(active, { type: "selectColumns" })).toEqual({
      anchor: at(0, 2),
      focus: at(99, 3),
    })
  })

  it("collapses to the active cell", () => {
    expect(
      go({ anchor: at(5, 2), focus: at(7, 3) }, { type: "collapse" })
    ).toEqual(one(5, 2))
  })

  it("always lands inside the grid", () => {
    const index = (n: number) => fc.integer({ min: 0, max: n - 1 })
    const cell = fc.tuple(index(100), index(5)).map(([r, c]) => at(r, c))
    const direction = fc.constantFrom("up", "down", "left", "right" as const)
    const nav: fc.Arbitrary<Navigation> = fc.oneof(
      fc.record({
        type: fc.constantFrom("move", "jump", "page" as const),
        direction,
        extend: fc.boolean(),
      }),
      fc.record({
        type: fc.constantFrom(
          "rowStart",
          "rowEnd",
          "gridStart",
          "gridEnd" as const
        ),
        extend: fc.boolean(),
      }),
      fc.constantFrom<Navigation>(
        { type: "selectAll" },
        { type: "selectRows" },
        { type: "selectColumns" },
        { type: "collapse" }
      )
    )
    fc.assert(
      fc.property(cell, cell, nav, (anchor, focus, n) => {
        const out = navigate({ anchor, focus }, n, grid)!
        for (const c of [out.anchor, out.focus]) {
          expect(c.rowIndex).toBeGreaterThanOrEqual(0)
          expect(c.rowIndex).toBeLessThan(grid.rowCount)
          expect(c.columnIndex).toBeGreaterThanOrEqual(0)
          expect(c.columnIndex).toBeLessThan(grid.columnCount)
        }
        if ("extend" in n && n.extend) expect(out.anchor).toEqual(anchor)
      })
    )
  })
})
