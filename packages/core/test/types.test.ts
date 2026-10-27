import fc from "fast-check"
import { describe, expect, expectTypeOf, it } from "vitest"

import {
  builtInTypes,
  cellsEqual,
  compareCells,
  createSheetStore,
  createTypeRegistry,
  defineColumnType,
  defineColumns,
  formatCell,
  parseCell,
  parseNumber,
  resolveColumnType,
  toColumnSpec,
  validateCell,
  type CellValue,
  type Column,
  type ColumnSpec,
  type ColumnType,
  type TypeHelpers,
} from "../src/index.js"

type Row = {
  id: string
  name: string | null
  stars: number | null
  price: number | null
  code: string | null
}

const row: Row = { id: "a", name: "Desk", stars: 3, price: 10, code: "x" }

// The custom type from the README: whole stars from 1 to `max`.
const rating = defineColumnType({
  id: "rating",
  label: "Rating",
  group: "number",
  defaultOptions: { max: 5 },
  parse: (text, p) => {
    const t = text.trim()
    if (t === "") return { ok: true, value: null }
    const n = /^★+$/.test(t) ? t.length : Number(t)
    return Number.isInteger(n) && n >= 1 && n <= p.max
      ? { ok: true, value: n }
      : { ok: false, error: `"${t}" is not 1 to ${p.max} stars` }
  },
  format: (value: number) => "★".repeat(value),
  validate: (value, p) =>
    Number.isInteger(value) && value >= 1 && value <= p.max
      ? null
      : { message: `1 to ${p.max} stars` },
  align: "end",
})

// Text compared without case, to see `equals` at work.
const tag = defineColumnType({
  id: "tag",
  label: "Tag",
  defaultOptions: {},
  parse: (text) => ({ ok: true, value: text.trim() || null }),
  format: (value: string) => value,
  equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
})

const types = createTypeRegistry([...builtInTypes, rating, tag])

const columns = types.defineColumns<Row>((c) => [
  c.text("name"),
  c.rating("stars", { header: "Stars", max: 10 }),
  c.number("price"),
  c.tag("code"),
])
const [name, stars, price, code] = columns as [
  Column<Row>,
  Column<Row>,
  Column<Row>,
  Column<Row>,
]

describe("createTypeRegistry", () => {
  it("looks types up by id and keeps their order", () => {
    expect(types.get("rating")).toBe(rating)
    expect(types.get("number")).toBe(builtInTypes[1])
    expect(types.get("missing")).toBeUndefined()
    expect(types.definitions.map((d) => d.id)).toEqual([
      "text",
      "number",
      "date",
      "select",
      "boolean",
      "rating",
      "tag",
    ])
  })

  it("rejects repeated ids", () => {
    expect(() =>
      createTypeRegistry([...builtInTypes, builtInTypes[0]])
    ).toThrow('Two types have the id "text"')
  })

  it("rejects options named like a column property", () => {
    const wide = defineColumnType({
      id: "wide",
      label: "Wide",
      defaultOptions: { width: 10 },
      parse: (text) => ({ ok: true, value: text }),
      format: (value: string) => value,
    })
    expect(() => createTypeRegistry([wide])).toThrow(
      'Type "wide" has an option named "width", which columns use'
    )
  })
})

