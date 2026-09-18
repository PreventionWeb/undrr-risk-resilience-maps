import { defineConfig, devices } from "@playwright/test";
import { PORT, REUSE_EXISTING_SERVER } from "./tests/e2e/dev-server.js";

const isCI = Boolean(process.env.CI);

/**
 * End-to-end smoke suite. Chromium only: these specs check the app's own state
 * machine (URL, history, switches, legends) through a stubbed MapX, and none of
 * them depends on engine-specific behaviour, so a second browser would double
 * the CI time for nothing. See ARCHITECTURE.md's Testing section.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Runs after `webServer`, and fails the run if the server on PORT belongs to
  // another checkout. See tests/e2e/dev-server.js.
  globalSetup: "./tests/e2e/global-setup.js",
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
    // `E2E_PORT` moves it; `E2E_REUSE_SERVER=0` forces a fresh server.
    command: `yarn vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: REUSE_EXISTING_SERVER,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
