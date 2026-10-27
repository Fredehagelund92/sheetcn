import { valueKey } from "./value-index.js"
import type { CellValue } from "./types.js"

/** One way to order a column's values, which ranks are kept for. */
export type RankSource<Row> = {
  /** Identifies the column and the order: ranks are kept per pair. */
  column: object
  variant: string
  read(this: void, row: Row): unknown
  /** Orders two non-empty values. */
  compare(this: void, a: unknown, b: unknown): number
}

/**
 * Each row's place in the column's order: values that compare equal share a
 * rank, from 0 up to `levels - 1`, and empty cells are -1.
 */
export type Ranks = { ranks: Int32Array; levels: number }

type Entry = {
  column: object
  variant: string
  read(this: void, row: unknown): unknown
  ranks: Ranks
}

// Per row array. A patch-only change hands them on to the array it produces,
// less any whose values it changed (see `handOverRanks`).
const caches = new WeakMap<readonly unknown[], Entry[]>()

// Up to this many distinct values are sorted once and looked up per row;
// with more, the rows are sorted instead, which skips the lookups.
const FEW = 1024

// A row position as two characters at the end of its key, so that sorting
// the keys gives the positions back. Positions below 2^25 fit.
const TAG = 0x100

/**
 * Puts texts in nearly their final order with the engine's own string sort,
 * on lower-case keys made once per row, so the sort through `compare` that
 * follows finds them almost in order and needs about one comparison per row.
 * The order it gives is the comparator's alone: this only saves it work.
 */
function presort(filled: number[], values: readonly unknown[]): void {
  for (const i of filled) if (typeof values[i] !== "string") return
  const keyed = filled.map(
    (i) =>
      (values[i] as string).toLowerCase() +
      String.fromCharCode(TAG + (i >>> 9), TAG + (i & 511))
  )
  keyed.sort()
  for (let j = 0; j < keyed.length; j++) {
    const k = keyed[j] as string
    filled[j] =
      ((k.charCodeAt(k.length - 2) - TAG) << 9) |
      (k.charCodeAt(k.length - 1) - TAG)
  }
}

function build<Row>(rows: readonly Row[], source: RankSource<Row>): Ranks {
  const n = rows.length
  const compare = source.compare
  const values = new Array<unknown>(n)
  let distinct: Map<unknown, unknown> | null = new Map()
  for (let i = 0; i < n; i++) {
    const v = source.read(rows[i] as Row)
    values[i] = v
    if (v !== null && distinct) {
      const k = valueKey(v as CellValue)
      if (!distinct.has(k)) {
        distinct.set(k, v)
        if (distinct.size > FEW) distinct = null
      }
    }
  }
  const ranks = new Int32Array(n)
  let level = -1
  if (distinct) {
    const sorted = [...distinct.values()].sort(compare)
    const rankOf = new Map<unknown, number>()
    sorted.forEach((v, j) => {
      if (j === 0 || compare(sorted[j - 1], v) !== 0) level++
      rankOf.set(valueKey(v as CellValue), level)
    })
    for (let i = 0; i < n; i++) {
      const v = values[i]
      ranks[i] =
        v === null ? -1 : (rankOf.get(valueKey(v as CellValue)) as number)
    }
    return { ranks, levels: level + 1 }
  }
  const filled: number[] = []
  for (let i = 0; i < n; i++) {
    if (values[i] === null) ranks[i] = -1
    else filled.push(i)
  }
  presort(filled, values)
  filled.sort((x, y) => compare(values[x], values[y]))
  let previous: unknown
  for (let j = 0; j < filled.length; j++) {
    const i = filled[j] as number
    const v = values[i]
    if (j === 0 || (v !== previous && compare(previous, v) !== 0)) level++
    ranks[i] = level
    previous = v
  }
  return { ranks, levels: level + 1 }
}

/**
 * The ranks of a column's values over a row array, in the order `source`
 * gives: built on first use (one sort) and kept with the array, so sorting
 * by the column again costs no comparisons.
 */
export function ranksFor<Row>(
  rows: readonly Row[],
  source: RankSource<Row>
): Ranks {
  let entries = caches.get(rows)
  if (!entries) {
    entries = []
    caches.set(rows, entries)
  }
  const found = entries.find(
    (e) => e.column === source.column && e.variant === source.variant
  )
  if (found) return found.ranks
  const ranks = build(rows, source)
  entries.push({
    column: source.column,
    variant: source.variant,
    read: source.read,
    ranks,
  })
  return ranks
}

/**
 * Passes the ranks of `from` on to `to`, the array a change produced from
 * it. `rows` lists each replaced row as it was and as it is, or is null when
 * rows moved, which drops them all. Ranks of a column whose value changed in
 * any replaced row are dropped, since a new value can reorder every rank;
 * the rest carry over. `from` loses them either way.
 */
export function handOverRanks<Row>(
  from: readonly Row[],
  to: readonly Row[],
  rows: (() => Iterable<readonly [Row, Row]>) | null
): void {
  const entries = caches.get(from)
  if (!entries) return
  caches.delete(from)
  if (rows === null) return
  const changed = [...rows()]
  const kept = entries.filter((e) =>
    changed.every(([before, after]) => {
      const a = e.read(before)
      const b = e.read(after)
      return a === b || valueKey(a as CellValue) === valueKey(b as CellValue)
    })
  )
  if (kept.length) caches.set(to, kept)
}

/**
 * Sorts positions by ranks, stably, in one counting pass: ascending, or
 * descending with `dir` -1; empty cells last either way.
 */
export function sortByRanks(
  order: Int32Array,
  values: Int32Array,
  { levels }: Ranks,
  dir: 1 | -1,
  into: Int32Array
): void {
  // Bucket b holds rank b ascending (or levels - 1 - b descending); the last
  // bucket holds empty cells.
  const counts = new Int32Array(levels + 2)
  const bucket = (r: number) => (r < 0 ? levels : dir > 0 ? r : levels - 1 - r)
  for (let p = 0; p < order.length; p++) {
    const b = bucket(values[order[p] as number] as number) + 1
    counts[b] = (counts[b] as number) + 1
  }
  for (let b = 1; b < counts.length; b++) {
    counts[b] = (counts[b] as number) + (counts[b - 1] as number)
  }
  for (let p = 0; p < order.length; p++) {
    const i = order[p] as number
    const b = bucket(values[i] as number)
    into[counts[b] as number] = i
    counts[b] = (counts[b] as number) + 1
  }
}