describe("a registry's helpers", () => {
  it("bind each column to its type, with the type's options apart", () => {
    expect(stars).toMatchObject({
      id: "stars",
      header: "Stars",
      type: "rating",
      typeDef: rating,
      typeOptions: { max: 10 },
    })
    expect(name).toMatchObject({ type: "text", typeDef: builtInTypes[0] })
    expect(name).not.toHaveProperty("typeOptions")
  })

  it("type-check keys and options against the type", () => {
    expectTypeOf(columns).toEqualTypeOf<Column<Row>[]>()
    // Only compiled, never run: each line must fail to type-check.
    const check = () =>
      types.defineColumns<Row>((c) => [
        // @ts-expect-error name holds text, not a rating
        c.rating("name"),
        // @ts-expect-error max is a number
        c.rating("stars", { max: "ten" }),
        // @ts-expect-error a rating has no currency option
        c.rating("stars", { currency: "EUR" }),
        // @ts-expect-error format receives a number for a rating
        c.rating("stars", { format: (v: string) => v }),
        // @ts-expect-error a select needs its options
        c.select("name"),
        // @ts-expect-error a select needs its options
        c.select("name", { header: "Name" }),
        // @ts-expect-error a rating has no optoins option
        c.rating("stars", { optoins: 3 }),
      ])
    expect(typeof check).toBe("function")
    expectTypeOf<
      TypeHelpers<Row, typeof types.definitions>
    >().not.toHaveProperty("money")
  })

  it("throw for an unknown option or a missing required option", () => {
    type Loose = Record<string, (...args: unknown[]) => Column<Row>>
    const run = (build: (c: Loose) => Column<Row>) =>
      types.defineColumns<Row>((c) => [build(c as unknown as Loose)])
    expect(() => run((c) => c.rating("stars", { optoins: 3 }))).toThrow(
      'Column "stars" has the option "optoins", which the type "rating" does not have'
    )
    expect(() => run((c) => c.select("name"))).toThrow(
      'Column "name" needs the option "options" for the type "select"'
    )
    expect(() => run((c) => c.select("name", { header: "Name" }))).toThrow(
      'Column "name" needs the option "options"'
    )
    expect(() =>
      run((c) => c.select("name", { options: [{ value: "a", label: "A" }] }))
    ).not.toThrow()
  })

  it("make accessor columns read-only unless they write", () => {
    const [double] = types.defineColumns<Row>((c) => [
      c.rating("double", { value: (r) => (r.stars ?? 0) * 2, max: 10 }),
    ])
    expect(double).toMatchObject({ id: "double", typeOptions: { max: 10 } })
    expect(double?.write).toBeUndefined()
  })
})

describe("cell functions with a custom type", () => {
  it("parse, format and validate with the column's options", () => {
    expect(parseCell(stars, "★★★★★★★")).toEqual({ ok: true, value: 7 })
    expect(parseCell(stars, "11")).toEqual({
      ok: false,
      error: '"11" is not 1 to 10 stars',
    })
    expect(formatCell(stars, 4)).toBe("★★★★")
    expect(validateCell(stars, 7, row)).toBeNull()
    expect(validateCell(stars, 0, row)).toEqual({ message: "1 to 10 stars" })
    expect(validateCell(stars, null, row)).toBeNull()
  })

  it("let the column's own parse and format replace the type's", () => {
    const [plain] = types.defineColumns<Row>((c) => [
      c.rating("stars", {
        parse: (text) => parseNumber(text),
        format: (v) => `${v} stars`,
      }),
    ])
    expect(parseCell(plain!, "2")).toEqual({ ok: true, value: 2 })
    expect(formatCell(plain!, 2)).toBe("2 stars")
  })

  it("prepare once per column", () => {
    let runs = 0
    const counted = defineColumnType({
      id: "counted",
      label: "Counted",
      defaultOptions: { suffix: "!" },
      prepare: (options) => {
        runs++
        return options
      },
      parse: (text) => ({ ok: true, value: text }),
      format: (value: string, p) => value + p.suffix,
    })
    const [column] = createTypeRegistry([counted]).defineColumns<Row>((c) => [
      c.counted("name", { suffix: "?" }),
    ])
    expect(runs).toBe(1)
    for (let i = 0; i < 100; i++) formatCell(column!, "a")
    expect(formatCell(column!, "a")).toBe("a?")
    expect(runs).toBe(1)
  })
})

describe("edit and align hints", () => {
  it("default to a text editor at the start of the cell", () => {
    expect(resolveColumnType(code).def.edit).toBeUndefined()
    expect(resolveColumnType(stars).def.align).toBe("end")
    const hints = builtInTypes.map((d) => [d.id, d.edit, d.align])
    expect(hints).toEqual([
      ["text", undefined, undefined],
      ["number", undefined, "end"],
      ["date", undefined, undefined],
      ["select", "popup", undefined],
      ["boolean", "toggle", undefined],
    ])
  })
})

