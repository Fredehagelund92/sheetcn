import { formatCell, resolveColumnType } from "./cells.js"
import { collator } from "./column-types/shared.js"
import { getCellValue } from "./columns.js"
import {
  compileFilter,
  type CompiledFilter,
  type CompileFilterOptions,
  type RowTest,
} from "./filter.js"
import { patchedRows } from "./patch-record.js"
import { ranksFor, sortByRanks, type RankSource } from "./rank-cache.js"
import { indexFor } from "./row-index.js"
import type { CellValue, Column } from "./types.js"
import { isIsoDate } from "./values.js"
import { valueKey } from "./value-index.js"
import type { SheetView, ViewIssue } from "./view.js"

export type ViewModelOptions<Row> = CompileFilterOptions & {
  columns: readonly Column<Row>[]
  /** A pure function of the row. Ids are unique and never change. */
  getRowId: (row: Row) => string
  view?: SheetView
}

/** A run of rows that share one value of the grouped column. */
export type ViewGroup = {
  /**
   * The value the rows share: a cell value, `null` for empty cells, or for
   * a date grouped by month or year its first characters ("2026-10",
   * "2026").
   */
  value: CellValue
  /** The value as text: formatted by the column, "" when empty. */
  label: string
  /** The position of the group's first row in the view's rows. */
  start: number
  /** How many rows the group holds. */
  size: number
}

/**
 * How a result came from the last one, when a few rows were replaced: apply
 * `removed` (positions in the last result's `rows`, from the last to the
 * first), then `inserted` in order (each row is the source row at `source`,
 * put at `at` among the rows as they stand then) to the last result's
 * `rows`, to get this result's.
 */
export type ViewChange<Row> = {
  readonly from: ViewResult<Row>
  readonly removed: readonly number[]
  readonly inserted: readonly { at: number; source: number }[]
}

/** The rows a view shows, worked out for one array of rows. */
export type ViewResult<Row> = {
  /**
   * The rows the view shows, in order: grouped, then sorted, then in their
   * source order. The source array itself when the view filters, sorts and
   * groups nothing.
   */
  readonly rows: readonly Row[]
  /** The groups over `rows`, in order, or null when the view does not group. */
  readonly groups: readonly ViewGroup[] | null
  /** Set when the last result's rows were patched into these. */
  readonly change?: ViewChange<Row>
  /** The source position of the row shown at `position`. */
  sourceIndex(position: number): number
  /** Where the row is shown, or -1 when the filter hides it or it is unknown. */
  indexOf(rowId: string): number
}

/** A view read once against the columns, ready to apply to rows. */
export type ViewModel<Row> = {
  readonly view: SheetView
  /** Parts of the view that cannot apply and are skipped. */
  readonly issues: readonly ViewIssue[]
  /** True when the view filters, sorts or groups, so `rows` may differ. */
  readonly active: boolean
  /**
   * The view over `rows`. The same array gives the same result. An array a
   * patch-only change made from the last one (as `applyChange` makes it)
   * updates in time proportional to the changed rows: each is tested again
   * and moved to where it now belongs. Anything else is worked out afresh.
   */
  compute(rows: readonly Row[]): ViewResult<Row>
}

// Up to this many replaced rows update in place; more are worked out afresh.
const PATCH_LIMIT = 64

/** How to read and order one sort key, or the grouping. */
type Order<Row> = RankSource<Row> & { dir: 1 | -1 }

function compareBy<Row>(order: Order<Row>, a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  const c = order.compare(a, b)
  return c > 0 ? order.dir : c < 0 ? -order.dir : 0
}

/** Puts `item` at `to` and shifts what lies between `from` and `to` by one. */
function move<T>(items: T[], from: number, to: number, item: T): void {
  if (from < to) items.copyWithin(from, from + 1, to + 1)
  else if (to < from) items.copyWithin(to + 1, to, from)
  items[to] = item
}

function readerFor<Row>(column: Column<Row>): (row: Row) => CellValue {
  const key = column.value
  return typeof key === "string"
    ? (row) => (row[key as keyof Row] ?? null) as CellValue
    : (row) => getCellValue(column, row)
}

/**
 * A sort key's order. A type without `compare` orders by formatted text, so
 * the text is what the key reads.
 */
