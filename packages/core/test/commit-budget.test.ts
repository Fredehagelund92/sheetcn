// Gate: committing one cell on 100,000 rows by 20 columns takes under 1 ms in
// the core, median over many commits. The row index is built once, on the
// first lookup, and is not part of the per-commit cost. The same holds for a
// list-valued cell, and for an identifier cell checked for uniqueness after
// each commit, which patches the column's value index instead of rebuilding.
import { describe, expect, it } from "vitest"

import {
  applyChange,
  builtInTypes,
  createSheetStore,
  createTypeRegistry,
  defineColumnType,
  defineColumns,
  validateCell,
  type Column,
} from "../src/index.js"

type Row = { id: string } & Record<`c${number}`, number | null>

const ROWS = 100_000
const COLUMNS = 20
const BUDGET_MS = 1
const RUNS = 500

const columns: Column<Row>[] = defineColumns<Row>((c) =>
  Array.from({ length: COLUMNS }, (_, j) => c.number(`c${j}`))
)
const getRowId = (r: Row) => r.id

function makeRows(): Row[] {
  return Array.from({ length: ROWS }, (_, i) => {
    const row: Row = { id: `r${i}` }
    for (let j = 0; j < COLUMNS; j++) row[`c${j}`] = i + j
    return row
  })
}

// Deterministic, spread over the whole sheet.
let seed = 1
const pick = (n: number) => {
  seed = (seed * 48271) % 2147483647
  return seed % n
}

function measure(commit: (i: number) => void) {
  for (let i = 0; i < 50; i++) commit(i)
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now()
    commit(i)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const at = (q: number) => times[Math.floor(q * (times.length - 1))] as number
  return { median: at(0.5), p95: at(0.95) }
}

describe(`one-cell commit on ${ROWS.toLocaleString("en")} rows`, () => {
  it(`takes under ${BUDGET_MS} ms in an uncontrolled store`, () => {
    const store = createSheetStore<Row>({ rows: makeRows(), columns, getRowId })
    const { median, p95 } = measure((i) => {
      store.transaction("edit", (tx) =>
        tx.set(`r${pick(ROWS)}`, `c${pick(COLUMNS)}`, -i)
      )
    })
    console.log(
      `uncontrolled: median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`
    )
    expect(median).toBeLessThan(BUDGET_MS)
  })

  it(`takes under ${BUDGET_MS} ms in controlled mode, applyChange included`, () => {
    let data: readonly Row[] = makeRows()
    const store = createSheetStore<Row>({
      rows: data,
      columns,
      getRowId,
      controlled: true,
      onChange: (change) => {
        data = applyChange(data, change, { columns, getRowId })
      },
    })
    const { median, p95 } = measure((i) => {
      store.transaction("edit", (tx) =>
        tx.set(`r${pick(ROWS)}`, `c${pick(COLUMNS)}`, -i)
      )
      store.setRows(data)
    })
    console.log(
      `controlled: median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`
    )
    expect(median).toBeLessThan(BUDGET_MS)
  })
})

type TypedRow = Row & { key: string; tags: readonly string[] | null }

// A list-valued type, as tags will be.
const words = defineColumnType({
  id: "words",
  label: "Words",
  defaultOptions: {},
  parse: (text) => ({ ok: true, value: text ? text.split(",") : null }),
  format: (value: readonly string[]) => value.join(","),
})

describe(`one-cell commit on ${ROWS.toLocaleString("en")} rows, list and identifier cells`, () => {
  it(`takes under ${BUDGET_MS} ms with the uniqueness check after it`, () => {
    const types = createTypeRegistry([...builtInTypes, words])
    const typed = types.defineColumns<TypedRow>((c) => [
      ...Array.from({ length: COLUMNS - 2 }, (_, j) => c.number(`c${j}`)),
      c.identifier("key"),
      c.words("tags"),
    ])
    const key = typed.at(-2) as Column<TypedRow>
    const rows = makeRows().map((r, i) => ({ ...r, key: `K${i}`, tags: ["a"] }))
    const store = createSheetStore<TypedRow>({
      rows,
      columns: typed,
      getRowId,
      types,
    })
    // Builds the value index once; commits then patch it.
    validateCell(key, "K0", rows[0] as TypedRow, store.getRows())
    let n = 0
    const { median, p95 } = measure(() => {
      const id = `r${pick(ROWS)}`
      n++
      store.transaction("edit", (tx) => {
        if (n % 2) tx.set(id, "tags", ["a", `t${n}`])
        else tx.set(id, "key", `N${n}`)
      })
      const row = store.getRow(id) as TypedRow
      if (validateCell(key, row.key, row, store.getRows())) {
        throw new Error(`${row.key} is flagged`)
      }
    })
    console.log(
      `list and identifier: median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`
    )
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
