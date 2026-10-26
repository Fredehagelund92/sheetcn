# sheetcn

A customizable spreadsheet and data-table component for React and shadcn/ui. MIT licensed.

## Status

Early work. Nothing is published to npm yet, and there is no component to install.

What exists today:

- The headless core, `@sheetcn/core`: the column schema, cell values (parse, format, validate), a row store with transactions and undo, selection geometry and the keyboard map.
- The groundwork of the React binding, `@sheetcn/react`: `useSheet` wires the store to TanStack Table cell selection and TanStack Virtual, with keyboard commands, editing state and pointer selection.
- A playground app that shows the binding at 100,000 rows and measures commits.

Not built yet: clipboard and paste planning, fill, the shadcn registry with the grid views, and the docs.

The plan: one headless core and a React binding on npm, with the grid markup and styles installed from a shadcn registry, in two presets (`table` and `sheet`).

## Packages

| Package           | What it is                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | `@sheetcn/core`. Plain TypeScript: schema, values, store and history, selection geometry, keyboard map. No React, no DOM.  |
| `packages/react`  | `@sheetcn/react`. The React binding: `useSheet` (TanStack Table and Virtual wiring), keyboard, editing, pointer and focus. |
| `apps/playground` | A Vite app (not published): a minimal grid on the binding at 100,000 rows by 20 columns, with a measurement harness.       |

A lint rule keeps React, TanStack and browser globals out of the core, and its TypeScript config has no DOM types.

## The core in short

```ts
import { applyChange, createSheetStore, defineColumns } from "@sheetcn/core"

type Item = { id: string; name: string; price: number; qty: number | null }

const columns = defineColumns<Item>((c) => [
  c.text("name", { header: "Name" }),
  c.number("price", { format: (v) => v.toFixed(2) }),
  c.number("qty", {
    validate: (v) => (v !== null && v < 0 ? { message: "Below 0" } : null),
  }),
  c.number("total", { value: (row) => row.price * (row.qty ?? 0) }), // no write: read-only
])

const store = createSheetStore<Item>({
  rows,
  columns,
  getRowId: (row) => row.id,
  onChange: (change) => save(change),
})

store.transaction("edit", (tx) => tx.set("a1", "price", 12.5))
store.undo()
```

### Columns and values

- `defineColumns` checks that each key holds the right kind of value, and returns plain `Column<Row>[]`. A column read by a function is read-only unless it has `write`.
- Every cell may be empty (`null`). Empty cells format as `""`, and `format` never sees `null`.
- `parseCell`, `formatCell` and `validateCell` use the column's own functions, or these defaults:
  - **number**: accepts `1234.5`, `-12`, `1e21`, `$4.99`, `12%` and `1,234.50`. A comma is never read as a decimal mark, so `1,5` is rejected. A single comma group without a decimal point, such as `1,234`, is rejected as ambiguous (1234 in some locales, 1.234 in others). Pass `parse` for other formats.
  - **date**: stored as an ISO string. Only `YYYY-MM-DD` parses; `3/4/2026` is rejected rather than guessed.
  - **boolean**: `TRUE`/`FALSE`, `yes`/`no`, `1`/`0` and similar; formats as `TRUE` or `FALSE`.
  - **select**: matches an option label, then a value, then either ignoring case; formats as the label.
  - **text**: kept exactly as typed.
- For every type, `parse(format(v))` gives back `v` (property tests with fast-check).
- `validateCell` first checks the stored value against the column type, then runs `validate`. A failing value is still stored; the grid flags the cell.

### Changes, the store and history

- Every data mutation is one `Change`, passed to a single `onChange(change)`:

  ```ts
  type Change<Row> = {
    source:
      | "edit"
      | "paste"
      | "cut"
      | "clear"
      | "fill"
      | "insert"
      | "remove"
      | "undo"
      | "redo"
      | "import"
    patches: {
      rowId: string
      columnId: string
      from: CellValue
      to: CellValue
    }[]
    insertedRows?: { index: number; row: Row }[]
    removedRowIds?: string[]
  }
  ```

  A change applies in a fixed order: insert rows, then apply patches, then remove rows. `index` is the row's position after the insert step, and inserted rows come in ascending `index` order. The inverse of a change has the same shape, which is how undo restores rows to their old positions. `"insert"` and `"remove"` are the sources of row commands such as "add row" and "delete rows".

- `store.transaction(source, (tx) => ...)` collects `tx.set`, `tx.insert(index, rows)` and `tx.remove(ids)` into one change, one undo step and one `onChange` call. It fills in `from`, keeps one patch per cell and drops cells set to their current value. If the build throws, nothing is applied.
- Commits cost O(changed rows): untouched row objects are shared, and the row id index is handed on from one array to the next instead of being rebuilt. A Vitest gate checks that a one-cell commit on 100,000 rows by 20 columns takes under 1 ms (median).
- History keeps up to 500 steps (`historyLimit`). Edits to the same cells within 1 second of each other (`mergeWindowMs`) join one undo step, so a typing burst undoes at once.
- **Controlled mode** (`controlled: true`): the store never changes its own rows. The app applies each change and hands the result back:

  ```ts
  onChange: (change) =>
    setData((data) => applyChange(data, change, { columns, getRowId }))
  // and on each render: store.setRows(data)
  ```