describe("equality", () => {
  it("uses the type's equals, and empty only equals empty", () => {
    expect(cellsEqual(code, "Ab", "aB")).toBe(true)
    expect(cellsEqual(code, "Ab", "b")).toBe(false)
    expect(cellsEqual(name, "Ab", "aB")).toBe(false)
    expect(cellsEqual(price, Number.NaN, Number.NaN)).toBe(true)
    expect(cellsEqual(price, 0, -0)).toBe(false)
    expect(cellsEqual(code, null, null)).toBe(true)
    expect(cellsEqual(code, null, "")).toBe(false)
  })

  it("drops a store patch that sets an equal value", () => {
    const store = createSheetStore<Row>({
      rows: [row],
      columns,
      getRowId: (r) => r.id,
      types,
    })
    expect(store.transaction("edit", (tx) => tx.set("a", "code", "X"))).toBe(
      null
    )
    expect(store.getHistory().canUndo).toBe(false)
    const change = store.transaction("edit", (tx) => tx.set("a", "code", "y"))
    expect(change?.patches).toEqual([
      { rowId: "a", columnId: "code", from: "x", to: "y" },
    ])
  })

  it("drops a typing step that ends equal to where it began", () => {
    let now = 0
    const store = createSheetStore<Row>({
      rows: [row],
      columns,
      getRowId: (r) => r.id,
      types,
      now: () => now,
    })
    store.transaction("edit", (tx) => tx.set("a", "code", "y"))
    now += 100
    store.transaction("edit", (tx) => tx.set("a", "code", "X"))
    expect(store.getHistory().canUndo).toBe(false)
  })
})

describe("compareCells", () => {
  it("orders by the type, with empty cells last", () => {
    const sorted = (column: Column<Row>, values: CellValue[]) =>
      [...values].sort((a, b) => compareCells(column, a, b))
    expect(sorted(price, [10, null, -2, 3.5])).toEqual([-2, 3.5, 10, null])
    expect(sorted(stars, [3, 1, null, 2])).toEqual([1, 2, 3, null])
    const [status, done, due] = defineColumns<Row>((c) => [
      c.select("code", {
        options: [
          { value: "z", label: "Open" },
          { value: "a", label: "Closed" },
        ],
      }),
      c.boolean("done", { value: () => null }),
      c.date("due", { value: () => null }),
    ]) as [Column<Row>, Column<Row>, Column<Row>]
    expect(sorted(status, ["gone", "a", null, "z"])).toEqual([
      "z",
      "a",
      "gone",
      null,
    ])
    expect(sorted(done, [true, false, null])).toEqual([false, true, null])
    expect(sorted(due, ["2026-03-01", "2025-12-31"])).toEqual([
      "2025-12-31",
      "2026-03-01",
    ])
  })

  it("compares the formatted text when the type has no compare", () => {
    expect(compareCells(code, "b", "a")).toBeGreaterThan(0)
    expect(compareCells(code, "a", "B")).toBeLessThan(0)
  })
})

describe("a sheet's types", () => {
  const getRowId = (r: Row) => r.id

  it("must include every column's type", () => {
    expect(() =>
      createSheetStore<Row>({ rows: [], columns, getRowId })
    ).toThrow(
      `Column "stars" has the type "rating", which this sheet's types do not include`
    )
  })

  it("must define it the same way", () => {
    const other = createTypeRegistry([...builtInTypes, { ...rating }, tag])
    expect(() =>
      createSheetStore<Row>({ rows: [], columns, getRowId, types: other })
    ).toThrow(
      `Column "stars" has the type "rating", which this sheet's types define differently`
    )
  })

  it("default to the built-in types", () => {
    const builtIn = defineColumns<Row>((c) => [c.text("name")])
    expect(() =>
      createSheetStore<Row>({ rows: [], columns: builtIn, getRowId })
    ).not.toThrow()
  })
})

