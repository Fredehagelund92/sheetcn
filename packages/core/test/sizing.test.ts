import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  fillColumnWidths,
  sampleRowIndexes,
  type FillColumn,
} from "../src/index.js"

const total = (widths: readonly number[]) => widths.reduce((s, w) => s + w, 0)

describe("fillColumnWidths", () => {
  it("shares spare width in proportion to the widths by default", () => {
    // 100 + 200 + 100 = 400, and 800 leaves 400 spare.
    const widths = fillColumnWidths(800, [
      { width: 100 },
      { width: 200 },
      { width: 100 },
    ])
    expect(widths).toEqual([200, 400, 200])
  })

  it("shares spare width by grow weight when one is given", () => {
    const widths = fillColumnWidths(700, [
      { width: 100, grow: 1 },
      { width: 100, grow: 3 },
      { width: 100, grow: 0 },
    ])
    expect(widths).toEqual([200, 400, 100])
  })

  it("never grows pinned columns", () => {
    const widths = fillColumnWidths(600, [
      { width: 200, pinned: true },
      { width: 100 },
      { width: 100 },
    ])
    expect(widths).toEqual([200, 200, 200])
  })

  it("keeps the widths when they do not fit, so the grid scrolls", () => {
    const columns: FillColumn[] = [{ width: 300 }, { width: 400 }]
    expect(fillColumnWidths(500, columns)).toEqual([300, 400])
    expect(fillColumnWidths(700, columns)).toEqual([300, 400])
  })

  it("keeps the widths before the grid is measured", () => {
    const columns: FillColumn[] = [{ width: 100 }]
    expect(fillColumnWidths(Number.NaN, columns)).toEqual([100])
    expect(fillColumnWidths(0, columns)).toEqual([100])
    expect(fillColumnWidths(100.5, columns)).toEqual([100])
  })

  it("hands a capped column's share on to the others", () => {
    const widths = fillColumnWidths(1000, [
      { width: 100, maxWidth: 150 },
      { width: 100 },
      { width: 100 },
    ])
    expect(widths).toEqual([150, 425, 425])
  })

  it("stops short of the edge when every growing column is capped", () => {
    const widths = fillColumnWidths(1000, [
      { width: 100, maxWidth: 200 },
      { width: 100, grow: 0 },
    ])
    expect(widths).toEqual([200, 100])
  })

  it("rounds to whole pixels that add up to the available width", () => {
    const widths = fillColumnWidths(1001, [
      { width: 100 },
      { width: 100 },
      { width: 100 },
    ])
    expect(widths.every(Number.isInteger)).toBe(true)
    expect(total(widths)).toBe(1001)
    // The extra pixel goes to the first column on a tie.
    expect(widths).toEqual([334, 334, 333])
  })

  it("fills the example of nine columns on a 1,440 px screen", () => {
    // Nine columns totalling 1,268 px, and a 64 px row number gutter.
    const nine = [200, 110, 130, 110, 100, 72, 100, 120, 326].map((width) => ({
      width,
    }))
    expect(total(nine.map((c) => c.width))).toBe(1268)
    const widths = fillColumnWidths(1440 - 64, nine)
    expect(total(widths)).toBe(1376)
  })

  const column = fc.record(
    {
      width: fc.integer({ min: 20, max: 400 }),
      grow: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 5 })),
      maxWidth: fc.integer({ min: 20, max: 800 }),
      pinned: fc.boolean(),
    },
    { requiredKeys: ["width"] }
  )
  const input = fc.tuple(
    fc.integer({ min: 0, max: 4000 }),
    fc.array(column, { minLength: 1, maxLength: 24 })
  )
  const clean = (columns: FillColumn[]) =>
    // A column's limit is never below its own width.
    columns.map((c) =>
      c.maxWidth === undefined
        ? c
        : { ...c, maxWidth: Math.max(c.maxWidth, c.width) }
    )

  it("never shrinks a column, never passes a limit, never grows a fixed one", () => {
    fc.assert(
      fc.property(input, ([available, raw]) => {
        const columns = clean(raw)
        const widths = fillColumnWidths(available, columns)
        expect(widths).toHaveLength(columns.length)
        columns.forEach((c, i) => {
          const w = widths[i] as number
          expect(w).toBeGreaterThanOrEqual(c.width)
          expect(w).toBeLessThanOrEqual(c.maxWidth ?? Infinity)
          if (c.pinned || c.grow === 0) expect(w).toBe(c.width)
        })
      })
    )
  })

  it("ends exactly at the edge when a column can still grow", () => {
    fc.assert(
      fc.property(input, ([available, raw]) => {
        const columns = raw.map((c) => ({ ...c, maxWidth: Infinity }))
        const widths = fillColumnWidths(available, columns)
        const base = total(columns.map((c) => c.width))
        const grows = columns.some((c) => !c.pinned && c.grow !== 0)
        if (base >= available || !grows) {
          expect(widths).toEqual(columns.map((c) => c.width))
        } else {
          expect(total(widths)).toBe(available)
        }
      })
    )
  })
})

describe("sampleRowIndexes", () => {
  it("takes every row when there are few", () => {
    expect(sampleRowIndexes(4, { startIndex: 1, endIndex: 2 }, 10)).toEqual([
      0, 1, 2, 3,
    ])
  })

  it("takes the visible rows and spreads the rest over the others", () => {
    const rows = sampleRowIndexes(
      100_000,
      { startIndex: 500, endIndex: 529 },
      1000
    )
    expect(rows.length).toBeLessThanOrEqual(1000)
    expect(rows.length).toBeGreaterThan(990)
    for (let i = 500; i <= 529; i++) expect(rows).toContain(i)
    expect(rows[0]).toBe(0)
    expect(rows.at(-1)).toBe(99_999)
    expect(rows).toEqual([...new Set(rows)].sort((a, b) => a - b))
  })

  it("clips the visible rows to the row count and the limit", () => {
    expect(sampleRowIndexes(10, { startIndex: 8, endIndex: 40 }, 3)).toEqual([
      0, 8, 9,
    ])
    expect(sampleRowIndexes(10, { startIndex: 0, endIndex: 9 }, 2)).toEqual([
      0, 1,
    ])
  })

  it("never returns more than the limit, or a row out of range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 6000 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 1200 }),
        (rowCount, start, length, limit) => {
          const rows = sampleRowIndexes(
            rowCount,
            { startIndex: start, endIndex: start + length },
            limit
          )
          expect(rows.length).toBeLessThanOrEqual(Math.max(limit, 0))
          for (const r of rows) {
            expect(r).toBeGreaterThanOrEqual(0)
            expect(r).toBeLessThan(rowCount)
          }
        }
      )
    )
  })
})
