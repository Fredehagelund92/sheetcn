/**
 * How columns use the width of the grid:
 * - "fixed": each column keeps its width, so the columns may end short of the
 *   grid's right edge.
 * - "fill": each column's width is its minimum, and spare width is shared out
 *   among the columns that grow, so the last column ends at the right edge.
 *   When the minimums do not fit, the grid scrolls as in "fixed".
 */
export type ColumnSizing = "fixed" | "fill"

/** One column, as `fillColumnWidths` reads it. */
export type FillColumn = {
  /** Its width, and the least it is given. */
  width: number
  /** The most it grows to. Default: no limit. */
  maxWidth?: number
  /**
   * Its share of the spare width, against the other columns' weights.
   * Default: its width, so wide columns grow more. 0 means it never grows.
   */
  grow?: number
  /** Pinned columns never grow, so they keep their place while the grid scrolls. */
  pinned?: boolean
}

/**
 * The widths of `columns` when they fill `available` pixels: each column gets
 * its width, and the spare width is shared out in proportion to `grow`, up to
 * each column's `maxWidth`. A column that reaches its limit hands its share on
 * to the others. When the widths add up to `available` or more, they come back
 * as they are, and the grid scrolls.
 *
 * Grown widths are whole pixels and add up to the available width exactly, or
 * fall short of it when every column that grows has reached its limit.
 * `available` excludes anything outside the columns, such as a row number
 * gutter, which never grows.
 */
export function fillColumnWidths(
  available: number,
  columns: readonly FillColumn[]
): number[] {
  const widths = columns.map((c) => c.width)
  let spare = available - sum(widths)
  // Also false for NaN, such as a grid that is not measured yet.
  if (!(spare >= 1)) return widths

  const max = columns.map((c) => c.maxWidth ?? Infinity)
  const weight = columns.map((c) =>
    c.pinned ? 0 : Math.max(0, c.grow ?? c.width)
  )
  let open = columns
    .map((_, i) => i)
    .filter((i) => at(weight, i) > 0 && at(widths, i) < at(max, i))

  while (open.length && spare > 0) {
    const total = open.reduce((s, i) => s + at(weight, i), 0)
    const share = (i: number) => (spare * at(weight, i)) / total
    const capped = open.filter((i) => at(widths, i) + share(i) >= at(max, i))
    if (!capped.length) {
      for (const i of open) widths[i] = at(widths, i) + share(i)
      break
    }
    for (const i of capped) {
      spare -= at(max, i) - at(widths, i)
      widths[i] = at(max, i)
    }
    open = open.filter((i) => !capped.includes(i))
  }
  return wholePixels(columns, widths, max)
}

/**
 * Rounds the grown widths to whole pixels without changing their total by a
 * pixel or more: each is floored (never below the column's own width), and
 * the pixels left over go to the largest remainders, first column first on a
 * tie, never past a column's `maxWidth`.
 */
function wholePixels(
  columns: readonly FillColumn[],
  exact: readonly number[],
  max: readonly number[]
): number[] {
  const widths = exact.slice()
  const grown: { i: number; remainder: number }[] = []
  let left = 0
  for (let i = 0; i < exact.length; i++) {
    const w = at(exact, i)
    const base = (columns[i] as FillColumn).width
    if (w === base) continue
    const floored = Math.max(Math.floor(w), base)
    widths[i] = floored
    left += w - floored
    if (floored + 1 <= at(max, i)) grown.push({ i, remainder: w - floored })
  }
  let pixels = Math.floor(left + 1e-6)
  grown.sort((a, b) => b.remainder - a.remainder || a.i - b.i)
  for (const { i } of grown) {
    if (pixels <= 0) break
    widths[i] = at(widths, i) + 1
    pixels--
  }
  return widths
}

const at = (list: readonly number[], i: number) => list[i] as number
const sum = (list: readonly number[]) => list.reduce((s, n) => s + n, 0)

/** A range of row display indexes, first and last included. */
export type RowSpan = { startIndex: number; endIndex: number }

/**
 * The rows to measure when fitting a column to its content: every row in
 * `visible`, then rows spread evenly over the rest, `limit` in all. With
 * `limit` rows or fewer, every row. Sorted, without repeats.
 */
export function sampleRowIndexes(
  rowCount: number,
  visible: RowSpan | null,
  limit: number
): number[] {
  if (rowCount <= limit) return Array.from({ length: rowCount }, (_, i) => i)
  const picked = new Set<number>()
  if (visible) {
    const first = Math.max(0, visible.startIndex)
    const last = Math.min(rowCount - 1, visible.endIndex)
    for (let i = first; i <= last && picked.size < limit; i++) picked.add(i)
  }
  const spread = limit - picked.size
  for (let k = 0; k < spread; k++) {
    picked.add(
      spread === 1 ? 0 : Math.round((k * (rowCount - 1)) / (spread - 1))
    )
  }
  return [...picked].sort((a, b) => a - b)
}
