import { chromium, expect, test as base, type Page } from "@playwright/test"

import type { SheetView } from "@sheetcn/core"

// Gates for a view at 100,000 rows by 20 columns, to paint, in the browser:
// a filter under 50 ms, a sort under 100 ms, and a one-cell commit with a
// filter and a sort on under 5 ms. Each gate is the median of three rounds,
// so one busy moment on the machine moves one round, not the gate.

// Each gate runs in a browser of its own, so the garbage one gate leaves
// (views over 100,000 rows built and dropped) is not collected while the
// next one measures.
const test = base.extend<{ page: Page }>({
  page: async ({ baseURL }, provide) => {
    const browser = await chromium.launch()
    const page = await browser.newPage(baseURL ? { baseURL } : {})
    await provide(page)
    await browser.close()
  },
})

type Stats = { median: number; p95: number; max: number; runs: number }
type ViewStats = Stats & { first: number; shown: number }

const ROUNDS = 3

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number

async function rounds<T extends Stats>(
  name: string,
  round: () => Promise<T>
): Promise<{ median: number; rounds: T[] }> {
  const all: T[] = []
  for (let r = 0; r < ROUNDS; r++) all.push(await round())
  for (const s of all) console.log(`${name}: ${JSON.stringify(s)}`)
  return { median: median(all.map((s) => s.median)), rounds: all }
}

const view = (page: Page, v: SheetView) =>
  page.evaluate(
    (v) =>
      (
        window as unknown as {
          __playground: { measureView: (v: SheetView) => Promise<ViewStats> }
        }
      ).__playground.measureView(v),
    v
  )

const threeFilters: SheetView = {
  filter: {
    match: "all",
    items: [
      { column: "status", op: "isAnyOf", values: ["active", "paused"] },
      { column: "price", op: "lessThan", values: ["500"] },
      { column: "ordered", op: "inLast", values: ["90", "days"] },
    ],
  },
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("grid", { name: "Items" })).toBeVisible()
})

test("a filter paints in under 50 ms", async ({ page }) => {
  const three = await rounds("three filters", () => view(page, threeFilters))
  const text = await rounds("contains", () =>
    view(page, {
      filter: {
        match: "all",
        items: [{ column: "name", op: "contains", values: ["lamp"] }],
      },
    })
  )
  expect(three.rounds[0]?.shown).toBeGreaterThan(0)
  expect(three.median).toBeLessThan(50)
  expect(text.median).toBeLessThan(50)
})

test("a sort paints in under 100 ms", async ({ page }) => {
  const price = await rounds("sort by price", () =>
    view(page, { sort: [{ column: "price", dir: "asc" }] })
  )
  const name = await rounds("sort by name", () =>
    view(page, { sort: [{ column: "name", dir: "asc" }] })
  )
  expect(price.median).toBeLessThan(100)
  expect(name.median).toBeLessThan(100)
  // The first sort by a column also ranks its values once.
  expect(price.rounds[0]?.first).toBeLessThan(100)
  expect(name.rounds[0]?.first).toBeLessThan(100)
})

test("a one-cell commit with a filter and a sort on paints in under 5 ms", async ({
  page,
}) => {
  const commits = await rounds("commit with a view on", () =>
    page.evaluate(
      async (v) => {
        const pg = (
          window as unknown as {
            __playground: {
              sheet: { setView: (v: SheetView) => void }
              measureCommits: (runs?: number) => Promise<Stats>
            }
          }
        ).__playground
        pg.sheet.setView(v)
        await new Promise((r) => setTimeout(r, 100))
        return pg.measureCommits(30)
      },
      {
        filter: {
          match: "all",
          items: [
            { column: "status", op: "isAnyOf", values: ["active", "paused"] },
          ],
        },
        sort: [{ column: "price", dir: "asc" }],
      } satisfies SheetView
    )
  )
  expect(commits.median).toBeLessThan(5)
})
