<p align="center">
  <img src="./.github/assets/banner.png" alt="The sheetcn playground at row 48,211 of 100,000, with a range of 24 cells selected, split between the light and the dark theme" />
</p>

<h1 align="center">sheetcn</h1>

<p align="center">
  A customizable spreadsheet and data-table component for React and shadcn/ui.<br/>
  Built on <a href="https://tanstack.com/table">TanStack Table</a> and <a href="https://tanstack.com/virtual">TanStack Virtual</a>. The grid views will install from a <a href="https://ui.shadcn.com/docs/registry">shadcn registry</a>.
</p>

<p align="center">
  <a href="https://github.com/Fredehagelund92/sheetcn/stargazers"><img src="https://img.shields.io/github/stars/Fredehagelund92/sheetcn?style=flat&color=18181b" alt="GitHub stars" /></a>
  <a href="https://github.com/Fredehagelund92/sheetcn/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Fredehagelund92/sheetcn/ci.yml?branch=main&label=CI" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Fredehagelund92/sheetcn?color=18181b" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="#see-it-work">Demos</a> ·
  <a href="#numbers">Numbers</a> ·
  <a href="#table-and-sheet">Table and sheet</a> ·
  <a href="#column-sizing">Column sizing</a> ·
  <a href="#gridlines">Gridlines</a> ·
  <a href="#status">Status</a> ·
  <a href="#development">Development</a> ·
  <a href="apps/playground">Playground</a>
</p>

## Features

- **Spreadsheet selection**: click, drag, Shift to extend, Ctrl or Cmd to add ranges, whole rows and columns from the headers. Pointer events, so mouse, pen and touch all work.
- **Spreadsheet keys**: arrows, jumps to the edge of the data, paging, Enter or typing to edit, Tab and Enter to commit and move, Escape to cancel, undo and redo.
- **Typed columns**: 14 built-in types, from text, number, date, select and boolean to long text, percent, money, identifier, email, URL, domain, phone and country, each with parse, format and validate. Nothing is guessed: `1,5`, `3/4/2026` and `$5` in a euro column are rejected, not read one way or the other.
- **Custom types**: define a type once (parse, format, validate, equals, compare, how it is edited) and use it in any column, through a registry you pass to the sheet.
- **Filter, sort and group in the core**: a view is plain JSON (a filter tree with all, any and not, sort keys, a grouping, hidden columns) that an app can save anywhere. Each type brings its filters, relative dates included, and 100,000 rows filter in a few milliseconds. The grid does not show views yet.
- **One change for every mutation**: each edit, toggle, clear, undo and redo reaches your app as one `Change`, so saving it is one function.
- **Undo and redo**: transactions are single steps, and a burst of typing undoes at once.
- **Column sizing**: fixed widths, or fill the grid's width and scroll when the columns do not fit. Double-click a column's edge to fit it to its content.
- **Gridlines**: lines between rows, columns, both or none, in their own colour so columns stay apart in a wide grid.
- **Fast at 100,000 rows**: rows and columns are virtualized, and a one-cell commit rebuilds only the row it changed.
- **Controlled or not**: the sheet can keep the rows, or your state can, with `applyChange`.
- **Headless core**: the schema, values, store, selection and key map are plain TypeScript, with no React and no DOM.

## See it work

Every frame below is a screenshot of the [playground](apps/playground), at 100,000 rows by 20 columns. [`scripts/readme-assets.py`](scripts/readme-assets.py) captures them again.

### Select with the pointer

<img src="./.github/assets/selection.webp" alt="Dragging across cells selects a range; Shift and click extends it; Ctrl and drag adds a second range; clicking a column header selects the column; dragging the row numbers selects rows" />

### Move and edit with the keyboard

<img src="./.github/assets/keyboard.webp" alt="Arrow keys move the active cell; typing replaces a price; Enter commits and moves down; Enter edits; a value that does not parse shows an error and is held back; Escape cancels; Shift and arrows extend; undo and redo" />

### Scroll 100,000 rows

<img src="./.github/assets/scroll.webp" alt="Scrolling from the first row to row 60,000, then Ctrl and Down jumping to row 100,000 and Ctrl and Home going back to the first cell" />

### Toggle a boolean column

<img src="./.github/assets/boolean.webp" alt="Space and Enter toggle the In stock column between Yes and No, typing a letter does nothing there, and each toggle undoes on its own" />

### Fill the width and fit columns

<img src="./.github/assets/sizing.webp" alt="Seven columns with fixed widths leave an empty strip on the right; Fill width shares it out so the last column ends at the edge; narrowing the grid shrinks the columns back to their widths and then the grid scrolls with the Name column pinned; double-clicking the Category column's edge fits it to its content; Fit all columns fits every column and still fills" />

## Numbers

