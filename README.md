# sheetcn

A customizable spreadsheet and data-table component for React and shadcn/ui. MIT licensed.

## Status

Early work. Nothing is published to npm yet, and there is no component to install.

What exists today is the headless core, `@sheetcn/core`: the column schema, cell values (parse, format, validate) and a row store with transactions and undo. `@sheetcn/react` is an empty placeholder.

Not built yet: clipboard and paste planning, fill, selection and the keyboard map, the React binding, the shadcn registry with the grid views, and the docs.

The plan: one headless core and a React binding on npm, with the grid markup and styles installed from a shadcn registry, in two presets (`table` and `sheet`).

## Packages

| Package          | What it is                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/core`  | `@sheetcn/core`. Plain TypeScript: schema, values, store and history. No React, no DOM, no TanStack.      |
| `packages/react` | `@sheetcn/react`. Placeholder for the React binding (TanStack Table and Virtual wiring, focus, keyboard). |

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
