import { describe, expect, it } from "vitest"

import {
  applyChange,
  builtInTypes,
  cellsEqual,
  compareCells,
  createSheetStore,
  createTypeRegistry,
  defineColumnType,
  defineColumns,
  filterCell,
  formatCell,
  parseCell,
  toColumnSpec,
  validateCell,
  type CellValue,
  type Column,
} from "../src/index.js"
import { phoneType } from "../src/phone.js"

type Row = {
  id: string
  notes: string | null
  share: number | null
  price: number | null
  currency: string | null
  sku: string | null
  email: string | null
  site: string | null
  host: string | null
  phone: string | null
  country: string | null
  tags: readonly string[] | null
}

const blank: Row = {
  id: "r0",
  notes: null,
  share: null,
  price: null,
  currency: null,
  sku: null,
  email: null,
  site: null,
  host: null,
  phone: null,
  country: null,
  tags: null,
}

const one = <V extends CellValue>(column: Column<Row, V> | undefined) =>
  column as unknown as Column<Row>

const ok = (value: CellValue) => ({ ok: true, value })
const error = (message: string) => ({ ok: false, error: message })

describe("long text", () => {
  const [notes] = defineColumns<Row>((c) => [
    c.longtext("notes", { maxLength: 12 }),
  ])
  const column = one(notes)

  it("keeps every line, with Windows and old Mac line ends as \\n", () => {
    expect(parseCell(column, "a\r\nb\rc\nd")).toEqual(ok("a\nb\nc\nd"))
    expect(parseCell(column, "  spaced  ")).toEqual(ok("  spaced  "))
    expect(parseCell(column, "")).toEqual(ok(null))
    expect(formatCell(column, "a\nb")).toBe("a\nb")
  })

  it("flags text over its length", () => {
    expect(validateCell(column, "short", blank)).toBeNull()
    expect(validateCell(column, "a".repeat(13), blank)).toEqual({
      message: "Longer than 12 characters",
    })
  })
})

describe("percent", () => {
  const [share, fraction] = defineColumns<Row>((c) => [
    c.percent("share", { min: 0, max: 1 }),
    c.percent("share", { id: "fraction", bare: "fraction" }),
  ])

  it("stores a fraction and shows points", () => {
    expect(parseCell(one(share), "12.5%")).toEqual(ok(0.125))
    expect(parseCell(one(share), " 12.5 % ")).toEqual(ok(0.125))
    expect(formatCell(one(share), 0.125)).toBe("12.5%")
    expect(formatCell(one(share), 0.3)).toBe("30%")
    expect(formatCell(one(share), 1.5e-7)).toBe("1.5e-5%")
    expect(formatCell(one(share), -2)).toBe("-200%")
  })

  it("reads a bare number as points, unless the column says fraction", () => {
    expect(parseCell(one(share), "12.5")).toEqual(ok(0.125))
    expect(parseCell(one(fraction), "0.125")).toEqual(ok(0.125))
    expect(parseCell(one(fraction), "12.5%")).toEqual(ok(0.125))
  })

  it("rejects money and checks the range", () => {
    expect(parseCell(one(share), "$5")).toEqual(error('"$5" is not a percent'))
    expect(parseCell(one(share), "1,5%").ok).toBe(false)
    expect(validateCell(one(share), 1.2, blank)).toEqual({
      message: "Out of range",
    })
  })
})