describe("column specs", () => {
  it("keep the plain data of a column, which JSON carries", () => {
    const [status] = defineColumns<Row>((c) => [
      c.select("code", {
        header: "Status",
        width: 120,
        pin: "start",
        readOnly: true,
        options: [{ value: "a", label: "A" }],
        validate: () => null,
      }),
    ])
    const spec = toColumnSpec(status!)
    expect(spec).toEqual({
      id: "code",
      header: "Status",
      type: "select",
      typeOptions: { options: [{ value: "a", label: "A" }] },
      width: 120,
      pin: "start",
      readOnly: true,
    })
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec)
    expect(toColumnSpec(name)).toEqual({
      id: "name",
      header: "name",
      type: "text",
    })
  })

  it("leave out a read-only rule that is a function", () => {
    const [c] = defineColumns<Row>((h) => [
      h.text("name", { readOnly: (r) => r.id === "a" }),
    ])
    expect(toColumnSpec(c!)).not.toHaveProperty("readOnly")
  })

  it("turn back into a column that reads and writes the row property", () => {
    const spec: ColumnSpec = {
      id: "stars",
      header: "Stars",
      type: "rating",
      typeOptions: { max: 3 },
      width: 80,
    }
    const column = types.fromSpec<Row>(spec)
    expect(toColumnSpec(column)).toEqual(spec)
    expect(column.typeDef).toBe(rating)
    expect(parseCell(column, "4").ok).toBe(false)
    expect(column.write?.(row, 2)).toEqual({ ...row, stars: 2 })
    const store = createSheetStore<Row>({
      rows: [row],
      columns: [column],
      getRowId: (r) => r.id,
      types,
    })
    expect(store.getValue("a", "stars")).toBe(3)
  })

  it("refuse an unknown type or options the type rejects", () => {
    expect(() =>
      types.fromSpec({ id: "m", header: "M", type: "money" })
    ).toThrow(
      'Column "m" has the type "money", which this registry does not include'
    )
    expect(() =>
      types.fromSpec({
        id: "s",
        header: "S",
        type: "select",
        typeOptions: { options: [{ value: "a", label: "" }] },
      })
    ).toThrow('Column "s": An option has no label')
  })
})

describe("ColumnType", () => {
  it("names the built-in ids and stays open to registered ones", () => {
    expectTypeOf<"number">().toExtend<ColumnType>()
    expectTypeOf<"rating">().toExtend<ColumnType>()
  })
})

// For each type, values `parse(format(v))` must give back. A built-in type
// without an entry here fails the test, so a new type cannot skip it.
const nullable = <T>(arb: fc.Arbitrary<T>) =>
  fc.option(arb, { nil: null, freq: 10 })
const optionList = fc
  .uniqueArray(
    fc.record({
      value: fc.string(),
      label: fc.string({ minLength: 1 }).filter((l) => l.trim() !== ""),
    }),
    { minLength: 1, maxLength: 8, selector: (o) => o.value }
  )
  .filter((list) => new Set(list.map((o) => o.label)).size === list.length)

type Case = fc.Arbitrary<{
  typeOptions?: Record<string, unknown>
  value: CellValue
}>
const values = (arb: fc.Arbitrary<CellValue>): Case =>
  nullable(arb).map((value) => ({ value }))
const roundTrips: Record<string, Case> = {
  text: fc.string({ unit: "grapheme" }).map((value) => ({ value })),
  number: values(
    fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .map((v) => (v === 0 ? 0 : v))
  ),
  date: values(
    fc
      .date({
        min: new Date("0000-01-01T00:00:00Z"),
        max: new Date("9999-12-31T00:00:00Z"),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString().slice(0, 10))
  ),
  boolean: values(fc.boolean()),
  select: optionList.chain((options) =>
    nullable(fc.constantFrom(...options)).map((o) => ({
      typeOptions: { options },
      value: o?.value ?? null,
    }))
  ),
  rating: fc.integer({ min: 1, max: 20 }).chain((max) =>
    nullable(fc.integer({ min: 1, max })).map((value) => ({
      typeOptions: { max },
      value,
    }))
  ),
}

describe("parse(format(v)) equals v", () => {
  it("has a case for every built-in type", () => {
    expect(
      builtInTypes.map((d) => d.id).filter((id) => !roundTrips[id])
    ).toEqual([])
  })

  for (const def of types.definitions) {
    const arb = roundTrips[def.id]
    if (!arb) continue
    it(def.id, () => {
      fc.assert(
        fc.property(arb, ({ typeOptions, value }) => {
          const column = types.fromSpec<Row>({
            id: "x",
            header: "X",
            type: def.id,
            ...(typeOptions ? { typeOptions } : {}),
          })
          const parsed = parseCell(column, formatCell(column, value))
          expect(parsed).toEqual({ ok: true, value })
          if (parsed.ok && value !== null) {
            expect(cellsEqual(column, parsed.value, value)).toBe(true)
            expect(validateCell(column, value, row)).toBeNull()
          }
        })
      )
    })
  }
})
