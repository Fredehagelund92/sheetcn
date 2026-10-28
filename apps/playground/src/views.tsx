import { viewsEqual, type SheetView } from "@sheetcn/core"
import type { Sheet } from "@sheetcn/react"
import { useEffect, useState } from "react"

// Saved views, kept by the app: the sheet only takes a view and reports
// changes. Each tab shows how many rows its view keeps, and a dot when the
// view shown has been changed from it.

export type SavedView = { name: string; view: SheetView }

const ALL_BUT = (keep: string[]) =>
  [
    "name",
    "code",
    "category",
    "status",
    "price",
    "quantity",
    "discount",
    "ordered",
    "shipped",
    "inStock",
    "country",
    "email",
    "phone",
    "rating",
    "website",
    "region",
    "priority",
    "notes",
    "supplier",
    "rowId",
  ].filter((id) => !keep.includes(id))

export const SAVED_VIEWS: SavedView[] = [
  { name: "All items", view: {} },
  {
    name: "Active, low stock",
    view: {
      filter: {
        match: "all",
        items: [
          { column: "status", op: "isAnyOf", values: ["active"] },
          { column: "quantity", op: "lessThan", values: ["50"] },
        ],
      },
      sort: [{ column: "quantity", dir: "asc" }],
    },
  },
  {
    name: "Paused or archived",
    view: {
      filter: {
        match: "all",
        items: [
          { column: "status", op: "isAnyOf", values: ["paused", "archived"] },
        ],
      },
    },
  },
  {
    name: "Not shipped",
    view: {
      filter: {
        match: "all",
        items: [{ column: "shipped", op: "empty", values: [] }],
      },
      sort: [{ column: "ordered", dir: "asc" }],
    },
  },
  {
    name: "Contacts",
    view: {
      sort: [{ column: "name", dir: "asc" }],
      hidden: ALL_BUT(["name", "email", "phone", "country", "supplier"]),
    },
  },
]

type AnySheet = Sheet<Record<string, unknown>>

/** Counts lag edits by this much, so typing never waits for them. */
const COUNT_DELAY_MS = 800

export function ViewTabs({
  sheet,
  saved,
  current,
  onPick,
  onSave,
}: {
  sheet: AnySheet
  saved: readonly SavedView[]
  /** The saved view last picked. */
  current: number
  onPick: (index: number) => void
  onSave: (index: number, view: SheetView) => void
}) {
  const view = sheet.getView()
  const rows = sheet.store.getRows()
  const [counts, setCounts] = useState<readonly number[] | null>(null)
  useEffect(() => {
    const timer = setTimeout(
      () => setCounts(saved.map((s) => sheet.countRows(s.view))),
      COUNT_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [sheet, saved, rows])
  const picked = saved[current]
  const edited = picked !== undefined && !viewsEqual(view, picked.view)
  return (
    <div role="group" aria-label="Saved views" className="tabs">
      {saved.map((s, i) => (
        <button
          key={s.name}
          type="button"
          className="tab"
          aria-pressed={i === current}
          onClick={() => onPick(i)}
        >
          {s.name}
          <span className="n">
            {counts?.[i]?.toLocaleString("en-US") ?? " "}
          </span>
          {i === current && edited && (
            <i className="mod" role="img" aria-label="edited" />
          )}
        </button>
      ))}
      <span className="sp" />
      {edited && (
        <>
          <button type="button" onClick={() => onPick(current)}>
            Reset
          </button>
          <button
            type="button"
            className="pri"
            onClick={() => onSave(current, view)}
          >
            Save
          </button>
        </>
      )}
    </div>
  )
}