describe("money", () => {
  const [eur, jpy, kwd, perRow] = defineColumns<Row>((c) => [
    c.money("price", { currency: "EUR", min: 0 }),
    c.money("price", { id: "jpy", currency: "JPY" }),
    c.money("price", { id: "kwd", currency: "kwd" }),
    c.money("price", {
      id: "perRow",
      currency: "USD",
      currencyFrom: (row: Row) => row.currency,
    }),
  ]).map(one) as [Column<Row>, Column<Row>, Column<Row>, Column<Row>]

  it("shows the currency and reads its symbol or code back", () => {
    expect(formatCell(eur, 1234.5)).toBe("€1,234.50")
    expect(formatCell(eur, -3)).toBe("-€3.00")
    expect(parseCell(eur, "€1,234.50")).toEqual(ok(1234.5))
    expect(parseCell(eur, "-€3.00")).toEqual(ok(-3))
    expect(parseCell(eur, "EUR 12")).toEqual(ok(12))
    expect(parseCell(eur, "12 eur")).toEqual(ok(12))
    expect(parseCell(eur, "1234.5")).toEqual(ok(1234.5))
    expect(formatCell(jpy, 1235)).toBe("¥1,235")
    expect(parseCell(jpy, "¥1,235")).toEqual(ok(1235))
  })

  it("rejects another currency and digits the currency does not have", () => {
    expect(parseCell(eur, "$5")).toEqual(error('"$5" is not in EUR'))
    expect(parseCell(eur, "12%")).toEqual(error('"12%" is not an amount'))
    expect(parseCell(eur, "€12.x")).toEqual(error('"€12.x" is not an amount'))
    expect(parseCell(eur, "12 USD")).toEqual(error('"12 USD" is not in EUR'))
    expect(parseCell(eur, "CA$12")).toEqual(error('"CA$12" is not in EUR'))
    expect(parseCell(eur, "1.234")).toEqual(
      error('"1.234" has more decimals than EUR has (2)')
    )
    expect(parseCell(jpy, "5.5")).toEqual(
      error('"5.5" has more decimals than JPY has (0)')
    )
    expect(validateCell(eur, 1.234, blank)).toEqual({
      message: "More decimals than EUR has",
    })
    expect(validateCell(eur, -1, blank)).toEqual({ message: "Out of range" })
  })

  it("reads one comma group as thousands, unless the currency has three decimals", () => {
    expect(parseCell(eur, "1,234")).toEqual(ok(1234))
    expect(parseCell(kwd, "1,234")).toEqual(
      error('"1,234" is ambiguous: write 1234 or 1.234')
    )
    expect(parseCell(kwd, "1.234")).toEqual(ok(1.234))
  })

  it("shows a row's own currency, but copies and edits in the column's", () => {
    const row = { ...blank, currency: "EUR" }
    expect(formatCell(perRow, 5, row)).toBe("€5.00")
    expect(formatCell(perRow, 5, { ...blank, currency: null })).toBe("$5.00")
    expect(formatCell(perRow, 5, { ...blank, currency: "nope" })).toBe("$5.00")
    expect(formatCell(perRow, 5)).toBe("$5.00")
    expect(toColumnSpec(perRow).typeOptions).toEqual({ currency: "USD" })
  })

  it("needs a real currency", () => {
    expect(() =>
      defineColumns<Row>((c) => [c.money("price", { currency: "EURO" })])
    ).toThrow('Column "price": "EURO" is not a currency')
  })
})

describe("identifier", () => {
  const [sku, upper] = defineColumns<Row>((c) => [
    c.identifier("sku", { pattern: "[A-Z]+-\\d+" }),
    c.identifier("sku", { id: "upper", case: "upper", required: false }),
  ]).map(one) as [Column<Row>, Column<Row>]

  it("trims, refuses spaces inside and can change case", () => {
    expect(parseCell(sku, "  AB-1 ")).toEqual(ok("AB-1"))
    expect(parseCell(sku, "AB 1")).toEqual(error('"AB 1" has a space in it'))
    expect(parseCell(upper, "ab-1")).toEqual(ok("AB-1"))
  })

  it("checks the pattern and the case, and is required by default", () => {
    expect(validateCell(sku, "ab-1", blank)).toEqual({
      message: "Does not match [A-Z]+-\\d+",
    })
    expect(validateCell(upper, "ab", blank)).toEqual({
      message: "Not in upper case",
    })
    expect(validateCell(sku, null, blank)).toEqual({ message: "Required" })
    expect(validateCell(upper, null, blank)).toBeNull()
  })

  it("orders digits as numbers", () => {
    const sorted = ["A-10", "A-9", "B-1", "A-9b"].sort((a, b) =>
      compareCells(sku, a, b)
    )
    expect(sorted).toEqual(["A-9", "A-9b", "A-10", "B-1"])
  })

  it("rejects a pattern that is not a regular expression", () => {
    expect(() =>
      defineColumns<Row>((c) => [c.identifier("sku", { pattern: "(" })])
    ).toThrow('Column "sku": The pattern "(" is not valid')
  })
})

