import { defineColumns } from "@sheetcn/core"

// Generic demo rows, seeded so every load is the same: 20 columns of the
// five column types.

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
  city: string | null
  email: string | null
  owner: string | null
  rating: number | null
  weight: number | null
  region: string | null
  priority: string | null
  notes: string | null
  updated: string | null
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
const CITIES = [
  "Lisbon",
  "Oslo",
  "Austin",
  "Lyon",
  "Osaka",
  "Porto",
  "Nairobi",
  "Quito",
  "Perth",
  "Turin",
]
const OWNERS = ["Team A", "Team B", "Team C", "Ops", "Sales", "Support"]
const NOTES = [
  null,
  "Check stock before shipping",
  "Gift wrap",
  "Fragile",
  "Bulk order, call first",
  "Return requested",
]

const options = (...labels: string[]) =>
  labels.map((label) => ({ value: label.toLowerCase(), label }))

export const columns = defineColumns<Item>((c) => [
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
  c.number("price", {
    header: "Price",
    width: 100,
    format: (v) => v.toFixed(2),
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
  c.number("discount", {
    header: "Discount",
    width: 100,
    // Whole and fractional percents both read back: "12.5%" parses to 0.125.
    format: (v) => `${Number((v * 100).toFixed(4))}%`,
  }),
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
  c.text("city", { header: "City", width: 120 }),
  c.text("email", {
    header: "Contact email",
    width: 220,
    validate: (v) =>
      v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
        ? { message: "Not an email address" }
        : null,
  }),
  c.text("owner", { header: "Owner", width: 110 }),
  c.number("rating", {
    header: "Rating",
    width: 80,
    validate: (v) =>
      v !== null && (v < 1 || v > 5) ? { message: "Rating is 1 to 5" } : null,
  }),
  c.number("weight", { header: "Weight kg", width: 100 }),
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
  c.text("notes", { header: "Notes", width: 260 }),
  c.date("updated", { header: "Updated", width: 120 }),
  c.text("rowId", { header: "ID", width: 90, value: (r) => r.id }),
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
      city: pick(CITIES),
      email: `orders${pad(i % 997, 3)}@example.com`,
      owner: pick(OWNERS),
      rating: 1 + Math.floor(r() * 5),
      weight: Math.round(r() * 5000) / 100,
      region: pick(regions),
      priority: pick(priorities),
      notes: pick(NOTES),
      updated: day(base, 280 + Math.floor(r() * 20)),
    })
  }
  return out
}
