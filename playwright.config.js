import { defineConfig, devices } from "@playwright/test";

const PORT = 3040;
const isCI = Boolean(process.env.CI);

/**
 * End-to-end smoke suite. Chromium only: these specs check the app's own state
 * machine (URL, history, switches, legends) through a stubbed MapX, and none of
 * them depends on engine-specific behaviour, so a second browser would double
 * the CI time for nothing. See ARCHITECTURE.md's Testing section.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.js",
  // Every spec drives one page; the suite has no shared server state.
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // A failure that only shows up in CI is otherwise guesswork.
    screenshot: isCI ? "only-on-failure" : "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A port of its own, so a dev server on 3001 and the suite can coexist.
    command: `yarn vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