function sortOrder<Row>(column: Column<Row>, dir: 1 | -1): Order<Row> {
  const read = readerFor(column)
  const { def, prepared } = resolveColumnType(column)
  const compare = def.compare
  if (compare) {
    return {
      column,
      variant: "sort",
      read,
      compare: (a, b) => compare(a as never, b as never, prepared),
      dir,
    }
  }
  return {
    column,
    variant: "sort",
    read: (row) => {
      const v = read(row)
      return v === null ? null : formatCell(column, v)
    },
    compare: (a, b) => collator.compare(a as string, b as string),
    dir,
  }
}

type Grouping<Row> = Order<Row> & {
  label(value: CellValue): string
}

function groupingFor<Row>(
  column: Column<Row>,
  by: "day" | "month" | "year" | undefined,
  dir: 1 | -1
): Grouping<Row> {
  const read = readerFor(column)
  const length = by === "month" ? 7 : by === "year" ? 4 : 0
  const { def, prepared } = resolveColumnType(column)
  const typeCompare = def.compare
  const base = (a: unknown, b: unknown) =>
    typeCompare
      ? typeCompare(a as never, b as never, prepared)
      : collator.compare(
          formatCell(column, a as CellValue),
          formatCell(column, b as CellValue)
        )
  return {
    column,
    variant: `group${length}`,
    read: length
      ? (row) => {
          const v = read(row)
          return typeof v === "string" && isIsoDate(v) ? v.slice(0, length) : v
        }
      : read,
    // Values the type orders as equal stay apart, ordered by their keys.
    compare: (a, b) => {
      const c = base(a, b)
      if (c) return c
      const ka = String(valueKey(a as CellValue))
      const kb = String(valueKey(b as CellValue))
      return ka < kb ? -1 : ka > kb ? 1 : 0
    },
    dir,
    label: (value) => {
      if (value === null) return ""
      // A month or a year, which the column's type cannot format.
      if (length && typeof value === "string") return value
      return formatCell(column, value)
    },
  }
}

type State<Row> = {
  source: readonly Row[]
  shown: Row[]
  order: number[]
  groups: ViewGroup[] | null
  result: ViewResult<Row>
}

class Model<Row> implements ViewModel<Row> {
  readonly view: SheetView
  readonly issues: readonly ViewIssue[]
  readonly active: boolean
  readonly #getRowId: (row: Row) => string
  readonly #filter: CompiledFilter<Row>
  readonly #keys: Order<Row>[] = []
  readonly #grouping: Grouping<Row> | null = null
  #state: State<Row> | null = null

  constructor(options: ViewModelOptions<Row>) {
    const view = options.view ?? {}
    this.view = view
    this.#getRowId = options.getRowId
    const issues: ViewIssue[] = []
    this.#filter = compileFilter(view.filter, options.columns, options)
    issues.push(...this.#filter.issues)
    const byId = new Map(options.columns.map((c) => [c.id, c]))
    ;(view.sort ?? []).forEach((key, i) => {
      const column = byId.get(key.column)
      if (!column) {
        issues.push({
          part: "sort",
          path: [i],
          message: `There is no column "${key.column}"`,
        })
        return
      }
      this.#keys.push(sortOrder(column, key.dir === "desc" ? -1 : 1))
    })
    if (view.group) {
      const column = byId.get(view.group.column)
      if (!column) {
        issues.push({
          part: "group",
          path: [],
          message: `There is no column "${view.group.column}"`,
        })
      } else {
        // Groups follow the direction of a sort on the same column.
        const sort = view.sort?.find((k) => k.column === column.id)
        this.#grouping = groupingFor(
          column,
          view.group.by,
          sort?.dir === "desc" ? -1 : 1
        )
      }
    }
    this.issues = issues
    this.active =
      this.#filter.active || this.#keys.length > 0 || this.#grouping !== null
  }

  compute(rows: readonly Row[]): ViewResult<Row> {
    const state = this.#state
    if (state && state.source === rows) return state.result
    if (!this.active) {
      const result = this.#identity(rows)
      this.#state = { source: rows, shown: [], order: [], groups: null, result }
      return result
    }
    const next = (state && this.#patch(state, rows)) ?? this.#build(rows)
    this.#state = next
    return next.result
  }

  #identity(rows: readonly Row[]): ViewResult<Row> {
    const getRowId = this.#getRowId
    return {
      rows,
      groups: null,
      sourceIndex: (position) => position,
      indexOf: (rowId) => indexFor(rows).indexOf(rows, getRowId, rowId),
    }
  }

