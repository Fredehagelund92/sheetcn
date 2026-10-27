// The rows, columns and timing helpers the 100,000 row gates share.
import {
  createViewModel,
  defineColumns,
  type Column,
  type SheetView,
} from "../src/index.js"

export type Row = {
  id: string
  account: string
  score: number | null
  updated: string | null
  status: string
} & Record<`c${number}`, number>

export const ROWS = 100_000
export const TODAY = "2026-10-27"

export const columns: Column<Row>[] = defineColumns<Row>((c) => [
  c.text("account"),
  c.number("score"),
  c.date("updated"),
  c.select("status", {
    options: [
      { value: "review", label: "Needs review" },
      { value: "conflict", label: "Conflict" },
      { value: "matched", label: "Matched" },
      { value: "new", label: "New" },
    ],
  }),
  // 20 columns in all, as the other gates have.
  ...Array.from({ length: 16 }, (_, j) => c.number(`c${j}`)),
])
export const getRowId = (r: Row) => r.id

// Deterministic, invented.
let seed = 7
export const random = () => {
  seed = (seed * 48271) % 2147483647
  return seed / 2147483647
}
const WORDS = [
  "Kestrel",
  "Nordic",
  "Harbor",
  "Café",
  "Lumen",
  "Atlas",
  "Quill",
  "Ölstube",
]
const STATUS = ["review", "conflict", "matched", "matched", "matched", "new"]

// Rows as an app reads them, from JSON. (Rows built by adding 16 properties
// one by one would be slow dictionaries in V8, which no filter can help.)
export function makeRows(): Row[] {
  return JSON.parse(JSON.stringify(rowsOfFields())) as Row[]
}

function rowsOfFields(): Row[] {
  return Array.from({ length: ROWS }, (_, i) => {
    const day = 1 + Math.floor(random() * 300)
    const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10)
    const row = {
      id: `r${i}`,
      account: `${WORDS[Math.floor(random() * 8)]} ${WORDS[Math.floor(random() * 8)]} ${i}`,
      score: i % 50 === 0 ? null : Math.round(random() * 1000) / 1000,
      updated: i % 40 === 0 ? null : date,
      status: STATUS[Math.floor(random() * STATUS.length)] as string,
    } as Row
    for (let j = 0; j < 16; j++) row[`c${j}`] = i + j
    return row
  })
}

export function time(runs: number, work: (i: number) => void) {
  work(-1)
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    work(i)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return {
    fastest: times[0] as number,
    median: times[Math.floor(times.length / 2)] as number,
  }
}

export const show = ({
  fastest,
  median,
}: {
  fastest: number
  median: number
}) => `${fastest.toFixed(2)} ms (median ${median.toFixed(2)} ms)`

export const model = (view: SheetView) =>
  createViewModel({ columns, getRowId, view, today: TODAY })
