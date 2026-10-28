import { expect, test, type Page } from "@playwright/test"

// The filter bar and the view: a filter typed from the keyboard, chips that
// change and go, saved views the app keeps, and keys over the rows shown.

const STATUS = 3

const grid = (page: Page) => page.getByRole("grid", { name: "Items" })
const bar = (page: Page) => page.getByRole("toolbar", { name: "Filters" })
const cell = (page: Page, row: number, column: number) =>
  grid(page).locator(`[data-row-position="${row}"] [data-column-index="${column}"]`)
const count = (page: Page) => bar(page).locator(".count")

/** The texts of a column's first rows. */
async function column(page: Page, index: number, rows = 8) {
  const texts: string[] = []
  for (let r = 0; r < rows; r++) {
    texts.push((await cell(page, r, index).textContent()) ?? "")
  }
  return texts
}

/** Status is any of Paused, typed from the grid with the keyboard alone. */
async function filterPaused(page: Page) {
  await cell(page, 0, 0).click()
  await page.keyboard.press("ControlOrMeta+Shift+F")
  await expect(
    page.getByRole("combobox", { name: "Filter by column" })
  ).toBeFocused()
  await page.keyboard.type("sta")
  await page.keyboard.press("Enter")
  await page.keyboard.press("Enter")
  await page.keyboard.type("pau")
  await page.keyboard.press("Space")
  await page.keyboard.press("Enter")
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?rows=1000")
})

test("a filter is typed from the grid: column, operator, value", async ({
  page,
}) => {
  await filterPaused(page)
  const chip = bar(page).getByRole("button", {
    name: "Status, is any of, Paused",
    exact: true,
  })
  await expect(chip).toBeFocused()
  expect(new Set(await column(page, STATUS))).toEqual(new Set(["Paused"]))
  await expect(count(page)).toHaveText(/^\d{3} of 1,000 rows$/)
  await expect(
    grid(page).getByRole("columnheader", { name: "Status (filtered)" })
  ).toHaveCount(1)
})

test("the column list narrows by the start of a word, and Escape drops the draft", async ({
  page,
}) => {
  await cell(page, 0, 0).click()
  await page.keyboard.press("ControlOrMeta+Shift+F")
  await page.keyboard.type("em")
  const options = page
    .getByRole("listbox", { name: "Columns" })
    .getByRole("option")
  await expect(options).toHaveText(["Contact emailEmail"])
  await page.keyboard.type("zz")
  await expect(page.getByText('No column matches "emzz".')).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(bar(page)).toHaveCount(0)
})

test("a chip's value changes in place, and the grid follows each tick", async ({
  page,
}) => {
  await filterPaused(page)
  const paused = Number((await count(page).textContent())?.split(" ")[0])
  await bar(page)
    .getByRole("button", { name: /^Status, is any of/ })
    .click()
  await page.getByRole("option", { name: /^Draft/ }).click()
  await expect(
    bar(page).getByRole("button", {
      name: "Status, is any of, Draft and Paused",
      exact: true,
    })
  ).toBeVisible()
  const both = Number((await count(page).textContent())?.split(" ")[0])
  expect(both).toBeGreaterThan(paused)
  expect(new Set(await column(page, STATUS))).toEqual(
    new Set(["Draft", "Paused"])
  )
})

test("Backspace removes a chip, undo brings it back, Escape goes back to the grid", async ({
  page,
}) => {
  await filterPaused(page)
  await page.keyboard.press("Backspace")
  await expect(bar(page).locator(".fchip")).toHaveCount(0)
  await expect(
    page.getByRole("status").filter({ hasText: "Removed" })
  ).toHaveText(/Removed Status, is any of, Paused/)
  await page.keyboard.press("ControlOrMeta+Z")
  await expect(bar(page).locator(".fchip")).toHaveCount(1)
  await bar(page)
    .getByRole("button", { name: /^Status/ })
    .focus()
  await page.keyboard.press("Escape")
  await expect(cell(page, 0, 0)).toBeFocused()
})

test("a value that does not parse makes a red chip that is not applied", async ({
  page,
}) => {
  await cell(page, 0, 0).click()
  await page.keyboard.press("ControlOrMeta+Shift+F")
  await page.keyboard.type("price")
  await page.keyboard.press("Enter")
  // "is" is first; pick "less than".
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await page.keyboard.type("lots")
  await expect(page.getByText("1,000 rows match")).toBeVisible()
  await page.keyboard.press("Enter")
  const chip = bar(page).locator(".fchip.bad")
  await expect(chip).toHaveCount(1)
  await expect(chip).toHaveAttribute(
    "title",
    'Not applied: "lots" is not an amount'
  )
  await expect(count(page)).toHaveText("1,000 of 1,000 rows")
})

test("an edit that hides its row moves the active cell down the rows shown", async ({
  page,
}) => {
  await filterPaused(page)
  const second = await cell(page, 1, 0).textContent()
  await cell(page, 0, STATUS).click()
  await page.keyboard.type("active")
  await page.keyboard.press("Enter")
  await expect(cell(page, 0, 0)).toHaveText(second ?? "")
  await expect(cell(page, 0, STATUS)).toBeFocused()
  expect(new Set(await column(page, STATUS))).toEqual(new Set(["Paused"]))
})

test("saved views are the app's: tabs with counts, hidden columns, an edited mark", async ({
  page,
}) => {
  const tabs = page.getByRole("group", { name: "Saved views" })
  await tabs.getByRole("button", { name: /^Contacts/ }).click()
  await expect(grid(page).getByRole("columnheader")).toHaveText([
    "",
    /Name/,
    /Country/,
    /Contact email/,
    /Phone/,
    /Supplier/,
  ])
  await tabs.getByRole("button", { name: /^Paused or archived/ }).click()
  await expect(
    tabs.getByRole("button", { name: /^Paused or archived \d/ })
  ).toBeVisible()
  await expect(tabs.getByRole("img", { name: "edited" })).toHaveCount(0)
  await bar(page)
    .getByRole("button", { name: /^Remove Status/ })
    .click()
  await expect(tabs.getByRole("img", { name: "edited" })).toHaveCount(1)
  await tabs.getByRole("button", { name: "Reset" }).click()
  await expect(bar(page).locator(".fchip")).toHaveCount(1)
})

test("in table mode, F opens the filter; in a sheet it types", async ({
  page,
}) => {
  await page.goto("/?rows=1000&mode=table")
  await cell(page, 0, 0).click()
  await page.keyboard.press("f")
  await expect(
    page.getByRole("combobox", { name: "Filter by column" })
  ).toBeFocused()
  await page.goto("/?rows=1000")
  await cell(page, 0, 0).click()
  await page.keyboard.press("f")
  await expect(grid(page).getByRole("textbox")).toHaveValue("f")
})