describe("identifier uniqueness", () => {
  const [sku] = defineColumns<Row>((c) => [c.identifier("sku")])
  const column = one(sku)
  const rows = (...skus: (string | null)[]): Row[] =>
    skus.map((s, i) => ({ ...blank, id: `r${i}`, sku: s }))
  const issues = (data: readonly Row[]) =>
    data.map((r) => validateCell(column, r.sku, r, data)?.message ?? null)

  it("flags each repeat with another row that holds it", () => {
    expect(issues(rows("A", "B", "A", "C", "A"))).toEqual([
      "Also in row 3",
      null,
      "Also in row 1",
      null,
      "Also in row 1",
    ])
  })

  it("does not check without the rows", () => {
    const data = rows("A", "A")
    expect(validateCell(column, "A", data[0]!)).toBeNull()
  })

  it("follows commits, undo, inserts and removes without a rebuild", () => {
    const store = createSheetStore<Row>({
      rows: rows("A", "B", "C"),
      columns: [column],
      getRowId: (r) => r.id,
    })
    const now = () => issues(store.getRows())
    expect(now()).toEqual([null, null, null])
    store.transaction("edit", (tx) => tx.set("r2", "sku", "A"))
    expect(now()).toEqual(["Also in row 3", null, "Also in row 1"])
    store.transaction("insert", (tx) =>
      tx.insert(0, [{ ...blank, id: "n", sku: "B" }])
    )
    expect(now()).toEqual([
      "Also in row 3",
      "Also in row 4",
      "Also in row 1",
      "Also in row 2",
    ])
    store.transaction("remove", (tx) => tx.remove(["r0"]))
    expect(now()).toEqual(["Also in row 2", "Also in row 1", null])
    store.undo()
    store.undo()
    expect(now()).toEqual(["Also in row 3", null, "Also in row 1"])
    store.undo()
    expect(now()).toEqual([null, null, null])
  })

  it("stays fast when one value repeats on 20,000 of 100,000 rows", () => {
    const data = rows(
      ...Array.from({ length: 100_000 }, (_, i) =>
        i % 5 === 0 ? "DUP" : `S${i}`
      )
    )
    const started = performance.now()
    const found = data
      .slice(0, 50)
      .filter((r) => r.sku === "DUP")
      .map((r) => validateCell(column, r.sku, r, data)?.message)
    const elapsed = performance.now() - started
    expect(found).toHaveLength(10)
    expect(found[0]).toBe("Also in row 6")
    expect(found[1]).toBe("Also in row 1")
    expect(elapsed).toBeLessThan(100)
  })

  it("keeps each array's own answer when a change branches from it", () => {
    const getRowId = (r: Row) => r.id
    const before = rows("A", "B")
    expect(issues(before)).toEqual([null, null])
    const change = {
      source: "edit" as const,
      patches: [{ rowId: "r1", columnId: "sku", from: "B", to: "A" }],
    }
    const after = applyChange(before, change, { columns: [column], getRowId })
    expect(issues(after)).toEqual(["Also in row 2", "Also in row 1"])
    expect(issues(before)).toEqual([null, null])
  })
})

