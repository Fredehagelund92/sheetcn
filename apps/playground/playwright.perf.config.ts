import { defineConfig, devices } from "@playwright/test"

// Timing gates in the browser, on the playground's production build. They
// run in the performance job and nightly (`pnpm test:perf`), not with the
// journeys: shared runners time paint too unevenly for every pull request.
const PORT = 4320

export default defineConfig({
  testDir: "e2e-perf",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
})
