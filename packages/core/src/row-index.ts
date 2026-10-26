/**
 * Row id to position, kept per row array. Positions below `validUpTo` are
 * known to be right; the rest are rebuilt on the first lookup that needs them.
 * A change hands its index on to the array it produces, so a patch costs no
 * rebuild and an insert or remove only marks the positions after it as stale.
 */
export class RowIndex {
  readonly positions = new Map<string, number>()
  validUpTo = 0
  /** Bumped by every insert or remove; arrays indexed at an older one rebuild. */
  generation = 0

  indexOf<Row>(
    rows: readonly Row[],
    getRowId: (row: Row) => string,
    rowId: string
  ): number {
    const p = this.positions.get(rowId)
    if (p !== undefined && p < this.validUpTo) return p
    if (this.validUpTo >= rows.length) return -1
    this.#refresh(rows, getRowId)
    return this.positions.get(rowId) ?? -1
  }

  /** Marks every position from `index` on as stale. */
  invalidateFrom(index: number): void {
    this.validUpTo = Math.min(this.validUpTo, index)
  }

  #refresh<Row>(rows: readonly Row[], getRowId: (row: Row) => string): void {
    for (let i = this.validUpTo; i < rows.length; i++) {
      const id = getRowId(rows[i] as Row)
      const seen = this.positions.get(id)
      if (
        seen !== undefined &&
        seen !== i &&
        seen < rows.length &&
        getRowId(rows[seen] as Row) === id
      ) {
        throw new Error(`Two rows have the id "${id}"`)
      }
      this.positions.set(id, i)
    }
    this.validUpTo = rows.length
  }
}

const indexes = new WeakMap<
  readonly unknown[],
  { index: RowIndex; generation: number }
>()

/** The index for a row array, created empty (and filled lazily) on first use. */
export function indexFor(rows: readonly unknown[]): RowIndex {
  const entry = indexes.get(rows)
  if (entry && entry.generation === entry.index.generation) return entry.index
  const index = new RowIndex()
  indexes.set(rows, { index, generation: 0 })
  return index
}

/**
 * Passes the index of `from` on to `to`, the array a change produced from it.
 * A patch keeps every position, so both arrays share the index. An insert or
 * remove passes `stale`, the first position that moved: the index is marked
 * from there on, and `from` gets a fresh index on its next lookup.
 */
export function handOverIndex(
  from: readonly unknown[],
  to: readonly unknown[],
  stale?: number
): RowIndex {
  const index = indexFor(from)
  if (stale !== undefined) {
    index.generation++
    index.invalidateFrom(stale)
  }
  indexes.set(to, { index, generation: index.generation })
  return index
}