All measured at 100,000 rows by 20 columns, and recorded with the change that added them.

| What                                                                                         | Measured                                                                               | Gate                   | Source                                                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| One-cell commit in the core                                                                  | median 0.093 ms (0.109 ms controlled)                                                  | under 1 ms             | [`commit-budget.test.ts`](packages/core/test/commit-budget.test.ts), [#1](https://github.com/Fredehagelund92/sheetcn/pull/1) |
| One-cell commit in a list cell or an identifier cell, uniqueness checked after it            | median 0.025 to 0.033 ms                                                               | under 1 ms             | [`commit-budget.test.ts`](packages/core/test/commit-budget.test.ts)                                                          |
| Apply three filters (is any of, less than, in the last 30 days) in the core                  | 3.3 to 4.2 ms                                                                          | under 10 ms            | [`view-budget.test.ts`](packages/core/test/view-budget.test.ts)                                                              |
| Apply a text filter (contains) in the core, once the column's text is folded                 | 2.1 to 2.8 ms; folding the column first, 21 to 28 ms                                   | under 10 ms            | [`view-budget.test.ts`](packages/core/test/view-budget.test.ts)                                                              |
| Sort in the core, the first time on a rows array                                             | a number 15 to 22 ms, a select group sorted by a number 20 to 44 ms, text 96 to 137 ms | under 100 ms, to paint | [`view-budget.test.ts`](packages/core/test/view-budget.test.ts)                                                              |
| Sort again in the core: the other way, or after a filter change                              | 5.0 to 13.6 ms                                                                         | under 100 ms           | [`view-budget.test.ts`](packages/core/test/view-budget.test.ts)                                                              |
| One-cell commit with a filter, a sort and a group on, the view updated after it, in the core | median 0.23 to 0.63 ms                                                                 | under 1 ms             | [`view-budget.test.ts`](packages/core/test/view-budget.test.ts)                                                              |
| One-cell commit to paint, in the browser                                                     | median 2.0 to 3.8 ms                                                                   | under 5 ms             | [`bench.ts`](apps/playground/src/bench.ts), [#2](https://github.com/Fredehagelund92/sheetcn/pull/2)                          |
| The same, with the CPU slowed 4 times                                                        | median 7.1 to 9.5 ms                                                                   | under 25 ms            | [#2](https://github.com/Fredehagelund92/sheetcn/pull/2)                                                                      |
| Rows rendered again per one-cell commit                                                      | 1                                                                                      |                        | [#2](https://github.com/Fredehagelund92/sheetcn/pull/2)                                                                      |
| One-cell commit through `useSheet`, test DOM, no paint                                       | 0.36 to 0.39 ms, against 38 to 50 ms with TanStack's own row model                     |                        | [#2](https://github.com/Fredehagelund92/sheetcn/pull/2)                                                                      |
| Scroll, three rows a frame, in the browser                                                   | 60 fps; work per frame median 2.7 to 3.3 ms, none over 16.7 ms                         | 60 fps                 | [`bench.ts`](apps/playground/src/bench.ts)                                                                                   |
| Fit one column to its content, in the browser                                                | 3 to 7 ms; all 20 columns in 35 ms                                                     |                        | [`sheet.ts`](packages/react/src/sheet.ts)                                                                                    |

The filter and sort numbers are the fastest of several runs, in three rounds on an Apple M5 that other work kept at a load average of 10 to 11; the medians were up to 35% higher. The rows come from JSON, as an app loads them. A first sort by text is one sort through the collator over 100,000 distinct texts, so its time depends on the machine: the core logs it rather than gating it, and its gate is to paint, in the browser, once the grid shows views.

The browser numbers come from the playground's production build on a shared machine, three rounds of 50 commits each; the method is in [#2](https://github.com/Fredehagelund92/sheetcn/pull/2). A busier run of the same check recorded medians of 4.2 to 5.0 ms (1x) and 14.5 to 18 ms (4x). The commit and scroll numbers hold with fill sizing on. Measure your own with the "Measure commit" button in the [playground](#the-playground), or `__playground.measureScroll()` in its console.

## Table and sheet

The plan is two presets of the grid views, `table` and `sheet`, installed from the shadcn registry. Those views are [not built yet](#status). What works today is the binding under them, which runs in two data modes. Both snippets below run as written against the current packages; `Grid` is your grid markup, such as [the playground's](apps/playground/src/grid.tsx).

**The sheet keeps the data.** It owns the rows, the selection and the undo history:

```tsx
import { defineColumns } from "@sheetcn/core"
import { useSheet } from "@sheetcn/react"

type Item = { id: string; name: string; price: number; inStock: boolean }

const columns = defineColumns<Item>((c) => [
  c.text("name", { header: "Name" }),
  c.number("price", { header: "Price", format: (v) => v.toFixed(2) }),
  c.boolean("inStock", { header: "In stock" }),
])
const getRowId = (item: Item) => item.id

export function Items({ items }: { items: Item[] }) {
  // The sheet keeps the rows, the selection and the undo history.
  const sheet = useSheet({ columns, getRowId, defaultData: items })
  return <Grid sheet={sheet} />
}
```

**Your state keeps the data.** The sheet never changes `data`; it hands you each change to apply:

```tsx
import { applyChange } from "@sheetcn/core"
import { useState } from "react"

export function ControlledItems({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial)
  const sheet = useSheet({
    columns,
    getRowId,
    data: items,
    // One change per edit, clear, undo or redo: apply it to your state.
    onChange: (change) =>
      setItems((rows) => applyChange(rows, change, { columns, getRowId })),
  })
  return <Grid sheet={sheet} />
}
```

## Column sizing

By default each column keeps its width (`sizing: "fixed"`), so on a wide screen the columns can end well short of the grid's right edge. With `sizing: "fill"`, each column's width is its minimum and the spare width is shared out, so the last column ends at the right edge. When the minimums do not fit, nothing grows and the grid scrolls, with pinned columns staying put. The planned `table` view will use fill, and the `sheet` view fixed.

```tsx
const columns = defineColumns<Item>((c) => [
  c.text("name", { header: "Name", width: 200, pin: "start" }), // pinned: never grows
  c.number("price", { header: "Price", width: 100, grow: 2, maxWidth: 240 }), // twice its share
  c.boolean("inStock", { header: "In stock", width: 100, grow: 0 }), // keeps its width
])

export function FilledItems({ items }: { items: Item[] }) {
  const sheet = useSheet({
    columns,
    getRowId,
    defaultData: items,
    sizing: "fill",
  })
  return <Grid sheet={sheet} />
}
```

- Spare width is shared in proportion to each column's `grow`, which defaults to its `width`, so wide columns grow more. `grow: 0` keeps a column at its width, and `maxWidth` caps it. Pinned columns and the row number gutter never grow.
- Double-click a column's right edge, or call `sheet.fitColumn(id)`, to fit the column to its content: the widest of its header, the rows on screen and up to 500 rows in all, spread over the rest, within its `minWidth` and `maxWidth`. `sheet.fitAllColumns()` fits every column. Sampling keeps a fit at 100,000 rows to a few milliseconds.
- With fill, a column the user resizes or fits keeps that width, and the other columns share the rest. `fitAllColumns` makes the fitted widths the minimums and lets every column grow again, so the grid still fills. Resetting its size (`sheet.table.getColumn(id)?.resetSize()`) lets it grow again.
- The playground shows both: `?columns=9` keeps the columns narrow enough to fill a wide screen, the toolbar switches between fixed widths and fill, and the grid width slider narrows the grid as resizing the window would.

## Gridlines

The lines between cells have their own colour token, `--sheet-grid-line`. It is darker than `--border`, the softer colour that frames the toolbars, so columns stay apart in a grid with many columns. It keeps at least 1.5:1 contrast against the cells, selected cells and the header, in light and dark ([`gridlines.spec.ts`](apps/playground/e2e/gridlines.spec.ts) checks it in the browser).

The playground's grid takes a `gridlines` option:

| Value     | Lines drawn between cells |
| --------- | ------------------------- |
| `none`    | none                      |
| `rows`    | between rows              |
| `columns` | between columns           |
| `both`    | between rows and columns  |

The default follows the grid's `mode`: `both` for `sheet` and `rows` for `table`. The header's bottom line, the row numbers' edge and the thicker edge of the pinned columns always show.

```tsx
<SheetGrid sheet={sheet} label="Items" /> // a sheet: every line
<SheetGrid sheet={sheet} label="Items" mode="table" /> // a table: rows only
<SheetGrid sheet={sheet} label="Items" gridlines="columns" />
```

- A hidden line is a transparent border, not a missing one, so switching moves no column, fill sizing is unchanged, and the selection tint fills the gap.
- The value is one attribute on the grid, so switching it renders no rows.
- In the playground, `?mode=table` starts with the table's lines, `?gridlines=none` (or `rows`, `columns`, `both`) with those, and the toolbar switches between all four.

## Status

Early. Nothing is published to npm yet, and there is no component to install.

What exists:

- `@sheetcn/core`: the column schema, 14 column types with a registry for your own, cell values (parse, format, validate, compare, filter), views that filter, sort and group rows, a row store with transactions and undo, selection geometry and the key map. `@sheetcn/core/phone` adds full phone number handling through libphonenumber-js.
- `@sheetcn/react`: `useSheet`, which wires the store to TanStack Table cell selection and TanStack Virtual, with keyboard commands, editing, pointer selection, focus, and column sizing with fit to content.
- [The playground](apps/playground): a minimal grid on the binding at 100,000 rows, with the measurement harness.

What is next:

- Views in the grid: the filter bar with its chips, sort and group, and hidden columns.
- Clipboard: copy, cut and paste.
- Fill.
- The shadcn registry, with the `table` and `sheet` grid views.
- A docs site.

## Packages

| Package           | What it is                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | `@sheetcn/core`. Plain TypeScript: schema, values, store and history, selection geometry, key map. No React, no DOM.       |
| `packages/react`  | `@sheetcn/react`. The React binding: `useSheet` (TanStack Table and Virtual wiring), keyboard, editing, pointer and focus. |
| `apps/playground` | A web app (not published): a minimal grid on the binding at 100,000 rows by 20 columns, with a measurement harness.        |

A lint rule keeps React, TanStack and browser globals out of the core, and its TypeScript config has no DOM types.

<details>
<summary><strong>The core in more depth</strong></summary>

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
- A cell holds a string, a number, a boolean, a list of strings (for types that hold several values) or `null`. Lists are the same when their items are, in order.
- Each column names its type by id (`type`) and can set the type's options (`typeOptions`). `parseCell`, `formatCell` and `validateCell` use the column's own `parse` and `format` when it has them, or else its type's. `validateCell` first checks the stored value with the type, then runs the column's `validate`. A failing value is still stored; the grid flags the cell.
- `formatCell(column, value, row)` takes the row for display, so a type can show a value per row (a money column's `currencyFrom`). Copy and editing call it without the row.
- `validateCell(column, value, row, rows)` takes the rows for types whose values must be unique (`identifier`): a repeat is flagged on every row that holds it, with another of them ("Also in row 12"). The column's values are indexed once per rows array, and a commit patches the index instead of rebuilding it. Without `rows` there is no uniqueness check.
- For every type, `parse(format(v))` gives back `v` (property tests, which a new built-in type cannot skip).

### Column types

The built-in types (`builtInTypes`). Every type reads `""` as empty (`text` keeps it).

| Type         | Stores                                             | Text it reads                                                                                                                                                                                                                          | Shows                                                    | Edited by                                          | Options                                                                                           |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `text`       | a string                                           | anything, kept exactly as typed                                                                                                                                                                                                        | the text                                                 | typing                                             |                                                                                                   |
| `longtext`   | a string that may hold line breaks                 | anything; Windows and old Mac line ends become `\n`, nothing is trimmed                                                                                                                                                                | the text (the playground shows the first line and "...") | the view's text area (`edit: "popup"`)             | `maxLength`                                                                                       |
| `number`     | a finite number                                    | `1234.5`, `-12`, `1e21`, `$4.99`, `12%` and `1,234.50`. A comma is never a decimal mark, so `1,5` is rejected, and so is a single comma group such as `1,234` (1234 in some locales, 1.234 in others). Pass `parse` for other formats. | the number, at the end of the cell                       | typing                                             |                                                                                                   |
| `percent`    | a fraction: 0.125 is 12.5%                         | `12.5%`, and a bare `12.5`, which means points                                                                                                                                                                                         | `12.5%`                                                  | typing                                             | `bare: "points" \| "fraction"`, `min`, `max`                                                      |
| `money`      | a number in the currency's major unit              | the amount, with the column's symbol or code or none (`€1,234.50`, `EUR 12`, `12`). Another currency (`$5` in a EUR column) and more decimals than the currency has are errors, never rounded.                                         | `€1,234.50`                                              | typing                                             | `currency` (required, ISO 4217), `currencyFrom`, `min`, `max`                                     |
| `date`       | an ISO string, `"2026-03-01"`                      | `YYYY-MM-DD` only; `3/4/2026` is rejected rather than guessed, and so is a day that does not exist                                                                                                                                     | the ISO date                                             | typing                                             |                                                                                                   |
| `select`     | an option's value                                  | an option's label, then its value, then either ignoring case                                                                                                                                                                           | the label                                                | typing, or a list the view draws (`edit: "popup"`) | `options` (required): `{ value, label }[]`, distinct, labels filled in                            |
| `boolean`    | `true` or `false`                                  | `TRUE`/`FALSE`, `yes`/`no`, `1`/`0` and similar                                                                                                                                                                                        | `TRUE` or `FALSE` (the view draws a check)               | Space or Enter, no editor (`edit: "toggle"`)       |                                                                                                   |
| `identifier` | a key such as an SKU: trimmed, no spaces inside    | the key; a space inside is an error                                                                                                                                                                                                    | the key (the playground uses a monospace face)           | typing                                             | `case: "keep" \| "upper" \| "lower"`, `pattern`, `required` (default true). Unique in its column. |
| `email`      | an address                                         | the address, also from `Ada <ada@example.test>` and `mailto:ada@example.test`; it must match the HTML standard's address pattern                                                                                                       | the address                                              | typing                                             |                                                                                                   |
| `url`        | an absolute link, `https://example.test/a`         | a link; `https://` is added when there is no scheme, and a lone `/` after the host is dropped. Only allowed schemes parse, so `javascript:` never becomes a link.                                                                      | the link without `https://`                              | typing                                             | `schemes` (default `["http", "https"]`)                                                           |
| `domain`     | a host, lowercase ASCII (`xn--` for international) | a host or a whole link; the host is kept. It needs a dot, labels of 1 to 63 characters and at most 253 in all; addresses such as `10.0.0.1` are not domains.                                                                           | the host                                                 | typing                                             | `stripWww`                                                                                        |
| `phone`      | E.164, `+442079460958`                             | the number with its country code; spaces, dots, dashes and brackets are dropped and `00` reads as `+`. It needs 7 to 15 digits. With the adapter below, national numbers and a check that the number can exist.                        | as stored, or in groups with the adapter                 | typing                                             | `defaultCountry` (adapter only)                                                                   |
| `country`    | an ISO 3166-1 alpha-2 code, `"NO"`                 | the code, the alpha-3 code or the name, in the column's language or English, ignoring case and accents; `UK` reads as GB. Only the 249 assigned codes are countries.                                                                   | the name in the column's language, `Norway`              | typing, or a list the view draws (`edit: "popup"`) | `locale` (default `"en"`), `showCode` (`Norway (NO)`)                                             |

Every type also orders its values (`compareCells`, with empty cells last) and has filters (`filterCell`), which a [view](#views-filter-sort-and-group) uses to filter, sort and group rows. The orders: text, email, URL, domain and phone as words, numbers, percents and money by value, dates by day, select by the order of its options, `false` before `true`, identifiers by code point with digit runs as numbers (`A-9` before `A-10`), countries by name.

**Money.** The amount is a plain number, so rows stay plain; the currency belongs to the column. The text is the same for display, copy and editing, in one fixed style (grouping commas and a decimal point, as `€1,234.50`, `DKK 1,234.50` and `¥1,235`), because `parse` must read back what `format` writes; there is no locale option yet. A single comma group (`1,234`) reads as thousands, except in a currency with three decimals, where it is ambiguous. `currencyFrom: (row) => row.currency` shows each row in its own currency, for display only: parsing, copying and editing use `currency`. Being a function, it is left out of the column's spec.

**Phone numbers.** The core checks the shape only, and has no dependency. For national numbers, a check that a number can exist (the library's `isPossible`, which it advises over `isValid`) and grouped display, use the adapter entry, which needs `libphonenumber-js` at exactly 1.13.15 (an optional peer dependency; about 20 KB gzipped):

```ts
import { builtInTypes, createTypeRegistry } from "@sheetcn/core"
import { phoneType } from "@sheetcn/core/phone"

const types = createTypeRegistry([
  ...builtInTypes.filter((t) => t.id !== "phone"),
  phoneType,
])
const columns = types.defineColumns<Contact>((c) => [
  c.phone("phone", { defaultCountry: "GB" }), // "020 7946 0958" reads as +442079460958
])
```

**Filters.** Each type lists its filters in the order a menu shows them, the likely one first: `{ id, label, notLabel, operands, compile }`. `operands` is how many texts the user gives: 0 ("is empty"), 1 ("contains"), 2 ("between") or `"many"` ("is any of", one or more). `compile(operands, prepared, env)` reads the texts once, usually with the type's own parse, and returns the test for one cell, or an error when they do not parse; `env.today` is today's date, for relative dates. A filter that also has `text(value, prepared)` matches words: its test gets the cell's text folded (`foldText`: case and accents removed), which is kept with the rows, so a filter typed letter by letter folds each cell once. `notLabel` names the negation a menu lists, such as "does not contain". `filterCell(column, id, value, operands)` runs one filter on one value, so `filterCell(price, "lessThan", value, ["€10"])` works in a euro column.

The built-in filters: `contains`, `is` and `startsWith` for text (`contains` for long text, email and phone; `is` and `startsWith` for identifiers and phone), `isAnyOf` for select and country, `equals`, `lessThan`, `greaterThan` and `between` for numbers, percents, money and dates (shown as "is", "less than", "greater than" and "between", and "before" and "after" for dates), `inLast`, `inNext` and `within` for dates, `domainIs` for email, `hostIs` for URLs, `is` for booleans and domains (a domain matches its subdomains too), and `empty` for every type. The builders (`containsFilter`, `isTextFilter`, `startsWithFilter`, `anyOfFilter`, `orderFilters`, `relativeDateFilters`, `emptyFilter`) are exported for types of your own.

**A type of your own** is one object, `defineColumnType`, with no DOM in it:

```ts
import {
  builtInTypes,
  createSheetStore,
  createTypeRegistry,
  defineColumnType,
} from "@sheetcn/core"

const rating = defineColumnType({
  id: "rating",
  label: "Rating",
  defaultOptions: { max: 5 },
  parse: (text, p) => {
    const n = Number(text.trim())
    if (text.trim() === "") return { ok: true, value: null }
    return Number.isInteger(n) && n >= 1 && n <= p.max
      ? { ok: true, value: n }
      : { ok: false, error: `Not 1 to ${p.max}` }
  },
  format: (value: number) => "★".repeat(value),
  validate: (v, p) =>
    v >= 1 && v <= p.max ? null : { message: `1 to ${p.max}` },
  align: "end",
})

const types = createTypeRegistry([...builtInTypes, rating])
const columns = types.defineColumns<Item>((c) => [
  c.text("name", { header: "Name" }),
  c.rating("stars", { header: "Stars", max: 10 }), // `max` is the type's option
])
const store = createSheetStore<Item>({ types, columns, rows, getRowId })
// or, in React: useSheet({ types, columns, getRowId, defaultData: rows })
```

- A definition has `id`, `label`, `group` (where a type picker lists it), `defaultOptions`, `requiredOptions` (names of options a column must set because their default means nothing; the typed helpers then require them and throw without them), and the functions `parse`, `format`, `validate`, `equals` (default: `Object.is`, and lists by their items), `compare` (default: the formatted texts as words) and `prepare`. Optionally: `validateEmpty`, which checks an empty cell (an identifier is required this way); `unique: true`, for values that must be distinct in their column; and `filters`. `prepare` runs once per column with the column's options over the defaults; build formatters and lookup maps there, not per cell. Each function gets what `prepare` built, or the options when there is no `prepare`.
- `edit` says how a cell is edited, and the key map follows it: `"text"` (the default) and `"popup"` open an editor on Enter or typing; `"toggle"` flips a boolean with Space or Enter and ignores typing; `"none"` opens nothing (Delete still clears). `align: "end"` puts values at the end of the cell, as for numbers.
- The registry is explicit and belongs to one sheet; nothing is registered globally. It throws when two types share an id. A registry's `defineColumns` has one helper per type, named by its id, which checks the key's value type and the type's options. Let TypeScript infer `defineColumnType`'s type parameters (type `format`'s value) so the helper exists. Options a column does not have go to `typeOptions`; a helper throws for a name that is neither a column property nor one of the type's options, naming the column and the option. This is also why a type cannot have an option named like a column property, such as `width`.
- The store checks that each column's type is the one its `types` define under that id, and drops a change that sets a cell to an equal value by the type's `equals`. Without `types`, a sheet has the built-in types.

**Specs.** A column has a plain-data part, `ColumnSpec` (`id`, `header`, `type`, `typeOptions`, `width`, `minWidth`, `maxWidth`, `grow`, `pin`, `readOnly`), which JSON can carry; the functions (`value`, `write`, `parse`, `format`, `validate`) stay on the column. `toColumnSpec(column)` takes the spec, and `types.fromSpec(spec)` makes a column from it that reads and writes `row[spec.id]`.

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

  A change applies in a fixed order: insert rows, then apply patches, then remove rows. `index` is the row's position after the insert step, and inserted rows come in ascending `index` order. The inverse of a change has the same shape, which is how undo restores rows to their old positions. `"insert"` and `"remove"` are the sources of row commands such as "add row" and "delete rows". The `"paste"`, `"cut"` and `"fill"` sources are reserved for features that are not built yet.

- `store.transaction(source, (tx) => ...)` collects `tx.set`, `tx.insert(index, rows)` and `tx.remove(ids)` into one change, one undo step and one `onChange` call. It fills in `from`, keeps one patch per cell and drops cells set to their current value. If the build throws, nothing is applied.
- Commits cost O(changed rows): untouched row objects are shared, and the row id index is handed on from one array to the next instead of being rebuilt. A test gate checks that a one-cell commit on 100,000 rows by 20 columns takes under 1 ms (median).
- History keeps up to 500 steps (`historyLimit`). Edits to the same cells within 1 second of each other (`mergeWindowMs`) join one undo step, so a typing burst undoes at once.
- **Controlled mode** (`controlled: true`): the store never changes its own rows. The app applies each change and hands the result back:

  ```ts
  onChange: (change) =>
    setData((data) => applyChange(data, change, { columns, getRowId }))
  // and on each render: store.setRows(data)
  ```

### Views: filter, sort and group

```ts
import {
  countRows,
  createViewModel,
  viewsEqual,
  type SheetView,
} from "@sheetcn/core"

const needsReview: SheetView = {
  filter: {
    match: "all",
    items: [
      { column: "status", op: "isAnyOf", values: ["review"] },
      {
        match: "any",
        items: [
          { column: "score", op: "lessThan", values: ["0.6"] },
          { column: "owner", op: "empty", values: [] },
        ],
      },
    ],
  },
  sort: [{ column: "score", dir: "asc" }],
}

const model = createViewModel({ columns, getRowId, view: needsReview })
const { rows: shown, groups } = model.compute(store.getRows())

countRows(store.getRows(), columns, needsReview) // for a count on a tab
viewsEqual(current, needsReview) // false once the view is edited
```

- A `SheetView` is plain data: `filter`, `sort`, `group` and `hidden` (column ids), every part optional. It survives JSON, so an app can keep views in the address bar, in local storage or in its database. Saved views belong to the app; the core gives the view and `viewsEqual`, which treats a missing part as an empty one and hidden columns as a set, so an app can mark a saved view as edited.
- Values are texts, read by the column's type the same way typed text is: `"80%"` in a percent column, `"Needs review"` or `"review"` in a select.
- A filter is a tree. A group matches `"all"` or `"any"` of its items, which are conditions or groups, to any depth. `not: true` turns any filter around ("does not contain" is `contains` with `not`), and passes empty cells. A condition that cannot apply (an unknown column or filter, a missing value, a value that does not parse) is skipped, never guessed, and listed in `issues` with its place in the tree; a group left with nothing that applies drops out.
- Relative dates: `inLast` and `inNext` take a count and a unit (`["7", "days"]`; days, weeks, months or years), and "in the last 7 days" is today and the 6 days before it. `within` takes a calendar period: `thisWeek`, `lastWeek`, `nextWeek` and the same for months and years; weeks start on Monday. `today`, `yesterday` and `tomorrow` work as the value of "is", "before", "after" and "between". They are kept as words, so a saved view stays current. Today is the local date when the model is made, or the `today` option.
- `sort` is a list of keys, the first deciding first, each `"asc"` or `"desc"`; empty cells go last either way, and ties keep the rows' order. `group` takes one column (a date by `"day"`, `"month"` or `"year"`); groups follow the column's order, reversed when a sort on the same column is descending, with empty cells last. Each group has its `value`, `label`, `start` and `size`, which a grid draws as a header with a count.
- `compute(rows)` returns the rows shown, in order, and the groups; `sourceIndex(position)` and `indexOf(rowId)` map between the view and the rows. With nothing to filter, sort or group, the rows come back as they are.
- Speed: `compileFilter` reads each condition's values once, not per cell. Folded text and each sort column's ranks are built on first use and kept with the rows array, and `applyChange` hands them on as it does the row index, so typing a filter or flipping a sort does not fold or compare again. After a patch-only change, `compute` tests only the replaced rows again and moves them to where they now belong; inserts, removes and changes of more than 64 rows are worked out afresh.

### Selection and the key map

- A selection is a list of `CellRange`s: two corners by row and column id (`anchorRowId`, `anchorColumnId`, `focusRowId`, `focusColumnId`), plus an optional `"exclude"` operation. The anchor of the last range is the active cell. The shape is TanStack Table's, so either side can hold the selection.
- `resolveRanges` turns the ranges into disjoint `CellRect`s of display indexes; `cellEdges` gives the outline of a cell; `rowSelectionKey` gives one string per row for what the selection draws on it, so a row re-renders only when that changes.
- `fillColumnWidths(available, columns)` is the fill math as a pure function: the width the columns can take, and each column's width, `grow`, `maxWidth` and whether it is pinned, to the widths they get. Grown widths are whole pixels that add up to the available width. `sampleRowIndexes` picks the rows a fit measures.
- `navigate` moves an active range by position: move, extend (Shift), jump to the edge of the data (Ctrl or Cmd + arrow, stopping at filled and blank cells as spreadsheets do), page, row and grid ends, select rows, columns or all, collapse.
- `keyToCommand(event, context)` maps a key press to a `SheetCommand`, or null when the key belongs to the browser or the editor. Ctrl and Cmd are both the shortcut modifier. The conventions:
  - Enter edits the active cell, keeping its value. While editing, Enter commits and moves down, Shift+Enter up, Tab right and Shift+Tab left.
  - Typing a character starts an edit that replaces the value. In that mode the arrow keys commit and move; in an edit started with Enter, F2 or a double click they move the caret. F2 switches between the two.
  - Escape cancels an edit, then a cut that waits for a paste (nothing is cleared), then collapses the selection to the active cell.
  - What Enter and typing do follows the active cell's type (`activeEdit`): Space and Enter toggle a boolean cell, and other typed keys do nothing there. Delete and Backspace clear the selection. Ctrl or Cmd + Z undoes; with Shift, or Ctrl or Cmd + Y, it redoes.
  - Copy, cut and paste are not keys here: the binding will read them from clipboard events.

</details>

<details>
<summary><strong>The React binding in more depth</strong></summary>

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
- Commits stay cheap at 100,000 rows: `createSheetCoreRowModel` replaces TanStack's core row model and builds new `Row` objects only for the rows a change replaced. A test checks that a one-cell commit through `useSheet` at 100,000 rows builds exactly one new `Row` and reuses all the others. The timing is gated in the playground, not in the unit tests.
- `useSheetPointer` selects with pointer events (mouse, pen and touch), not TanStack's mouse-only handlers. It drags with edge scrolling, extends with Shift, adds or removes ranges with Ctrl or Cmd, selects whole rows and columns from the headers, and keeps DOM focus on the active cell. It finds cells by `data-row-index` and `data-column-index` attributes.
- `useSheetRowVirtualizer` keeps the virtualizer's item keys stable across edits, so a commit does not make it recompute every row offset, and keeps the active row mounted while it is scrolled away. It also tells the sheet which rows are on screen, for fit to content.
- Column sizing: lay columns out with `sheet.getColumnWidth(id)`, which includes a column's share of the spare width in fill, not with TanStack's `getSize()`. `useSheetColumnVirtualizer` measures the scroll element (less the gutter) for fill, and re-renders the host when that width changes; in fixed sizing a window resize renders nothing. Use `sheet.getColumnResizeHandler(id)` for a resize handle, so a drag in fill starts from the width the column shows. Fit needs a measurer from the view, which knows its own markup: `sheet.setColumnMeasurer((column, rows) => width)` returns the width that shows the header and those rows unclipped. The playground's draws them off screen with its own cell markup.
- Contract tests (`packages/react/test/tanstack-contract.test.ts`) pin the TanStack Table 9.3 behaviour the binding relies on: selection bounds, `autoResetCellSelection`, the step rules of its own arrow-key moves, and that the binding never calls `getSelectedCellRangesData` (it builds a cell object per selected cell) or the mouse-only handlers.

</details>

## Development

Requires Node 24 or later and pnpm (the version is pinned in `package.json`). Dependencies are pinned to exact versions.

```sh
pnpm install
pnpm typecheck        # tsc -b over every package and the tests
pnpm lint             # lint, format check and a text check
pnpm test             # unit tests, including the property tests and the row reuse test
pnpm build            # emits packages/*/dist
pnpm check:licenses   # license scan; see THIRD_PARTY_NOTICES.md
pnpm test:e2e         # browser journeys through the playground's production build
```

The journeys run in Playwright's Chromium; install it once with `pnpm --filter @sheetcn/playground exec playwright install chromium`. CI runs all six on every pull request.

### The playground

```sh
pnpm --filter @sheetcn/playground dev      # http://localhost:5173, ?rows=1000 for fewer rows
pnpm --filter @sheetcn/playground build && pnpm --filter @sheetcn/playground preview
```

The 20 columns use every built-in type: money (Price), percent (Discount), country, email, phone (with the `@sheetcn/core/phone` adapter and `defaultCountry: "GB"`), URL (Website), long text (Notes, edited in a text area where Alt+Enter starts a new line), domain (Supplier) and identifier (ID), next to text, number, date, select and boolean.

`?columns=9` shows the first nine columns, and `?sizing=fill` starts in fill; the toolbar switches sizing, fits columns and narrows the grid. `?mode=table` and `?gridlines=` set the lines between cells (see [Gridlines](#gridlines)).

Measure on the production build. "Measure commit" (or `__playground.measureCommits(50)` in the console) commits one cell 50 times from an open editor and reports the time from each commit to the frame that shows it. Each commit starts at the beginning of a frame, so the number is the work (commit, render, style, layout and paint) without the wait for the next frame. `measureCommits(50, { enter: true })` dispatches Enter on the editor instead, so it also moves the selection and focus. The gate: under 5 ms at 100,000 rows, and under 25 ms with the CPU slowed 4 times in the browser's developer tools. `measureScroll(300)` scrolls three rows a frame for 300 frames and reports the frame rate and the work per frame; the gate is 60 fps.

## Community

sheetcn lives on [GitHub](https://github.com/Fredehagelund92/sheetcn). Ask questions, report bugs and share ideas in [issues](https://github.com/Fredehagelund92/sheetcn/issues).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get the repository running and land a change.

## Security

Please do not open public issues for security problems. Follow [SECURITY.md](SECURITY.md) to report them privately.

## License

[MIT](LICENSE)

## Contributors

[![Contributors](https://contrib.rocks/image?repo=Fredehagelund92/sheetcn)](https://github.com/Fredehagelund92/sheetcn/graphs/contributors)
