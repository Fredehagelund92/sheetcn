/**
 * A selected rectangle, stored as its two corners by row and column id. The
 * anchor stays put while the focus moves (shift-extend, drag), and the anchor
 * of the last range is the active cell. The same shape as TanStack Table's
 * `CellSelectionRange`, so either side can hold the selection.
 */
export type CellRange = {
  anchorRowId: string
  anchorColumnId: string
  focusRowId: string
  focusColumnId: string
  /** How the range changes the selection of the ranges before it. Default "include". */
  operation?: "include" | "exclude"
}

/** A cell position in display order, 0-based. */
export type CellIndex = { rowIndex: number; columnIndex: number }

/**
 * An inclusive rectangle of display-order indexes. The same shape as TanStack
 * Table's `CellSelectionBounds`.
 */
export type CellRect = {
  minRowIndex: number
  maxRowIndex: number
  minColumnIndex: number
  maxColumnIndex: number
}

/** The active range by position: the anchor is the active cell. */
export type ActiveRange = { anchor: CellIndex; focus: CellIndex }

export type Direction = "up" | "down" | "left" | "right"

/** Which sides of a selected cell lie on the outline of the selection. */
export type CellEdges = {
  top: boolean
  right: boolean
  bottom: boolean
  left: boolean
}

/** The rectangle with two cells as opposite corners. */
export function rectFromCorners(a: CellIndex, b: CellIndex): CellRect {
  return {
    minRowIndex: Math.min(a.rowIndex, b.rowIndex),
    maxRowIndex: Math.max(a.rowIndex, b.rowIndex),
    minColumnIndex: Math.min(a.columnIndex, b.columnIndex),
    maxColumnIndex: Math.max(a.columnIndex, b.columnIndex),
  }
}

export function rectContains(
  rect: CellRect,
  rowIndex: number,
  columnIndex: number
): boolean {
  return (
    rowIndex >= rect.minRowIndex &&
    rowIndex <= rect.maxRowIndex &&
    columnIndex >= rect.minColumnIndex &&
    columnIndex <= rect.maxColumnIndex
  )
}

export function rectsContain(
  rects: readonly CellRect[],
  rowIndex: number,
  columnIndex: number
): boolean {
  for (const rect of rects) {
    if (rectContains(rect, rowIndex, columnIndex)) return true
  }
  return false
}

/** The overlap of two rectangles, or null. */
export function intersectRects(a: CellRect, b: CellRect): CellRect | null {
  const rect = {
    minRowIndex: Math.max(a.minRowIndex, b.minRowIndex),
    maxRowIndex: Math.min(a.maxRowIndex, b.maxRowIndex),
    minColumnIndex: Math.max(a.minColumnIndex, b.minColumnIndex),
    maxColumnIndex: Math.min(a.maxColumnIndex, b.maxColumnIndex),
  }
  return rect.minRowIndex <= rect.maxRowIndex &&
    rect.minColumnIndex <= rect.maxColumnIndex
    ? rect
    : null
}

/** The number of cells in a rectangle. */
export function rectArea(rect: CellRect): number {
  return (
    (rect.maxRowIndex - rect.minRowIndex + 1) *
    (rect.maxColumnIndex - rect.minColumnIndex + 1)
  )
}

/** The smallest rectangle that holds every rectangle, or null for none. */
export function boundingRect(rects: readonly CellRect[]): CellRect | null {
  const [first, ...rest] = rects
  if (!first) return null
  const out = { ...first }
  for (const r of rest) {
    out.minRowIndex = Math.min(out.minRowIndex, r.minRowIndex)
    out.maxRowIndex = Math.max(out.maxRowIndex, r.maxRowIndex)
    out.minColumnIndex = Math.min(out.minColumnIndex, r.minColumnIndex)
    out.maxColumnIndex = Math.max(out.maxColumnIndex, r.maxColumnIndex)
  }
  return out
}

/** `rect` minus `cut`, as up to four disjoint rectangles. */
function subtractRect(rect: CellRect, cut: CellRect): CellRect[] {
  const overlap = intersectRects(rect, cut)
  if (!overlap) return [rect]
  const out: CellRect[] = []
  // Full-width bands above and below the overlap, then the sides beside it.
  if (rect.minRowIndex < overlap.minRowIndex) {
    out.push({ ...rect, maxRowIndex: overlap.minRowIndex - 1 })
  }
  if (overlap.maxRowIndex < rect.maxRowIndex) {
    out.push({ ...rect, minRowIndex: overlap.maxRowIndex + 1 })
  }
  const band = {
    minRowIndex: overlap.minRowIndex,
    maxRowIndex: overlap.maxRowIndex,
  }
  if (rect.minColumnIndex < overlap.minColumnIndex) {
    out.push({
      ...band,
      minColumnIndex: rect.minColumnIndex,
      maxColumnIndex: overlap.minColumnIndex - 1,
    })
  }
  if (overlap.maxColumnIndex < rect.maxColumnIndex) {
    out.push({
      ...band,
      minColumnIndex: overlap.maxColumnIndex + 1,
      maxColumnIndex: rect.maxColumnIndex,
    })
  }
  return out
}

