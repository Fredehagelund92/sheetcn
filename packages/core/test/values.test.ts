import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  defineColumns,
  formatCell,
  parseCell,
  parseNumber,
  validateCell,
  type CellValue,
  type Column,
  type SelectOption,
} from "../src/index.js"

type Row = {
  id: string
  name: string
  price: number | null
  due: string | null
  done: boolean | null
  status: string | null
}

const options: SelectOption[] = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "In progress" },
  { value: "done", label: "Done" },
]

const [name, price, due, done, status] = defineColumns<Row>((c) => [
  c.text("name"),
  c.number("price"),
  c.date("due"),
  c.boolean("done"),
  c.select("status", { options }),
]) as [Column<Row>, Column<Row>, Column<Row>, Column<Row>, Column<Row>]

const row: Row = {
  id: "1",
  name: "Desk lamp",
  price: 12.5,
  due: "2026-03-01",
  done: false,
  status: "todo",
}

const parsed = (value: CellValue) => ({ ok: true, value })

describe("number", () => {
  it.each([
    ["1234.5", 1234.5],
    ["-12", -12],
    ["+3", 3],
    [" 42 ", 42],
    [".5", 0.5],
    ["1e21", 1e21],
    ["1.5e-7", 1.5e-7],
    ["$4.99", 4.99],
    ["-$4.99", -4.99],
    ["€-2", -2],
    ["12%", 0.12],
    ["12.3%", 0.123],
    ["1,234.50", 1234.5],
    ["1,234,567", 1234567],
    ["-0", 0],
    ["", null],
  ])("parses %j", (text, value) => {
    expect(parseCell(price, text)).toEqual(parsed(value))
  })

  it("never reads a comma as a decimal mark", () => {
    expect(parseNumber("1,5")).toEqual({
      ok: false,
      error: '"1,5" is not a number',
    })
    expect(parseNumber("1.234,5").ok).toBe(false)
    expect(parseNumber("1.234.567").ok).toBe(false)
  })

  it("rejects a single comma group as ambiguous", () => {
    expect(parseNumber("1,234")).toEqual({
      ok: false,
      error: '"1,234" is ambiguous: write 1234 or 1.234',
    })
  })

  it.each(["12x", "abc", "$", "1e400", "--1", "1 234", "0x10", "Infinity"])(
    "rejects %j",
    (text) => {
      expect(parseCell(price, text).ok).toBe(false)
    }
  )
})

describe("date", () => {
  it("accepts ISO dates only", () => {
    expect(parseCell(due, "2026-03-01")).toEqual(parsed("2026-03-01"))
    expect(parseCell(due, "2024-02-29")).toEqual(parsed("2024-02-29"))
    expect(parseCell(due, "")).toEqual(parsed(null))
  })

  it("does not guess ambiguous forms", () => {
    expect(parseCell(due, "03/04/2026")).toEqual({
      ok: false,
      error: '"03/04/2026" is not a date in YYYY-MM-DD form',
    })
    expect(parseCell(due, "4 March 2026").ok).toBe(false)
    expect(parseCell(due, "2026-3-4").ok).toBe(false)
  })

  it("rejects dates that do not exist", () => {
    expect(parseCell(due, "2026-02-29")).toEqual({
      ok: false,
      error: '"2026-02-29" is not a real date',
    })
    expect(parseCell(due, "2100-02-29").ok).toBe(false)
    expect(parseCell(due, "2026-13-01").ok).toBe(false)
  })
})

describe("boolean", () => {
  it.each([
    ["TRUE", true],
    ["yes", true],
    ["x", true],
    ["FALSE", false],
    ["No", false],
    ["0", false],
    ["", null],
  ])("parses %j", (text, value) => {
    expect(parseCell(done, text)).toEqual(parsed(value))
  })

  it("rejects other text", () => {
    expect(parseCell(done, "maybe").ok).toBe(false)
  })

  it("formats as TRUE and FALSE", () => {
    expect(formatCell(done, true)).toBe("TRUE")
    expect(formatCell(done, false)).toBe("FALSE")
  })
})

