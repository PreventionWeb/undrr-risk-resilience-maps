/**
 * The E2E suite's dev-server contract, shared by `playwright.config.js`,
 * `vite.config.js` and `tests/e2e/global-setup.js`.
 *
 * Playwright reuses a server that is already listening on `E2E_PORT` locally,
 * because starting one per run costs several seconds of every iteration. The
 * cost of that convenience is a silent wrong answer: a dev server from another
 * worktree answers just as happily, and the suite then reports failures about
 * code that is not on the branch under test. So the reuse is allowed but
 * verified — the dev server says which checkout it is serving
 * (`DEV_IDENTITY_PATH`, a dev-only middleware in `vite.config.js`), and the
 * global setup refuses the run when that is not this checkout.
 */

/** Dev-only endpoint that names the checkout the server is rooted at. */
export const DEV_IDENTITY_PATH = "/__dev-server-identity";

/** A port of its own, so a dev server on 3001 and the suite can coexist. */
export const PORT = Number(process.env.E2E_PORT ?? 3040);

/** `E2E_REUSE_SERVER=0` forces Playwright to start a server of its own. */
export const REUSE_EXISTING_SERVER = !process.env.CI && process.env.E2E_REUSE_SERVER !== "0";
