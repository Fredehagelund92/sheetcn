// What `applyChange` replaced, kept per row array, so a reader that follows
// the arrays one change at a time (the view model, the row models of the
// React package) finds the changed rows without comparing every row.
const records = new WeakMap<
  readonly unknown[],
  { from: readonly unknown[]; changed: readonly number[] }
>()

/**
 * Notes that `to` is `from` with the rows at `changed` replaced in place.
 * The record of `from` goes: readers only move forward, and a chain of
 * records would keep every old array alive.
 */
export function recordPatch(
  from: readonly unknown[],
  to: readonly unknown[],
  changed: readonly number[]
): void {
  records.delete(from)
  records.set(to, { from, changed })
}

/**
 * The positions of the rows `rows` replaced in `from`, when `rows` is `from`
 * with a few rows replaced in place by `applyChange`; otherwise null, and the
 * two arrays have to be compared.
 */
export function patchedRows(
  rows: readonly unknown[],
  from: readonly unknown[]
): readonly number[] | null {
  const record = records.get(rows)
  return record?.from === from ? record.changed : null
}
