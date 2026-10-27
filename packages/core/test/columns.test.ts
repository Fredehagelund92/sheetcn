import { describe, expect, expectTypeOf, it } from "vitest"

import {
  assertColumns,
  defineColumns,
  getCellValue,
  isCellReadOnly,
  type Column,
} from "../src/index.js"

type Item = {
  id: string
  name: string
  price: number
  qty: number | null
  shipped: boolean
  sku: string
}

const item: Item = {
  id: "a",
  name: "Desk lamp",
  price: 12.5,
  qty: 2,
  shipped: false,
  sku: "DL-1",
}

describe("defineColumns", () => {
  const columns = defineColumns<Item>((c) => [
    c.text("name", { header: "Name", width: 200 }),
    c.number("price", { format: (v) => v.toFixed(2) }),
    c.number("total", {
      header: "Total",
      value: (r) => r.price * (r.qty ?? 0),
    }),
    c.boolean("shipped"),
    c.text("sku", { readOnly: true }),
    c.number("qty", { id: "quantity", readOnly: (r) => r.shipped }),
  ])
  const byId = (id: string) => columns.find((c) => c.id === id) as Column<Item>

  it("keeps a select's options as its type options", () => {
    const [status] = defineColumns<Item>((c) => [
      c.select("sku", { header: "SKU", options: [{ value: "a", label: "A" }] }),
    ])
    expect(status).toMatchObject({
      id: "sku",
      header: "SKU",
      type: "select",
      typeOptions: { options: [{ value: "a", label: "A" }] },
    })
    expect(status).not.toHaveProperty("options")
  })

  it("returns plain columns with ids, headers and types", () => {
    expectTypeOf(columns).toEqualTypeOf<Column<Item>[]>()
    expect(columns.map((c) => [c.id, c.header, c.type])).toEqual([
      ["name", "Name", "text"],
      ["price", "price", "number"],
      ["total", "Total", "number"],
      ["shipped", "shipped", "boolean"],
      ["sku", "sku", "text"],
      ["quantity", "quantity", "number"],
    ])
    expect(byId("name").width).toBe(200)
  })

  it("reads key and accessor columns", () => {
    expect(getCellValue(byId("price"), item)).toBe(12.5)
    expect(getCellValue(byId("total"), item)).toBe(25)
    expect(getCellValue(byId("quantity"), item)).toBe(2)
    expect(getCellValue(byId("quantity"), { ...item, qty: null })).toBeNull()
  })

  it("writes key columns to a copy of the row", () => {
    const next = byId("price").write?.(item, 9)
    expect(next).toEqual({ ...item, price: 9 })
    expect(next).not.toBe(item)
    expect(item.price).toBe(12.5)
  })

  it("makes accessor columns without write read-only", () => {
    expect(byId("total").write).toBeUndefined()
    expect(isCellReadOnly(byId("total"), item)).toBe(true)
    expect(isCellReadOnly(byId("price"), item)).toBe(false)
    expect(isCellReadOnly(byId("sku"), item)).toBe(true)
    expect(isCellReadOnly(byId("quantity"), item)).toBe(false)
    expect(isCellReadOnly(byId("quantity"), { ...item, shipped: true })).toBe(
      true
    )
  })

  it("type-checks keys against the value type", () => {
    // Only compiled, never run: each line must fail to type-check.
    const check = () =>
      defineColumns<Item>((c) => [
        // @ts-expect-error price holds a number, not text
        c.text("price"),
        // @ts-expect-error name holds text, not a number
        c.number("name"),
        // @ts-expect-error there is no such key, and no value function
        c.number("missing"),
        // @ts-expect-error format receives a number for a number column
        c.number("price", { format: (v: string) => v }),
        // @ts-expect-error a select's options are a list
        c.select("name", { options: "a, b" }),
        // @ts-expect-error a number type has no options
        c.number("price", { options: [] }),
      ])
    expect(typeof check).toBe("function")
  })
})

describe("assertColumns", () => {
  it("rejects repeated ids", () => {
    expect(() =>
      defineColumns<Item>((c) => [
        c.text("name"),
        c.text("sku", { id: "name" }),
      ])
    ).toThrow('Two columns have the id "name"')
  })

  it("rejects repeated or empty option labels and values", () => {
    const select = (options: { value: string; label: string }[]) => () =>
      assertColumns<Item>([
        {
          id: "s",
          header: "S",
          type: "select",
          value: "name",
          typeOptions: { options },
        },
      ])
    expect(
      select([
        { value: "a", label: "A" },
        { value: "b", label: "A" },
      ])
    ).toThrow('Column "s": Two options have the value "b" or the label "A"')
    expect(
      select([
        { value: "a", label: "A" },
        { value: "a", label: "B" },
      ])
    ).toThrow('Column "s": Two options have the value "a"')
    expect(select([{ value: "a", label: " " }])).toThrow(
      'Column "s": An option has no label'
    )
    expect(select([{ value: "a", label: "A" }])).not.toThrow()
  })

  it("rejects a type that is not built in, unless a registry built the column", () => {
    expect(() =>
      assertColumns<Item>([
        { id: "r", header: "R", type: "rating", value: "price" },
      ])
    ).toThrow(
      'Column "r" has the type "rating", which is not built in; build the column with the registry that defines it'
    )
  })
})
