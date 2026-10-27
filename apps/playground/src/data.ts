import { builtInTypes, createTypeRegistry } from "@sheetcn/core"
import { phoneType } from "@sheetcn/core/phone"

// Generic demo rows, seeded so every load is the same: 20 columns across the
// built-in column types. Phone numbers use the libphonenumber-js adapter.

export const types = createTypeRegistry([
  ...builtInTypes.filter((t) => t.id !== "phone"),
  phoneType,
])

export type Item = {
  id: string
  name: string | null
  sku: string
  category: string | null
  status: string | null
  price: number | null
  quantity: number | null
  discount: number | null
  ordered: string | null
  shipped: string | null
  inStock: boolean | null
  country: string | null
  email: string | null
  phone: string | null
  rating: number | null
  website: string | null
  region: string | null
  priority: string | null
  notes: string | null
  supplier: string | null
}

const ADJECTIVES = [
  "Compact",
  "Classic",
  "Smart",
  "Rugged",
  "Quiet",
  "Bright",
  "Modular",
  "Portable",
  "Steel",
  "Oak",
]
const NOUNS = [
  "Desk",
  "Lamp",
  "Chair",
  "Shelf",
  "Router",
  "Monitor",
  "Kettle",
  "Drill",
  "Speaker",
  "Cable",
]
const COUNTRIES = ["PT", "NO", "US", "FR", "JP", "KE", "EC", "AU", "IT", "DK"]
const SUPPLIERS = [
  "oakworks.example",
  "northwind-tools.example",
  "brightline.example",
  "kettle.example",
  "steelyard.example",
]
const NOTES = [
  null,
  "Check stock before shipping",
  "Gift wrap",
  "Fragile\nKeep it upright",
  "Bulk order, call first\nAsk for the warehouse\nNot before 9:00",
  "Return requested",
]

const options = (...labels: string[]) =>
  labels.map((label) => ({ value: label.toLowerCase(), label }))

export const columns = types.defineColumns<Item>((c) => [
  c.text("name", {
    header: "Name",
    width: 200,
    pin: "start",
    validate: (v) => (v ? null : { message: "Name is required" }),
  }),
  c.text("code", { header: "SKU", width: 110, value: (r) => r.sku }),
  c.select("category", {
    header: "Category",
    width: 130,
    options: options(
      "Hardware",
      "Software",
      "Services",
      "Supplies",
      "Furniture"
    ),
  }),
  c.select("status", {
    header: "Status",
    width: 110,
    options: options("Draft", "Active", "Paused", "Archived"),
  }),
  c.money("price", {
    header: "Price",
    width: 100,
    currency: "USD",
    validate: (v) =>
      v !== null && v < 0 ? { message: "Price cannot be negative" } : null,
  }),
  c.number("quantity", {
    header: "Qty",
    width: 72,
    validate: (v) =>
      v !== null && (!Number.isInteger(v) || v < 0)
        ? { message: "Quantity must be a whole number, 0 or more" }
        : null,
  }),
  c.percent("discount", { header: "Discount", width: 100 }),
  c.date("ordered", { header: "Ordered", width: 120 }),
  c.date("shipped", {
    header: "Shipped",
    width: 120,
    validate: (v, row) =>
      v !== null && row.ordered !== null && v < row.ordered
        ? { message: "Shipped before it was ordered" }
        : null,
  }),
  c.boolean("inStock", { header: "In stock", width: 100 }),
  c.country("country", { header: "Country", width: 120 }),
  c.email("email", { header: "Contact email", width: 220 }),
  c.phone("phone", { header: "Phone", width: 150, defaultCountry: "GB" }),
  c.number("rating", {
    header: "Rating",
    width: 80,
    validate: (v) =>
      v !== null && (v < 1 || v > 5) ? { message: "Rating is 1 to 5" } : null,
  }),
  c.url("website", { header: "Website", width: 250 }),
  c.select("region", {
    header: "Region",
    width: 100,
    options: options("North", "South", "East", "West"),
  }),
  c.select("priority", {
    header: "Priority",
    width: 100,
    options: options("Low", "Medium", "High"),
  }),
  c.longtext("notes", { header: "Notes", width: 260 }),
  c.domain("supplier", { header: "Supplier", width: 190 }),
  c.identifier("rowId", { header: "ID", width: 90, value: (r) => r.id }),
])

export const getRowId = (row: Item) => row.id

function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (n: number, width: number) => String(n).padStart(width, "0")
const day = (base: number, offset: number) =>
  new Date(base + offset * 86_400_000).toISOString().slice(0, 10)

export function makeItems(count: number, seed = 7): Item[] {
  const r = random(seed)
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(r() * list.length)] as T
  const base = Date.UTC(2026, 0, 1)
  const categories = [
    "hardware",
    "software",
    "services",
    "supplies",
    "furniture",
  ]
  const statuses = ["draft", "active", "paused", "archived"]
  const regions = ["north", "south", "east", "west"]
  const priorities = ["low", "medium", "high"]
  const out: Item[] = []
  for (let i = 0; i < count; i++) {
    const ordered = Math.floor(r() * 280)
    // Each field draws from the seed as the fields it replaced did, so the
    // other columns keep their values.
    out.push({
      id: `r${pad(i + 1, 6)}`,
      name: `${pick(ADJECTIVES)} ${pick(NOUNS)} ${pad(i + 1, 6)}`,
      sku: `SKU-${pad(Math.floor(r() * 1e6), 6)}`,
      category: pick(categories),
      status: pick(statuses),
      price: Math.round(r() * 100000) / 100,
      quantity: Math.floor(r() * 500),
      discount: Math.round(r() * 30) / 100,
      ordered: day(base, ordered),
      shipped: r() < 0.8 ? day(base, ordered + Math.floor(r() * 14)) : null,
      inStock: r() < 0.7,
      country: pick(COUNTRIES),
      email: `orders${pad(i % 997, 3)}@example.com`,
      // Numbers in a range set aside for drama, so none is a real line.
      phone: `+442079460${pad(Math.floor(r() * 1000), 3)}`,
      rating: 1 + Math.floor(r() * 5),
      website: `https://${pick(SUPPLIERS)}/p/${pad(i + 1, 6)}`,
      region: pick(regions),
      priority: pick(priorities),
      notes: pick(NOTES),
      supplier: pick(SUPPLIERS),
    })
  }
  return out
}
