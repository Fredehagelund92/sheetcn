import { expect, test, type Page } from "@playwright/test"

// Column types in the playground: each cell is aligned and edited as its
// type says, through the type's `align` and `edit`, not its id.

const PRICE = 4
const ORDERED = 7
const IN_STOCK = 9
const CATEGORY = 2

const grid = (page: Page) => page.getByRole("grid", { name: "Items" })
const cell = (page: Page, row: number, column: number) =>
  grid(page).locator(`[data-row-index="${row}"][data-column-index="${column}"]`)

/** Where a cell's text sits: gaps between the text and the cell's sides. */
async function gaps(page: Page, row: number, column: number) {
  return cell(page, row, column).evaluate((el) => {
    const box = el.getBoundingClientRect()
    const text = el.querySelector(".text")?.getBoundingClientRect()
    if (!text) throw new Error("The cell has no text")
    return { start: text.left - box.left, end: box.right - text.right }
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?rows=1000")
})

test("numbers sit at the end of their cells, dates and text at the start", async ({
  page,
}) => {
  const price = await gaps(page, 0, PRICE)
  expect(price.end).toBeLessThan(price.start)
  const ordered = await gaps(page, 0, ORDERED)
  expect(ordered.start).toBeLessThan(ordered.end)
  const head = grid(page).locator(`.head-cell[data-column-index="${PRICE}"]`)
  await expect(head).toHaveClass(/numeric/)
})

test("a boolean cell toggles with Space and Enter and ignores typing", async ({
  page,
}) => {
  const inStock = cell(page, 0, IN_STOCK)
  await inStock.click()
  const before = await inStock.textContent()
  const after = before === "Yes" ? "No" : "Yes"
  await page.keyboard.press("Space")
  await expect(inStock).toHaveText(after)
  await page.keyboard.press("a")
  await expect(inStock).toHaveText(after)
  await expect(grid(page).getByRole("textbox")).toHaveCount(0)
  await page.keyboard.press("Enter")
  await expect(inStock).toHaveText(before ?? "")
})

test("a select cell takes an option's label", async ({ page }) => {
  const category = cell(page, 0, CATEGORY)
  await category.click()
  await page.keyboard.type("soft")
  await page.keyboard.press("Enter")
  await expect(grid(page).getByRole("alert")).toHaveText(
    '"soft" is not one of the options'
  )
  await page.keyboard.press("Escape")
  await page.keyboard.type("software")
  await page.keyboard.press("Enter")
  await expect(category).toHaveText("Software")
})

const PRICE_ROW = 0
const COUNTRY = 10
const PHONE = 12
const NOTES = 17

/** Opens the active cell's editor by typing, then commits with Enter. */
async function enter(page: Page, text: string) {
  await page.keyboard.type(text)
  await page.keyboard.press("Enter")
}

test("money keeps to its currency and shows it", async ({ page }) => {
  const price = cell(page, PRICE_ROW, PRICE)
  await price.click()
  await enter(page, "EUR 5")
  await expect(grid(page).getByRole("alert")).toHaveText(
    '"EUR 5" is not in USD'
  )
  await page.keyboard.press("Escape")
  await enter(page, "1234.5")
  await expect(price).toHaveText("$1,234.50")
})

test("country and phone read what people type", async ({ page }) => {
  const country = cell(page, 0, COUNTRY)
  await country.click()
  await enter(page, "nor")
  await expect(country).toHaveText("Norway")
  const phone = cell(page, 0, PHONE)
  await phone.click()
  await enter(page, "020 7946 0123")
  await expect(phone).toHaveText("+44 20 7946 0123")
})

test("long text takes several lines and shows the first", async ({ page }) => {
  // Notes is off screen: go to the row's end (ID) and two cells back.
  await cell(page, 0, 0).click()
  await page.keyboard.press("End")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  const notes = cell(page, 0, NOTES)
  await expect(notes).toHaveAttribute("tabindex", "0")
  await page.keyboard.press("Enter")
  const editor = grid(page).getByRole("textbox", { name: "Edit Notes" })
  await editor.fill("First line")
  await page.keyboard.press("Alt+Enter")
  await page.keyboard.type("Second line")
  await expect(editor).toHaveValue("First line\nSecond line")
  await page.keyboard.press("Enter")
  await expect(notes).toHaveText("First line ...")
})