describe("email", () => {
  const [email] = defineColumns<Row>((c) => [c.email("email")])
  const column = one(email)

  it("keeps only the address", () => {
    expect(parseCell(column, " ada@example.test ")).toEqual(
      ok("ada@example.test")
    )
    expect(parseCell(column, "Ada Lovelace <ada@example.test>")).toEqual(
      ok("ada@example.test")
    )
    expect(parseCell(column, "mailto:ada@example.test?subject=Hi")).toEqual(
      ok("ada@example.test")
    )
    expect(parseCell(column, "ada@")).toEqual(
      error('"ada@" is not an email address')
    )
  })

  it("flags a stored value that is not an address", () => {
    expect(validateCell(column, "nope", blank)).toEqual({
      message: "Not an email address",
    })
  })

  it("filters by domain", () => {
    expect(
      filterCell(column, "domainIs", "ada@Example.test", ["example.TEST"])
    ).toBe(true)
    expect(
      filterCell(column, "domainIs", "ada@other.test", ["example.test"])
    ).toBe(false)
  })
})

describe("url", () => {
  const [site, any] = defineColumns<Row>((c) => [
    c.url("site"),
    c.url("site", { id: "any", schemes: ["https", "ftp"] }),
  ]).map(one) as [Column<Row>, Column<Row>]

  it("adds https:// and drops a lone slash", () => {
    expect(parseCell(site, "example.test/a?b=1")).toEqual(
      ok("https://example.test/a?b=1")
    )
    expect(parseCell(site, "https://Example.test/")).toEqual(
      ok("https://example.test")
    )
    expect(parseCell(site, "http://example.test")).toEqual(
      ok("http://example.test")
    )
    expect(parseCell(site, "example.test:8080/a")).toEqual(
      ok("https://example.test:8080/a")
    )
  })

  it("never makes a link of another scheme", () => {
    expect(parseCell(site, "javascript:alert(1)")).toEqual(
      error('"javascript:alert(1)" is not a http or https link')
    )
    expect(parseCell(any, "ftp://example.test/f")).toEqual(
      ok("ftp://example.test/f")
    )
    expect(validateCell(site, "javascript:alert(1)", blank)).toEqual({
      message: "Not a link",
    })
  })

  it("shows the host and path", () => {
    expect(formatCell(site, "https://example.test/a")).toBe("example.test/a")
    expect(formatCell(site, "http://example.test/a")).toBe(
      "http://example.test/a"
    )
    expect(
      filterCell(site, "hostIs", "https://example.test/a", ["example.test"])
    ).toBe(true)
  })
})

describe("domain", () => {
  const [host, bare] = defineColumns<Row>((c) => [
    c.domain("host"),
    c.domain("host", { id: "bare", stripWww: true }),
  ]).map(one) as [Column<Row>, Column<Row>]

  it("keeps the host of a link, lowercase and in ASCII", () => {
    expect(parseCell(host, "https://www.Bücher.example/path")).toEqual(
      ok("www.xn--bcher-kva.example")
    )
    expect(parseCell(bare, "www.example.test.")).toEqual(ok("example.test"))
    expect(parseCell(host, "example.test:8080")).toEqual(ok("example.test"))
    expect(parseCell(host, "localhost:3000/x")).toEqual(
      error('"localhost:3000/x" has no dot')
    )
  })

  it("rejects what is not a domain", () => {
    expect(parseCell(host, "localhost")).toEqual(
      error('"localhost" has no dot')
    )
    expect(parseCell(host, "10.0.0.1")).toEqual(
      error('"10.0.0.1" is an address, not a domain')
    )
    expect(parseCell(host, "a b")).toEqual(error('"a b" is not a domain'))
    expect(validateCell(host, "-bad.example", blank)).toEqual({
      message: "Not a domain",
    })
  })

  it("matches subdomains", () => {
    expect(filterCell(host, "is", "shop.example.test", ["example.test"])).toBe(
      true
    )
    expect(filterCell(host, "is", "notexample.test", ["example.test"])).toBe(
      false
    )
  })
})

