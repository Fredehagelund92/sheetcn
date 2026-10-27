/**
 * One filter condition: a column, one of its type's filters by id, and the
 * texts the filter reads, such as `{ column: "score", op: "lessThan",
 * values: ["0.6"] }`. Values are texts, read by the type the way typed text
 * is, so a condition survives JSON. `not` turns the filter around: "does not
 * contain" is `contains` with `not: true`, and passes empty cells.
 */
export type FilterCondition = {
  column: string
  op: string
  values: readonly string[]
  not?: boolean
}

/**
 * Conditions joined one way: a row passes `"all"` when it passes every
 * item, and `"any"` when it passes at least one. Items may be groups, to any
 * depth. A group with no items that apply is left out, as if it were not
 * there.
 */
export type FilterGroup = {
  match: "all" | "any"
  items: readonly (FilterCondition | FilterGroup)[]
}

/** One sort key. Empty cells go last in both directions. */
export type SortKey = { column: string; dir: "asc" | "desc" }

/**
 * Rows grouped by one column's value. A date groups by its day, or by its
 * month or year with `by`.
 */
export type GroupBy = { column: string; by?: "day" | "month" | "year" }

/**
 * What a sheet shows of its rows: a filter, a sort, a grouping and hidden
 * columns, by column id. It is plain data, so an app can keep it anywhere
 * (the address bar, local storage, its database) and save it as a view.
 * Every part is optional; an empty view shows every row in order.
 */
export type SheetView = {
  filter?: FilterGroup
  /** Sort keys, the first deciding first. */
  sort?: readonly SortKey[]
  group?: GroupBy
  /** Ids of the columns not shown. Their order does not matter. */
  hidden?: readonly string[]
}

/** True for a group, false for a condition. */
export function isFilterGroup(
  item: FilterCondition | FilterGroup
): item is FilterGroup {
  return "items" in item
}

/** Something a view names that cannot apply, and is skipped. */
export type ViewIssue = {
  /** The part of the view. */
  part: "filter" | "sort" | "group"
  /**
   * Where in that part: the positions of the filter item down the tree
   * (`[1, 0]` is the first item of the second item), or of the sort key.
   * Empty for the group.
   */
  path: readonly number[]
  message: string
}

function itemsEqual(
  a: FilterCondition | FilterGroup,
  b: FilterCondition | FilterGroup
): boolean {
  if (isFilterGroup(a) || isFilterGroup(b)) {
    return isFilterGroup(a) && isFilterGroup(b) && groupsEqual(a, b)
  }
  return (
    a.column === b.column &&
    a.op === b.op &&
    Boolean(a.not) === Boolean(b.not) &&
    a.values.length === b.values.length &&
    a.values.every((v, i) => v === b.values[i])
  )
}

function groupsEqual(a: FilterGroup, b: FilterGroup): boolean {
  return (
    a.match === b.match &&
    a.items.length === b.items.length &&
    a.items.every((item, i) => itemsEqual(item, b.items[i] as typeof item))
  )
}

const NO_FILTER: FilterGroup = { match: "all", items: [] }

/**
 * Whether two views show the same thing, for an app that marks a saved view
 * as edited. A missing part equals an empty one, `not: false` equals no
 * `not`, a date grouped by day equals one grouped with no `by`, and hidden
 * columns compare as a set. Filter items and sort keys compare in order.
 */
export function viewsEqual(a: SheetView, b: SheetView): boolean {
  const fa = a.filter?.items.length ? a.filter : NO_FILTER
  const fb = b.filter?.items.length ? b.filter : NO_FILTER
  if (fa !== fb && !groupsEqual(fa, fb)) return false
  const sa = a.sort ?? []
  const sb = b.sort ?? []
  if (
    sa.length !== sb.length ||
    sa.some((k, i) => {
      const other = sb[i] as SortKey
      return k.column !== other.column || k.dir !== other.dir
    })
  ) {
    return false
  }
  if (
    a.group?.column !== b.group?.column ||
    (a.group?.by ?? "day") !== (b.group?.by ?? "day")
  ) {
    return false
  }
  const ha = new Set(a.hidden)
  const hb = new Set(b.hidden)
  return ha.size === hb.size && [...ha].every((id) => hb.has(id))
}
