import { fold } from "./column-types/shared.js"
import { getCellValue } from "./columns.js"
import type { Column } from "./types.js"

/** Gives the words of a value, for a text filter. */
type TextOf = (value: never, prepared: never) => string

type Entry = {
  column: object
  text: TextOf
  /**
   * The folded text of each row by position: `null` for an empty cell,
   * `undefined` until a filter first reads it.
   */
  folded: (string | null | undefined)[]
}

// Per row array, per column and text function. A patch-only change hands
// its caches on to the array it produces (see `handOverTextCaches`).
const caches = new WeakMap<readonly unknown[], Entry[]>()

/**
 * The folded text of one column's cells over a row array, as text filters
 * match it: read by position, folded on first read and kept with the array.
 */
export function foldedTextFor<Row>(
  rows: readonly Row[],
  column: Column<Row>,
  text: TextOf,
  prepared: unknown
): (row: Row, index: number) => string | null {
  let entries = caches.get(rows)
  if (!entries) {
    entries = []
    caches.set(rows, entries)
  }
  let entry = entries.find((e) => e.column === column && e.text === text)
  if (!entry) {
    entry = {
      column,
      text,
      folded: new Array<string | null | undefined>(rows.length),
    }
    entries.push(entry)
  }
  const { folded } = entry
  const words = text as (value: unknown, prepared: unknown) => string
  return (row, index) => {
    let f = folded[index]
    if (f === undefined) {
      const value = getCellValue(column, row)
      f = folded[index] = value === null ? null : fold(words(value, prepared))
    }
    return f
  }
}

/**
 * Passes the text caches of `from` on to `to`, the array a change produced
 * from it. `patched` lists the positions whose rows the change replaced, or
 * is null when rows moved, which drops the caches. `from` loses them either
 * way and folds again on its next use.
 */
export function handOverTextCaches(
  from: readonly unknown[],
  to: readonly unknown[],
  patched: Iterable<number> | null
): void {
  const entries = caches.get(from)
  if (!entries) return
  caches.delete(from)
  if (patched === null) return
  for (const p of patched) {
    for (const entry of entries) entry.folded[p] = undefined
  }
  caches.set(to, entries)
}