describe("phone, shape only", () => {
  const [phone] = defineColumns<Row>((c) => [c.phone("phone")])
  const column = one(phone)

  it("stores the international form", () => {
    expect(parseCell(column, "+44 (20) 7946-0958")).toEqual(ok("+442079460958"))
    expect(parseCell(column, "0044 20 7946 0958")).toEqual(ok("+442079460958"))
    expect(parseCell(column, "tel:+4420.7946.0958")).toEqual(
      ok("+442079460958")
    )
  })

  it("needs the country code and 7 to 15 digits", () => {
    expect(parseCell(column, "020 7946 0958")).toEqual(
      error('"020 7946 0958" needs its country code, such as +44 or 0044')
    )
    expect(parseCell(column, "+12345")).toEqual(
      error('"+12345" is not a phone number of 7 to 15 digits')
    )
    expect(validateCell(column, "12345678", blank)).toEqual({
      message: "Not a phone number",
    })
  })
})

describe("phone, with the adapter", () => {
  const types = createTypeRegistry([
    ...builtInTypes.filter((t) => t.id !== "phone"),
    phoneType,
  ])
  const [gb, anywhere] = types
    .defineColumns<Row>((c) => [
      c.phone("phone", { defaultCountry: "gb" }),
      c.phone("phone", { id: "anywhere" }),
    ])
    .map(one) as [Column<Row>, Column<Row>]

  it("reads national numbers with the default country", () => {
    expect(parseCell(gb, "020 7946 0958")).toEqual(ok("+442079460958"))
    expect(parseCell(anywhere, "020 7946 0958")).toEqual(
      error('"020 7946 0958" needs its country code, such as +44 or 0044')
    )
  })

  it("shows the number in groups and reads it back", () => {
    expect(formatCell(gb, "+442079460958")).toBe("+44 20 7946 0958")
    expect(parseCell(gb, "+44 20 7946 0958")).toEqual(ok("+442079460958"))
  })

  it("rejects a number its country cannot have", () => {
    expect(parseCell(gb, "+44 20 79")).toEqual(
      error('"+44 20 79" is not a possible number for its country')
    )
    expect(validateCell(gb, "+4420794", blank)).toEqual({
      message: "Not a possible phone number",
    })
  })

  it("needs a country with phone numbers", () => {
    expect(() =>
      types.defineColumns<Row>((c) => [
        c.phone("phone", { defaultCountry: "XX" }),
      ])
    ).toThrow('Column "phone": "XX" is not a country with phone numbers')
  })
})

describe("country", () => {
  const [country, german] = defineColumns<Row>((c) => [
    c.country("country"),
    c.country("country", { id: "german", locale: "de", showCode: true }),
  ]).map(one) as [Column<Row>, Column<Row>]

  it("reads codes, alpha-3 codes and names, ignoring case and accents", () => {
    expect(parseCell(country, "no")).toEqual(ok("NO"))
    expect(parseCell(country, "NOR")).toEqual(ok("NO"))
    expect(parseCell(country, "norway")).toEqual(ok("NO"))
    expect(parseCell(country, "Cote d'Ivoire")).toEqual(ok("CI"))
    expect(parseCell(german, "Norwegen")).toEqual(ok("NO"))
    expect(parseCell(german, "Norway")).toEqual(ok("NO"))
    expect(parseCell(country, "UK")).toEqual(ok("GB"))
    expect(parseCell(country, "Atlantis")).toEqual(
      error('"Atlantis" is not a country')
    )
  })

  it("shows the name in the column's language", () => {
    expect(formatCell(country, "NO")).toBe("Norway")
    expect(formatCell(german, "NO")).toBe("Norwegen (NO)")
    expect(parseCell(german, "Norwegen (NO)")).toEqual(ok("NO"))
    expect(formatCell(country, "XK")).toBe("XK")
  })

  it("only knows the assigned codes and sorts by name", () => {
    expect(validateCell(country, "XK", blank)).toEqual({
      message: "Not a country code",
    })
    const sorted = ["NO", "DE", "AT"].sort((a, b) => compareCells(german, a, b))
    expect(sorted).toEqual(["DE", "NO", "AT"])
    expect(filterCell(country, "isAnyOf", "NO", ["Sweden", "nor"])).toBe(true)
  })
})

