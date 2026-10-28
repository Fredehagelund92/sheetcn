import { expect, test, type Page } from "@playwright/test"

// Column sizing in the playground: "fill" ends the columns at the grid's
// right edge when there is room and scrolls when there is not, and fitting
// sizes a column to its content.

const GUTTER = 64
// Nine columns, 1,062 px wide, so they fit a wide window with room to spare.
const NINE = "?rows=5000&columns=9"
const NINE_WIDTHS = [200, 110, 130, 110, 100, 72, 100, 120, 120]

const grid = (page: Page) => page.getByRole("grid", { name: "Items" })

/** Where the grid's columns end, against its visible right edge. */
async function layout(page: Page) {
  return grid(page).evaluate((el) => {
    const heads = [...el.querySelectorAll(".head-cell")]
    const last = heads.at(-1)?.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    return {
      lastRight: last?.right ?? 0,
      gridRight: box.left + el.clientWidth,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      widths: heads.map((h) => h.getBoundingClientRect().width),
    }
  })
}

/** Visible cells (and headers) whose text is cut off. */
async function clipped(page: Page, columnIndex = -1) {
  return grid(page).evaluate((el, column) => {
    const scope = column < 0 ? "" : `[data-column-index="${column}"]`
    const out: string[] = []
    for (const cell of el.querySelectorAll(
      `.cell${scope}, .head-cell${scope}`
    )) {
      for (const text of cell.querySelectorAll(".text, .chip, .title")) {
        if (text.scrollWidth > text.clientWidth) {
          out.push(text.textContent)
        }
      }
    }
    return out
  }, columnIndex)
}

test("fill at 1440 px: the last column ends at the right edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}&sizing=fill`)
  const at = await layout(page)
  expect(at.lastRight).toBeCloseTo(at.gridRight, 0)
  expect(at.scrollWidth).toBe(at.clientWidth)
  // Every column grew but the pinned Name column, which keeps 200 px.
  expect(at.widths[0]).toBe(200)
  at.widths.slice(1).forEach((w, i) => {
    expect(w).toBeGreaterThan(NINE_WIDTHS[i + 1] ?? Infinity)
  })
})

test("fill at 900 px: the grid scrolls and the pinned column stays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto(`/${NINE}&sizing=fill`)
  const at = await layout(page)
  // Too narrow: every column keeps its width.
  expect(at.widths).toEqual(NINE_WIDTHS)
  expect(at.scrollWidth).toBe(GUTTER + 1062)
  await grid(page).evaluate((el) => {
    el.scrollLeft = el.scrollWidth
  })
  await expect
    .poll(async () => {
      const end = await layout(page)
      return Math.round(end.gridRight - end.lastRight)
    })
    .toBe(0)
  const name = page.getByRole("columnheader", { name: /Name/ })
  expect((await name.boundingBox())?.x).toBe(GUTTER)
})

test("fill follows the window as it is resized", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}&sizing=fill`)
  for (const width of [1440, 1300, 1180, 1600]) {
    await page.setViewportSize({ width, height: 800 })
    await expect
      .poll(async () => {
        const at = await layout(page)
        return Math.round(at.gridRight - at.lastRight)
      })
      .toBe(0)
  }
  await page.setViewportSize({ width: 900, height: 800 })
  await expect.poll(async () => (await layout(page)).scrollWidth).toBe(1126)
})

test("fixed widths leave a strip, and Fill width closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}`)
  const fixed = await layout(page)
  expect(fixed.gridRight - fixed.lastRight).toBeGreaterThan(300)

  await page.getByRole("button", { name: "Fill width" }).click()
  await expect(
    page.getByRole("button", { name: "Fill width" })
  ).toHaveAttribute("aria-pressed", "true")
  const filled = await layout(page)
  expect(filled.lastRight).toBeCloseTo(filled.gridRight, 0)
})

test("the grid width slider narrows the grid, and fill follows it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}&sizing=fill`)
  const slider = page.getByRole("slider", { name: "Grid width" })
  await slider.focus()
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft")
  await expect(slider).toHaveValue("90")
  // The grid re-measures after the resize, so wait for the columns to settle.
  await expect
    .poll(async () => {
      const at = await layout(page)
      return (
        at.clientWidth < 1440 && Math.abs(at.lastRight - at.gridRight) < 0.5
      )
    })
    .toBe(true)
})

test("double-clicking a column's right edge fits it to its content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}`)
  const category = page.locator('.head-cell[data-column-index="2"]')
  const before = (await category.boundingBox())?.width ?? 0
  await category.locator(".resize").dblclick()
  await expect
    .poll(async () => (await category.boundingBox())?.width)
    .toBeLessThan(before)
  expect(await clipped(page, 2)).toEqual([])

  // Narrow the Name column until it clips, then fit it again.
  const name = page.locator('.head-cell[data-column-index="0"]')
  const handle = name.locator(".resize")
  const box = await handle.boundingBox()
  if (!box) throw new Error("The Name column has no resize handle")
  await page.mouse.move(box.x + 3, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x - 100, box.y + 10, { steps: 4 })
  await page.mouse.up()
  expect((await clipped(page, 0)).length).toBeGreaterThan(0)
  await handle.dblclick()
  await expect.poll(() => clipped(page, 0)).toEqual([])
})

test("Fit all columns, from the keyboard, fits every column and still fills", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}&sizing=fill`)
  const fitAll = page.getByRole("button", { name: "Fit all columns" })
  await fitAll.focus()
  await page.keyboard.press("Enter")
  const at = await layout(page)
  expect(at.lastRight).toBeCloseTo(at.gridRight, 0)
  expect(await clipped(page)).toEqual([])
})

test("Fit, from the keyboard, fits the active cell's column", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}`)
  const cell = page.locator('[data-row-position="0"] .cell[data-column-index="3"]')
  await cell.click()
  const fit = page.getByRole("button", { name: "Fit Status" })
  await fit.focus()
  await page.keyboard.press("Enter")
  const status = page.locator('.head-cell[data-column-index="3"]')
  await expect
    .poll(async () => (await status.boundingBox())?.width)
    .toBeLessThan(110)
  expect(await clipped(page, 3)).toEqual([])
})