describe("select", () => {
  it("matches labels, values and either ignoring case", () => {
    expect(parseCell(status, "In progress")).toEqual(parsed("doing"))
    expect(parseCell(status, "doing")).toEqual(parsed("doing"))
    expect(parseCell(status, " in PROGRESS ")).toEqual(parsed("doing"))
    expect(parseCell(status, "DONE")).toEqual(parsed("done"))
    expect(parseCell(status, "")).toEqual(parsed(null))
    expect(parseCell(status, "Later")).toEqual({
      ok: false,
      error: '"Later" is not one of the options',
    })
  })

  it("formats the label, or the raw value when it is not an option", () => {
    expect(formatCell(status, "doing")).toBe("In progress")
    expect(formatCell(status, "gone")).toBe("gone")
  })
})

describe("text", () => {
  it("keeps text as typed", () => {
    expect(parseCell(name, "  two  spaces ")).toEqual(parsed("  two  spaces "))
    expect(parseCell(name, "")).toEqual(parsed(""))
  })
})

describe("formatCell", () => {
  it("formats empty cells as empty text and never calls format with null", () => {
    const [fixed] = defineColumns<Row>((c) => [
      c.number("price", { format: (v) => v.toFixed(2) }),
    ])
    expect(formatCell(fixed as Column<Row>, null)).toBe("")
    expect(formatCell(fixed as Column<Row>, 3)).toBe("3.00")
    expect(formatCell(price, null)).toBe("")
  })
})

describe("validateCell", () => {
  it("checks the stored value against the column type", () => {
    expect(validateCell(price, 3, row)).toBeNull()
    expect(validateCell(price, "3", row)).toEqual({ message: "Not a number" })
    expect(validateCell(price, Number.NaN, row)).toEqual({
      message: "Not a number",
    })
    expect(validateCell(due, "2026-02-30", row)).toEqual({
      message: "Not a date in YYYY-MM-DD form",
    })
    expect(validateCell(done, "yes", row)).toEqual({
      message: "Not yes or no",
    })
    expect(validateCell(status, "later", row)).toEqual({
      message: "Not one of the options",
    })
    expect(validateCell(name, 4, row)).toEqual({ message: "Not text" })
  })

  it("lets empty cells pass the type check", () => {
    for (const column of [name, price, due, done, status]) {
      expect(validateCell(column, null, row)).toBeNull()
    }
  })

  it("runs the column's rule after the type check, with the row", () => {
    const [rule] = defineColumns<Row>((c) => [
      c.number("price", {
        validate: (v, r) =>
          v !== null && v < 0
            ? { message: `${r.name} costs less than 0` }
            : null,
      }),
    ])
    expect(validateCell(rule as Column<Row>, -1, row)).toEqual({
      message: "Desk lamp costs less than 0",
    })
    expect(validateCell(rule as Column<Row>, 1, row)).toBeNull()
  })
})

describe("parse(format(v)) equals v", () => {
  const roundTrip = (column: Column<Row>, value: CellValue) => {
    expect(parseCell(column, formatCell(column, value))).toEqual(parsed(value))
  }
  const nullable = <T>(arb: fc.Arbitrary<T>) =>
    fc.option(arb, { nil: null, freq: 10 })

  it("text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (v) => roundTrip(name, v))
    )
  })

  it("number", () => {
    const finite = fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .map((v) => (v === 0 ? 0 : v))
    fc.assert(fc.property(nullable(finite), (v) => roundTrip(price, v)))
  })

  it("date", () => {
    const iso = fc
      .date({
        min: new Date("0000-01-01T00:00:00Z"),
        max: new Date("9999-12-31T00:00:00Z"),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString().slice(0, 10))
    fc.assert(fc.property(nullable(iso), (v) => roundTrip(due, v)))
  })

  it("boolean", () => {
    fc.assert(fc.property(nullable(fc.boolean()), (v) => roundTrip(done, v)))
  })

  it("select, for any options with distinct values and labels", () => {
    const optionList = fc
      .uniqueArray(
        fc.record({
          value: fc.string(),
          label: fc.string({ minLength: 1 }).filter((l) => l.trim() !== ""),
        }),
        {
          minLength: 1,
          maxLength: 8,
          selector: (o) => o.value,
        }
      )
      .filter((list) => new Set(list.map((o) => o.label)).size === list.length)

    fc.assert(
      fc.property(
        optionList.chain((list) =>
          fc.tuple(fc.constant(list), nullable(fc.constantFrom(...list)))
        ),
        ([list, option]) => {
          const [column] = defineColumns<Row>((c) => [
            c.select("status", { options: list }),
          ])
          roundTrip(column as Column<Row>, option?.value ?? null)
        }
      )
    )
  })
})