describe("list values", () => {
  // A type that stores a list of strings, as tags will.
  const words = defineColumnType({
    id: "words",
    label: "Words",
    defaultOptions: {},
    parse: (text) => ({
      ok: true,
      value: text.trim() ? text.split(",").map((w) => w.trim()) : null,
    }),
    format: (value: readonly string[]) => value.join(", "),
  })
  const types = createTypeRegistry([...builtInTypes, words])
  const [tags] = types.defineColumns<Row>((c) => [c.words("tags")])
  const column = one(tags)

  it("compares lists by their items", () => {
    expect(cellsEqual(column, ["a", "b"], ["a", "b"])).toBe(true)
    expect(cellsEqual(column, ["a", "b"], ["b", "a"])).toBe(false)
    expect(cellsEqual(column, ["a"], ["a", "a"])).toBe(false)
    expect(cellsEqual(column, [], null)).toBe(false)
  })

  it("lets the store drop a set to an equal list", () => {
    const store = createSheetStore<Row>({
      rows: [{ ...blank, tags: ["a", "b"] }],
      columns: [column],
      getRowId: (r) => r.id,
      types,
    })
    expect(
      store.transaction("edit", (tx) => tx.set("r0", "tags", ["a", "b"]))
    ).toBeNull()
    const change = store.transaction("edit", (tx) =>
      tx.set("r0", "tags", ["a", "c"])
    )
    expect(change?.patches).toEqual([
      { rowId: "r0", columnId: "tags", from: ["a", "b"], to: ["a", "c"] },
    ])
    store.undo()
    expect(store.getValue("r0", "tags")).toEqual(["a", "b"])
  })
})

describe("filters", () => {
  const [name, qty, due, done, status] = defineColumns<
    Row & {
      name: string | null
      qty: number | null
      due: string | null
      done: boolean | null
      status: string | null
    }
  >((c) => [
    c.text("name"),
    c.number("qty"),
    c.date("due"),
    c.boolean("done"),
    c.select("status", {
      options: [
        { value: "open", label: "Open" },
        { value: "shut", label: "Closed" },
      ],
    }),
  ]).map((c) => c as unknown as Column<Row>) as [
    Column<Row>,
    Column<Row>,
    Column<Row>,
    Column<Row>,
    Column<Row>,
  ]

  it("cover the built-in types", () => {
    expect(filterCell(name, "contains", "Desk Lamp", ["lamp"])).toBe(true)
    expect(filterCell(name, "is", "Desk", [" desk "])).toBe(true)
    expect(filterCell(name, "empty", null)).toBe(true)
    expect(filterCell(name, "contains", null, ["a"])).toBe(false)
    expect(filterCell(qty, "between", 5, ["1", "5"])).toBe(true)
    expect(filterCell(qty, "lessThan", 5, ["1,000.5"])).toBe(true)
    expect(filterCell(qty, "greaterThan", 5, ["x"])).toBe(false)
    expect(filterCell(due, "lessThan", "2026-01-01", ["2026-03-01"])).toBe(true)
    expect(filterCell(done, "is", true, ["yes"])).toBe(true)
    expect(filterCell(status, "isAnyOf", "shut", ["Open", "closed"])).toBe(true)
  })

  it("throw for a filter the type does not have", () => {
    expect(() => filterCell(done, "contains", true, ["t"])).toThrow(
      'Column "done" (Checkbox) has no filter "contains"'
    )
  })

  it("exist for every built-in type, each id once", () => {
    for (const def of builtInTypes) {
      const ids = (def.filters ?? []).map((f) => f.id)
      expect(ids.length, def.id).toBeGreaterThan(0)
      expect(new Set(ids).size, def.id).toBe(ids.length)
    }
  })
})
