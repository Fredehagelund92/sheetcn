import type { RowData } from "@tanstack/react-table"
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual"
import { useCallback, useLayoutEffect } from "react"

import type { Sheet } from "./sheet.js"

export type SheetRowVirtualizerOptions = {
  getScrollElement: () => HTMLElement | null
  /** Every row has this height, in pixels. */
  rowHeight: number
  /** Space above the first row, such as a sticky header. Default 0. */
  paddingStart?: number
  /** Rows rendered beyond the viewport on each side. Default 6. */
  overscan?: number
}

/** Adds `index` to a virtualizer range, so that item stays mounted. */
function keepMounted(range: Range, index: number | undefined): number[] {
  const out = defaultRangeExtractor(range)
  if (index !== undefined && index >= 0 && index < range.count) {
    if (!out.includes(index)) {
      out.push(index)
      out.sort((a, b) => a - b)
    }
  }
  return out
}

/**
 * A row virtualizer for a sheet, with the rules the grid needs at 100,000
 * rows:
 * - Item keys are row ids, from a `getItemKey` that keeps its identity across
 *   edits. A new `getItemKey` makes the virtualizer recompute every row's
 *   offset (2 ms per frame at 100,000 rows), so it changes only when row ids
 *   may have moved (rows added, removed or reordered).
 * - The active cell's row stays mounted while scrolled out of view, so DOM
 *   focus survives scrolling.
 */
export function useSheetRowVirtualizer<Row extends RowData>(
  sheet: Sheet<Row>,
  options: SheetRowVirtualizerOptions
) {
  const { rowHeight, paddingStart = 0, overscan = 6 } = options
  // The same object until the rows are rebuilt from scratch (see
  // createSheetCoreRowModel), which is when ids may have moved.
  const layout = sheet.table.getCoreRowModel().rowsById
  const getItemKey = useCallback(
    (index: number) => sheet.getRows()[index]?.id ?? index,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new layout is what makes the old keys stale
    [sheet, layout]
  )
  const rangeExtractor = useCallback(
    (range: Range) =>
      keepMounted(range, sheet.getActiveRange()?.anchor.rowIndex),
    [sheet]
  )
  // The virtualizer's functions are not memoizable; nothing here relies on
  // compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  return useVirtualizer({
    count: sheet.getRows().length,
    getScrollElement: options.getScrollElement,
    estimateSize: () => rowHeight,
    overscan,
    paddingStart,
    scrollPaddingStart: paddingStart,
    getItemKey,
    rangeExtractor,
  })
}

export type SheetColumnVirtualizerOptions = {
  getScrollElement: () => HTMLElement | null
  /** Columns rendered beyond the viewport on each side. Default 2. */
  overscan?: number
  /** Space before the first unpinned column, such as a row number gutter. Default 0. */
  gutterWidth?: number
}

/**
 * A virtualizer over the unpinned ("center") columns. Pinned columns render
 * always, before them. It measures again when a column is resized, and keeps
 * the active cell's column mounted.
 */
export function useSheetColumnVirtualizer<Row extends RowData>(
  sheet: Sheet<Row>,
  options: SheetColumnVirtualizerOptions
) {
  const { overscan = 2, gutterWidth = 0 } = options
  const { table } = sheet
  const start = table.getPinnedLeafColumns("start")
  const center = table.getPinnedLeafColumns("center")
  const pinnedWidth = start.reduce((w, c) => w + c.getSize(), gutterWidth)
  const sizes = center.map((c) => c.getSize()).join(",")
  const rangeExtractor = useCallback(
    (range: Range) => {
      const active = sheet.getActiveRange()?.anchor.columnIndex
      const pinned = sheet.table.getPinnedLeafColumns("start").length
      return keepMounted(range, active === undefined ? active : active - pinned)
    },
    [sheet]
  )
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: center.length,
    getScrollElement: options.getScrollElement,
    estimateSize: (i) => center[i]?.getSize() ?? 0,
    overscan,
    paddingStart: pinnedWidth,
    scrollPaddingStart: pinnedWidth,
    rangeExtractor,
  })
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [sizes, virtualizer])
  return virtualizer
}