const byPosition = (a: CellRect, b: CellRect) =>
  a.minRowIndex - b.minRowIndex ||
  a.minColumnIndex - b.minColumnIndex ||
  a.maxRowIndex - b.maxRowIndex ||
  a.maxColumnIndex - b.maxColumnIndex

/**
 * Resolves ordered ranges into the selected cells, as disjoint rectangles in
 * row-major order. An "exclude" range removes cells from the ranges before
 * it. A range whose row or column no longer resolves (the index function
 * returns -1) is skipped, not clamped.
 */
export function resolveRanges(
  ranges: readonly CellRange[],
  rowIndexOf: (rowId: string) => number,
  columnIndexOf: (columnId: string) => number
): CellRect[] {
  let selected: CellRect[] = []
  for (const range of ranges) {
    const rect = rangeToRect(range, rowIndexOf, columnIndexOf)
    if (!rect) continue
    if (range.operation === "exclude") {
      selected = selected.flatMap((r) => subtractRect(r, rect))
      continue
    }
    // Keep only the parts of the new rectangle not selected yet.
    let parts = [rect]
    for (const r of selected) parts = parts.flatMap((p) => subtractRect(p, r))
    selected.push(...parts)
  }
  return selected.sort(byPosition)
}

/** A range by position, or null when a corner no longer resolves. */
export function rangeToRect(
  range: CellRange,
  rowIndexOf: (rowId: string) => number,
  columnIndexOf: (columnId: string) => number
): CellRect | null {
  const anchor = {
    rowIndex: rowIndexOf(range.anchorRowId),
    columnIndex: columnIndexOf(range.anchorColumnId),
  }
  const focus = {
    rowIndex: rowIndexOf(range.focusRowId),
    columnIndex: columnIndexOf(range.focusColumnId),
  }
  if (
    anchor.rowIndex < 0 ||
    anchor.columnIndex < 0 ||
    focus.rowIndex < 0 ||
    focus.columnIndex < 0
  ) {
    return null
  }
  return rectFromCorners(anchor, focus)
}

/** The range for an active range by position, through the ids at each index. */
export function rangeFromIndexes(
  active: ActiveRange,
  rowIdAt: (rowIndex: number) => string,
  columnIdAt: (columnIndex: number) => string
): CellRange {
  return {
    anchorRowId: rowIdAt(active.anchor.rowIndex),
    anchorColumnId: columnIdAt(active.anchor.columnIndex),
    focusRowId: rowIdAt(active.focus.rowIndex),
    focusColumnId: columnIdAt(active.focus.columnIndex),
  }
}

/**
 * Which sides of a cell lie on the selection outline: the side's neighbour is
 * not selected. All false when the cell itself is not selected.
 */
export function cellEdges(
  rects: readonly CellRect[],
  rowIndex: number,
  columnIndex: number
): CellEdges {
  if (!rectsContain(rects, rowIndex, columnIndex)) {
    return { top: false, right: false, bottom: false, left: false }
  }
  return {
    top: !rectsContain(rects, rowIndex - 1, columnIndex),
    right: !rectsContain(rects, rowIndex, columnIndex + 1),
    bottom: !rectsContain(rects, rowIndex + 1, columnIndex),
    left: !rectsContain(rects, rowIndex, columnIndex - 1),
  }
}

/**
 * A key for everything the selection draws on one row: which cells are
 * selected, the outline edges (they depend on the rows above and below), and
 * the active cell's column when it is on this row. A memoized row re-renders
 * only when its key changes, so moving the selection repaints the few rows it
 * touches instead of every visible row. "" when the selection draws nothing
 * on the row.
 */
export function rowSelectionKey(
  rects: readonly CellRect[],
  rowIndex: number,
  active: CellIndex | null
): string {
  let key = ""
  for (const r of rects) {
    if (r.maxRowIndex < rowIndex - 1 || r.minRowIndex > rowIndex + 1) continue
    // Rows relative to this one, clamped to the window -1..1.
    const top = Math.max(r.minRowIndex, rowIndex - 1) - rowIndex
    const bottom = Math.min(r.maxRowIndex, rowIndex + 1) - rowIndex
    key += `${top},${bottom},${r.minColumnIndex},${r.maxColumnIndex};`
  }
  if (active?.rowIndex === rowIndex) key += `@${active.columnIndex}`
  return key
}

/** The size of the grid, and how far one page moves. */
export type GridSize = {
  rowCount: number
  columnCount: number
  /** Rows moved by PageUp and PageDown: the rows that fit in the viewport. */
  pageRows: number
  /** Columns moved by Alt+PageUp and Alt+PageDown. */
  pageColumns: number
}

/**
 * True when a cell holds no value. Lets a jump to the edge stop at the edge
 * of the data, as spreadsheets do.
 */
export type IsBlank = (rowIndex: number, columnIndex: number) => boolean