### Selection and the keyboard map

- A selection is a list of `CellRange`s: two corners by row and column id (`anchorRowId`, `anchorColumnId`, `focusRowId`, `focusColumnId`), plus an optional `"exclude"` operation. The anchor of the last range is the active cell. The shape is TanStack Table's, so either side can hold the selection.
- `resolveRanges` turns the ranges into disjoint `CellRect`s of display indexes; `cellEdges` gives the outline of a cell; `rowSelectionKey` gives one string per row for what the selection draws on it, so a row re-renders only when that changes.
- `navigate` moves an active range by position: move, extend (Shift), jump to the edge of the data (Ctrl or Cmd + arrow, stopping at filled and blank cells as spreadsheets do), page, row and grid ends, select rows, columns or all, collapse.
- `keyToCommand(event, context)` maps a key press to a `SheetCommand`, or null when the key belongs to the browser or the editor. Ctrl and Cmd are both the shortcut modifier. The conventions:
  - Enter edits the active cell, keeping its value. While editing, Enter commits and moves down, Shift+Enter up, Tab right and Shift+Tab left.
  - Typing a character starts an edit that replaces the value. In that mode the arrow keys commit and move; in an edit started with Enter, F2 or a double click they move the caret. F2 switches between the two.
  - Escape cancels an edit, then a cut that waits for a paste (nothing is cleared), then collapses the selection to the active cell.
  - Space and Enter toggle a boolean cell. Delete and Backspace clear the selection. Ctrl or Cmd + Z undoes; with Shift, or Ctrl or Cmd + Y, it redoes.
  - Copy, cut and paste are not keys here: the binding will read them from clipboard events.

## The React binding in short

```tsx
import { useSheet, useSheetPointer } from "@sheetcn/react"

const sheet = useSheet<Item>({ columns, getRowId, defaultData: rows })
// or controlled: useSheet({ columns, getRowId, data, onChange })
const { onPointerDown, onMouseDown } = useSheetPointer(sheet)

<div role="grid" tabIndex={-1} onPointerDown={onPointerDown} onMouseDown={onMouseDown}
  onKeyDown={(e) => sheet.handleKeyDown(e.nativeEvent, { pageRows, pageColumns })}>
  ...
</div>
```

- `useSheet` returns one stable `Sheet` for the life of the component. It owns the core store (or wraps controlled `data`), a TanStack table with cell selection, sizing, resizing and pinning (`pin: "start"` columns first), and the editing state. The hook re-renders for data and column layout only, never for selection; views subscribe per row with `useRowSelectionKey`, and to the rest with `useSheetSelection`, `useSheetState` and `useSheetHistory`.
- Commits stay cheap at 100,000 rows: `createSheetCoreRowModel` replaces TanStack's core row model and builds new `Row` objects only for the rows a change replaced. A Vitest gate checks that a one-cell commit through `useSheet` takes under 3 ms (median) and a tenth or less of TanStack's own row model.
- `useSheetPointer` selects with pointer events (mouse, pen and touch), not TanStack's mouse-only handlers. It drags with edge scrolling, extends with Shift, adds or removes ranges with Ctrl or Cmd, selects whole rows and columns from the headers, and keeps DOM focus on the active cell. It finds cells by `data-row-index` and `data-column-index` attributes.
- `useSheetRowVirtualizer` keeps the virtualizer's item keys stable across edits, so a commit does not make it recompute every row offset, and keeps the active row mounted while it is scrolled away.
- Contract tests (`packages/react/test/tanstack-contract.test.ts`) pin the TanStack Table 9.3 behaviour the binding relies on: selection bounds, `autoResetCellSelection`, the step rules of its own arrow-key moves, and that the binding never calls `getSelectedCellRangesData` (it builds a cell object per selected cell) or the mouse-only handlers.

## Development

Requires Node 24 or later and pnpm (the version is pinned in `package.json`). Dependencies are pinned to exact versions.

```sh
pnpm install
pnpm typecheck        # tsc -b over every package and the tests
pnpm lint             # ESLint, Prettier and a text check
pnpm test             # Vitest, including the property tests and the commit gate
pnpm build            # emits packages/*/dist
pnpm check:licenses   # license scan; see THIRD_PARTY_NOTICES.md
```

CI runs all five on every pull request.

### The playground

```sh
pnpm --filter @sheetcn/playground dev      # http://localhost:5173, ?rows=1000 for fewer rows
pnpm --filter @sheetcn/playground build && pnpm --filter @sheetcn/playground preview
```

Measure on the production build. "Measure commit" (or `__playground.measureCommits(50)` in the console) commits one cell 50 times from an open editor and reports the time from each commit to the frame that shows it. Each commit starts at the beginning of a frame, so the number is the work (commit, render, style, layout and paint) without the wait for the next frame. `measureCommits(50, { enter: true })` dispatches Enter on the editor instead, so it also moves the selection and focus. The gate: under 5 ms at 100,000 rows, and under 25 ms with the CPU slowed 4 times in the browser's developer tools.
