import { describe, expect, it } from "vitest"

import {
  canFilter,
  createTypeRegistry,
  builtInTypes,
  defineColumnType,
  defineColumns,
  describeCondition,
  filterChoices,
  filterLabel,
  valueChoices,
  type Column,
} from "../src/index.js"

type Row = {
  id: string
  name: string | null
  price: number | null
  share: number | null
  due: string | null
  status: string | null
  country: string | null
}

const [name, price, share, due, status, country] = defineColumns<Row>((c) => [
  c.text("name", { header: "Name" }),
  c.number("price", { header: "Price" }),
  c.percent("share", { header: "Share" }),
  c.date("due", { header: "Due" }),
  c.select("status", {
    header: "Status",
    options: [
      { value: "review", label: "Needs review" },
      { value: "open", label: "Open" },
      { value: "shut", label: "Closed" },
    ],
  }),
  c.country("country", { header: "Country" }),
]) as [
  Column<Row>,
  Column<Row>,
  Column<Row>,
  Column<Row>,
  Column<Row>,
  Column<Row>,
]

describe("filterChoices", () => {
  it("lists each filter, then its negation", () => {
    expect(filterChoices(price).map((c) => c.label)).toEqual([
      "is",
      "is not",
      "less than",
      "greater than",
      "between",
      "is not between",
      "is empty",
      "is not empty",
    ])
    expect(filterChoices(status)[1]).toEqual({
      op: "isAnyOf",
      not: true,
      label: "is none of",
      operands: "many",
    })
  })

  it("words a negation the type does not name", () => {
    expect(filterLabel(due, "inLast", true)).toBe("not in the last")
    expect(filterLabel(name, "contains", true)).toBe("does not contain")
  })

  it("knows a column whose type has no filters", () => {
    const plain = defineColumnType({
      id: "plain",
      label: "Plain",
      defaultOptions: {},
      parse: (text) => ({ ok: true, value: text }),
      format: (value: string) => value,
    })
    const types = createTypeRegistry([...builtInTypes, plain])
    const [column] = types.defineColumns<{ id: string; p: string }>((c) => [
      c.plain("p"),
    ])
    expect(canFilter(column as Column<{ id: string; p: string }>)).toBe(false)
    expect(canFilter(name)).toBe(true)
  })
})

describe("describeCondition", () => {
  it("shows values as the column shows them", () => {
    expect(
      describeCondition(
        { column: "status", op: "isAnyOf", values: ["review", "Closed"] },
        status
      )
    ).toEqual({
      column: "Status",
      op: "is any of",
      values: ["Needs review", "Closed"],
      value: "Needs review, Closed",
      sentence: "Status, is any of, Needs review and Closed",
    })
    expect(
      describeCondition(
        { column: "share", op: "lessThan", values: ["80"] },
        share
      ).value
    ).toBe("80%")
  })

  it("quotes word filters, joins ranges and counts long lists", () => {
    expect(
      describeCondition(
        { column: "name", op: "contains", values: ["test"], not: true },
        name
      )
    ).toMatchObject({ op: "does not contain", value: '"test"' })
    expect(
      describeCondition(
        { column: "price", op: "between", values: ["0.2", "0.8"] },
        price
      ).value
    ).toBe("0.2 and 0.8")
    expect(
      describeCondition(
        { column: "status", op: "isAnyOf", values: ["review", "open", "shut"] },
        status
      ).value
    ).toBe("3 values")
    expect(
      describeCondition({ column: "status", op: "empty", values: [] }, status)
    ).toMatchObject({ value: "", sentence: "Status, is empty" })
  })

  it("words relative dates", () => {
    expect(
      describeCondition(
        { column: "due", op: "inLast", values: ["30", "days"] },
        due
      ).value
    ).toBe("30 days")
    expect(
      describeCondition(
        { column: "due", op: "within", values: ["lastMonth"] },
        due
      ).value
    ).toBe("last month")
  })

  it("shows a value that does not parse as typed, and an unknown column by id", () => {
    expect(
      describeCondition(
        { column: "due", op: "greaterThan", values: ["2026-13-01"] },
        due
      ).value
    ).toBe("2026-13-01")
    expect(
      describeCondition({ column: "gone", op: "is", values: ["x"] }, undefined)
    ).toMatchObject({ column: "gone", value: "x" })
  })
})

describe("valueChoices", () => {
  const rows: Row[] = ["review", "open", "review", null, "shut", "review"].map(
    (s, i) => ({
      id: `r${i}`,
      name: null,
      price: null,
      share: null,
      due: null,
      status: s,
      country: ["NO", "SE", "NO", null, null, "DK"][i] ?? null,
    })
  )

  it("lists the values held, in the column's order, with counts", () => {
    expect(valueChoices(rows, status)).toEqual([
      { text: "review", label: "Needs review", count: 3 },
      { text: "open", label: "Open", count: 1 },
      { text: "shut", label: "Closed", count: 1 },
    ])
    expect(valueChoices(rows, country)).toEqual([
      { text: "DK", label: "Denmark", count: 1 },
      { text: "NO", label: "Norway", count: 2 },
      { text: "SE", label: "Sweden", count: 1 },
    ])
  })
})
