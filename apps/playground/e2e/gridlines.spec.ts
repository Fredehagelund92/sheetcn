import { expect, test, type Locator, type Page } from "@playwright/test"

// Gridlines in the playground: the lines between cells are clearly visible
// in light and dark, and each gridlines value shows only its own lines
// without moving a column.

const NINE = "?rows=5000&columns=9"
const VALUES = ["None", "Rows", "Columns", "Both"] as const

const grid = (page: Page) => page.getByRole("grid", { name: "Items" })
const cell = (page: Page, row: number, column: number) =>
  page.locator(`[data-row-position="${row}"] .cell[data-column-index="${column}"]`)

/** The lines a cell draws: true where its border has any colour. */
async function lines(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el)
    const shows = (side: "right" | "bottom") =>
      parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
      !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(
        style.getPropertyValue(`border-${side}-color`)
      )
    return {
      right: shows("right"),
      bottom: shows("bottom"),
      rightWidth: style.borderRightWidth,
    }
  })
}

/**
 * The contrast of a cell's right line against its background, as WCAG
 * computes it. Each colour is drawn on a canvas to read it as sRGB, whatever
 * syntax the stylesheet used.
 */
async function lineContrast(locator: Locator) {
  return locator.evaluate((el) => {
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("No canvas")
    const luminance = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = "#010203"
      ctx.fillStyle = color
      if (ctx.fillStyle === "#010203") throw new Error(`Unread: ${color}`)
      ctx.fillRect(0, 0, 1, 1)
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
      const linear = (c: number) => {
        const s = c / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }
    const style = getComputedStyle(el)
    const line = luminance(style.borderRightColor)
    const background = luminance(style.backgroundColor)
    const [hi, lo] = line > background ? [line, background] : [background, line]
    return (hi + 0.05) / (lo + 0.05)
  })
}

for (const scheme of ["light", "dark"] as const) {
  test(`the lines stand out from the cells in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto(`/${NINE}`)
    // A plain cell, and one inside a selected range.
    await cell(page, 2, 2).click()
    await cell(page, 4, 4).click({ modifiers: ["Shift"] })
    expect(await lineContrast(cell(page, 5, 2))).toBeGreaterThanOrEqual(1.5)
    expect(await lineContrast(cell(page, 3, 3))).toBeGreaterThanOrEqual(1.5)
    // The header's lines use the same colour.
    const head = page.locator('.head-cell[data-column-index="7"]')
    expect(await lineContrast(head)).toBeGreaterThanOrEqual(1.5)
  })
}

test("a sheet draws every line, and ?mode=table only the rows", async ({
  page,
}) => {
  await page.goto(`/${NINE}`)
  await expect(grid(page)).toHaveAttribute("data-gridlines", "both")
  await page.goto(`/${NINE}&mode=table`)
  await expect(grid(page)).toHaveAttribute("data-gridlines", "rows")
  await expect(
    page.getByRole("button", { name: "Rows", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
  expect(await lines(cell(page, 0, 2))).toMatchObject({
    right: false,
    bottom: true,
  })
})

test("each gridlines value shows its lines and keeps the edges", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}`)
  const expected = {
    None: { right: false, bottom: false },
    Rows: { right: false, bottom: true },
    Columns: { right: true, bottom: false },
    Both: { right: true, bottom: true },
  }
  for (const value of VALUES) {
    await page.getByRole("button", { name: value, exact: true }).click()
    await expect(grid(page)).toHaveAttribute(
      "data-gridlines",
      value.toLowerCase()
    )
    expect(await lines(cell(page, 0, 2))).toMatchObject(expected[value])
    const head = await lines(page.locator('.head-cell[data-column-index="2"]'))
    expect(head).toMatchObject({ right: expected[value].right, bottom: true })
    // The pinned Name column keeps its thicker edge, and the row numbers
    // theirs, whatever the value.
    expect(await lines(cell(page, 0, 0))).toMatchObject({
      right: true,
      rightWidth: "2px",
    })
    const gutter = page.locator('.gutter[data-row-index="0"]')
    expect((await lines(gutter)).right).toBe(true)
  }
})

test("gridlines move no column, in fill, while selecting and editing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/${NINE}&sizing=fill`)
  await cell(page, 1, 1).click()
  await cell(page, 3, 3).click({ modifiers: ["Shift"] })
  const geometry = () =>
    grid(page).evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      cells: [...el.querySelectorAll('[data-row-position="2"] .cell')].map((c) => {
        const box = c.getBoundingClientRect()
        return [box.left, box.width]
      }),
    }))
  const both = await geometry()
  for (const value of VALUES) {
    await page.getByRole("button", { name: value, exact: true }).click()
    expect(await geometry()).toEqual(both)
    // The selection still tints the whole cell, gaps included.
    await expect(cell(page, 2, 2)).toHaveAttribute("aria-selected", "true")
  }

  // The editor sits inside the cell's lines, so they still show.
  await page.getByRole("button", { name: "Both", exact: true }).click()
  await cell(page, 5, 2).dblclick()
  const editor = page.getByRole("textbox", { name: /^Edit / })
  await expect(editor).toBeFocused()
  const [box, editorBox] = await Promise.all([
    cell(page, 5, 2).boundingBox(),
    editor.boundingBox(),
  ])
  expect(editorBox?.width).toBe((box?.width ?? 0) - 1)
  expect(editorBox?.height).toBe((box?.height ?? 0) - 1)
  expect(await lines(cell(page, 5, 2))).toMatchObject({
    right: true,
    bottom: true,
  })
})