const DELTA: Record<Direction, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n))

/** The cell `by` steps away in a direction, stopping at the grid edge. */
export function stepCell(
  from: CellIndex,
  direction: Direction,
  size: Pick<GridSize, "rowCount" | "columnCount">,
  by = 1
): CellIndex {
  const [dr, dc] = DELTA[direction]
  return {
    rowIndex: clamp(from.rowIndex + dr * by, size.rowCount - 1),
    columnIndex: clamp(from.columnIndex + dc * by, size.columnCount - 1),
  }
}

/**
 * The cell a Ctrl or Cmd + arrow jump lands on. Without `isBlank` it is the
 * grid edge. With it, the jump follows the spreadsheet rule: from a filled
 * cell whose neighbour is filled, go to the last filled cell of that run;
 * otherwise go to the next filled cell, or the grid edge when there is none.
 */
export function jumpCell(
  from: CellIndex,
  direction: Direction,
  size: Pick<GridSize, "rowCount" | "columnCount">,
  isBlank?: IsBlank
): CellIndex {
  const [dr, dc] = DELTA[direction]
  const inGrid = (r: number, c: number) =>
    r >= 0 && r < size.rowCount && c >= 0 && c < size.columnCount
  const edge = stepCell(
    from,
    direction,
    size,
    dr ? size.rowCount : size.columnCount
  )
  if (!isBlank) return edge
  let r = from.rowIndex + dr
  let c = from.columnIndex + dc
  if (!inGrid(r, c)) return edge
  if (!isBlank(from.rowIndex, from.columnIndex) && !isBlank(r, c)) {
    // Inside a run of filled cells: stop at its last cell.
    while (inGrid(r + dr, c + dc) && !isBlank(r + dr, c + dc)) {
      r += dr
      c += dc
    }
    return { rowIndex: r, columnIndex: c }
  }
  while (inGrid(r, c)) {
    if (!isBlank(r, c)) return { rowIndex: r, columnIndex: c }
    r += dr
    c += dc
  }
  return edge
}

/** A selection movement, as produced by the keyboard map. */
export type Navigation =
  | { type: "move"; direction: Direction; extend: boolean }
  | { type: "jump"; direction: Direction; extend: boolean }
  | { type: "page"; direction: Direction; extend: boolean }
  | { type: "rowStart" | "rowEnd"; extend: boolean }
  | { type: "gridStart" | "gridEnd"; extend: boolean }
  | { type: "selectAll" }
  | { type: "selectRows" }
  | { type: "selectColumns" }
  | { type: "collapse" }

/**
 * The active range after a movement. A move collapses to one cell at the new
 * position; an extend keeps the anchor (the active cell) and moves the focus.
 * With nothing selected, any movement selects the first cell. Returns null
 * for an empty grid.
 */
export function navigate(
  active: ActiveRange | null,
  nav: Navigation,
  size: GridSize,
  isBlank?: IsBlank
): ActiveRange | null {
  if (size.rowCount <= 0 || size.columnCount <= 0) return null
  const lastRow = size.rowCount - 1
  const lastColumn = size.columnCount - 1
  if (nav.type === "selectAll") {
    return {
      anchor: { rowIndex: 0, columnIndex: 0 },
      focus: { rowIndex: lastRow, columnIndex: lastColumn },
    }
  }
  if (!active) {
    const first = { rowIndex: 0, columnIndex: 0 }
    return { anchor: first, focus: first }
  }
  const { anchor, focus } = active
  switch (nav.type) {
    case "collapse":
      return { anchor, focus: anchor }
    case "selectRows":
      return {
        anchor: { rowIndex: anchor.rowIndex, columnIndex: 0 },
        focus: { rowIndex: focus.rowIndex, columnIndex: lastColumn },
      }
    case "selectColumns":
      return {
        anchor: { rowIndex: 0, columnIndex: anchor.columnIndex },
        focus: { rowIndex: lastRow, columnIndex: focus.columnIndex },
      }
  }
  // An extend moves the focus corner; a move starts from the active cell.
  const from = nav.extend ? focus : anchor
  let to: CellIndex
  switch (nav.type) {
    case "move":
      to = stepCell(from, nav.direction, size)
      break
    case "jump":
      to = jumpCell(from, nav.direction, size, isBlank)
      break
    case "page": {
      const vertical = nav.direction === "up" || nav.direction === "down"
      const by = Math.max(1, vertical ? size.pageRows : size.pageColumns)
      to = stepCell(from, nav.direction, size, by)
      break
    }
    case "rowStart":
      to = { rowIndex: from.rowIndex, columnIndex: 0 }
      break
    case "rowEnd":
      to = { rowIndex: from.rowIndex, columnIndex: lastColumn }
      break
    case "gridStart":
      to = { rowIndex: 0, columnIndex: 0 }
      break
    case "gridEnd":
      to = { rowIndex: lastRow, columnIndex: lastColumn }
      break
  }
  return nav.extend ? { anchor, focus: to } : { anchor: to, focus: to }
}