  /** Orders two rows, given with their source positions. */
  #compare(a: Row, ia: number, b: Row, ib: number): number {
    const g = this.#grouping
    if (g) {
      const c = compareBy(g, g.read(a), g.read(b))
      if (c) return c
    }
    for (const key of this.#keys) {
      const c = compareBy(key, key.read(a), key.read(b))
      if (c) return c
    }
    return ia - ib
  }

  #build(rows: readonly Row[]): State<Row> {
    let passing: number[]
    if (this.#filter.active) {
      const test = this.#filter.bind(rows)
      passing = []
      for (let i = 0; i < rows.length; i++) {
        if (test(rows[i] as Row, i)) passing.push(i)
      }
    } else {
      passing = Array.from({ length: rows.length }, (_, i) => i)
    }

    const g = this.#grouping
    if (!g && !this.#keys.length) {
      return this.#snapshot(
        rows,
        passing.map((i) => rows[i] as Row),
        passing,
        null
      )
    }
    // Stable counting sorts on each key's ranks, the last key first and the
    // grouping last, so the first key decides first and ties keep the
    // source order.
    let current = Int32Array.from(passing)
    let spare = new Int32Array(current.length)
    const passes = [...this.#keys].reverse()
    if (g) passes.push(g)
    let groupRanks: Int32Array | null = null
    for (const o of passes) {
      const ranks = ranksFor(rows, o)
      sortByRanks(current, ranks.ranks, ranks, o.dir, spare)
      ;[current, spare] = [spare, current]
      if (o === g) groupRanks = ranks.ranks
    }
    const order = Array.from(current)
    const shown = order.map((i) => rows[i] as Row)
    const groups =
      g && groupRanks ? this.#groupsOf(shown, order, groupRanks) : null
    return this.#snapshot(rows, shown, order, groups)
  }

  #groupsOf(
    shown: readonly Row[],
    order: readonly number[],
    ranks: Int32Array
  ): ViewGroup[] {
    const g = this.#grouping as Grouping<Row>
    const groups: ViewGroup[] = []
    let rank = NaN
    for (let p = 0; p < shown.length; p++) {
      const r = ranks[order[p] as number] as number
      const last = groups.at(-1)
      if (last && r === rank) {
        last.size++
      } else {
        const value = g.read(shown[p] as Row) as CellValue
        groups.push({ value, label: g.label(value), start: p, size: 1 })
        rank = r
      }
    }
    return groups
  }

  /**
   * The state for `rows` from the last one, when `rows` replaced at most a
   * few rows of the last array in place; otherwise null.
   */
  #patch(state: State<Row>, rows: readonly Row[]): State<Row> | null {
    const before = state.source
    if (before.length !== rows.length) return null
    // `applyChange` says which rows it replaced; any other array is compared.
    let changed: readonly number[]
    const patched = patchedRows(rows, before)
    if (patched) {
      if (patched.length > PATCH_LIMIT) return null
      changed = patched.toSorted((a, b) => a - b)
    } else {
      const found: number[] = []
      for (let i = 0; i < rows.length; i++) {
        if (rows[i] !== before[i]) {
          if (found.length === PATCH_LIMIT) return null
          found.push(i)
        }
      }
      changed = found
    }
    if (!changed.length) {
      return this.#snapshot(rows, state.shown, state.order, state.groups, {
        from: state.result,
        removed: [],
        inserted: [],
      })
    }
    const one = changed.length === 1 ? this.#moveOne(state, rows, changed[0] as number) : null
    if (one) return one
    const shown = state.shown.slice()
    const order = state.order.slice()
    const groups = state.groups?.map((group) => ({ ...group })) ?? null

    // Take every replaced row out, then put each new row where it belongs.
    const out: number[] = []
    for (const i of changed) {
      const p = this.#find(shown, order, before[i] as Row, i)
      if (p >= 0) out.push(p)
    }
    out.sort((a, b) => b - a)
    for (const p of out) {
      if (groups) this.#leaveGroup(groups, p)
      shown.splice(p, 1)
      order.splice(p, 1)
    }
    const test: RowTest<Row> = this.#filter.bind(rows)
    const inserted: { at: number; source: number }[] = []
    for (const i of changed) {
      const row = rows[i] as Row
      if (!test(row, i)) continue
      const p = this.#insertAt(shown, order, row, i)
      shown.splice(p, 0, row)
      order.splice(p, 0, i)
      inserted.push({ at: p, source: i })
      if (groups) this.#joinGroup(groups, row, p)
    }
    return this.#snapshot(rows, shown, order, groups, {
      from: state.result,
      removed: out,
      inserted,
    })
  }

  /**
   * The state after one shown row was replaced by one that is still shown:
   * the row moves to where it now belongs with one copy of each array, not
   * a copy and two splices. Null when the row was hidden or the new one is.
   */
  #moveOne(state: State<Row>, rows: readonly Row[], i: number): State<Row> | null {
    const row = rows[i] as Row
    const p = this.#find(state.shown, state.order, state.source[i] as Row, i)
    if (p < 0 || !this.#filter.bind(rows)(row, i)) return null
    const q = this.#insertAt(state.shown, state.order, row, i, p)
    const shown = state.shown.slice()
    const order = state.order.slice()
    move(shown, p, q, row)
    move(order, p, q, i)
    let groups: ViewGroup[] | null = null
    if (state.groups) {
      groups = state.groups.map((group) => ({ ...group }))
      this.#leaveGroup(groups, p)
      this.#joinGroup(groups, row, q)
    }
    return this.#snapshot(rows, shown, order, groups, {
      from: state.result,
      removed: [p],
      inserted: [{ at: q, source: i }],
    })
  }

  /** The position of the row shown from source position `i`, or -1. */
  #find(shown: readonly Row[], order: readonly number[], row: Row, i: number) {
    let lo = 0
    let hi = shown.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const c = this.#compare(shown[mid] as Row, order[mid] as number, row, i)
      if (c < 0) lo = mid + 1
      else if (c > 0) hi = mid
      else return order[mid] === i ? mid : -1
    }
    return -1
  }

  /**
   * Where a row from source position `i` goes among the shown rows, as they
   * stand without the one at `skip`, when there is one.
   */
  #insertAt(
    shown: readonly Row[],
    order: readonly number[],
    row: Row,
    i: number,
    skip = -1
  ): number {
    let lo = 0
    let hi = shown.length - (skip < 0 ? 0 : 1)
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const at = skip >= 0 && mid >= skip ? mid + 1 : mid
      if (this.#compare(shown[at] as Row, order[at] as number, row, i) < 0) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return lo
  }

  /** Takes the row at `position` out of its group. */
  #leaveGroup(groups: ViewGroup[], position: number): void {
    let lo = 0
    let hi = groups.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((groups[mid] as ViewGroup).start <= position) lo = mid
      else hi = mid - 1
    }
    const group = groups[lo] as ViewGroup
    group.size--
    for (let k = lo + 1; k < groups.length; k++)
      (groups[k] as ViewGroup).start--
    if (group.size === 0) groups.splice(lo, 1)
  }

  /** Counts a row just placed at `position` into its group. */
  #joinGroup(groups: ViewGroup[], row: Row, position: number): void {
    const g = this.#grouping as Grouping<Row>
    const value = g.read(row) as CellValue
    let lo = 0
    let hi = groups.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (compareBy(g, (groups[mid] as ViewGroup).value, value) < 0) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    const found = groups[lo]
    if (found && compareBy(g, found.value, value) === 0) {
      found.size++
    } else {
      groups.splice(lo, 0, {
        value,
        label: g.label(value),
        start: position,
        size: 1,
      })
    }
    for (let k = lo + 1; k < groups.length; k++)
      (groups[k] as ViewGroup).start++
  }

  #snapshot(
    source: readonly Row[],
    shown: Row[],
    order: number[],
    groups: ViewGroup[] | null,
    change?: ViewChange<Row>
  ): State<Row> {
    const getRowId = this.#getRowId
    let positions: Int32Array | null = null
    const result: ViewResult<Row> = {
      rows: shown,
      groups,
      ...(change ? { change } : {}),
      sourceIndex: (position) => order[position] ?? -1,
      indexOf: (rowId) => {
        const i = indexFor(source).indexOf(source, getRowId, rowId)
        if (i < 0) return -1
        if (!positions) {
          positions = new Int32Array(source.length).fill(-1)
          for (let p = 0; p < order.length; p++) {
            positions[order[p] as number] = p
          }
        }
        return positions[i] as number
      },
    }
    return { source, shown, order, groups, result }
  }
}

/**
 * Reads a view (filter, sort and group) once against the columns, ready to
 * work out which rows it shows, in what order, for each new array of rows.
 * Parts of the view that cannot apply, such as a sort on a removed column,
 * are skipped and listed in `issues`. Relative dates read today when the
 * model is made: make a new one to move to the next day.
 */
export function createViewModel<Row>(
  options: ViewModelOptions<Row>
): ViewModel<Row> {
  return new Model(options)
}
