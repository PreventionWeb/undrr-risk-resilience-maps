/**
 * Refuses the run when the dev server on the suite's port belongs to a
 * different checkout.
 *
 * Playwright starts (or reuses) `config.webServer` before global setup, so by
 * the time this runs something is answering on the port — the only open
 * question is whose code it is. See `dev-server.js` for why reuse is worth
 * keeping and what it costs if unchecked.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEV_IDENTITY_PATH, PORT, REUSE_EXISTING_SERVER } from "./dev-server.js";

/**
 * This checkout, from this file's own location. Playwright's `config.rootDir`
 * is the common base of the test directories, not the project root.
 */
const CHECKOUT = fileURLToPath(new URL("../..", import.meta.url));

/** Symlinked temp dirs and `/var` vs `/private/var` make raw paths unequal. */
function canonical(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

function refuse(problem, expected) {
  throw new Error(
    [
      `Port ${PORT} is serving a different checkout — refusing to run the E2E suite.`,
      "",
      `  ${problem}`,
      `  expected: ${expected} (this checkout)`,
      "",
      "The suite reuses a dev server that is already on the port, so this run",
      "would have tested that other server's code and reported failures that have",
      "nothing to do with the branch under test.",
      "",
      "Pick one:",
      `  - stop whatever is listening on ${PORT}, then re-run 'yarn test:e2e'`,
      `  - give this run a port of its own:  E2E_PORT=${PORT + 1} yarn test:e2e`,
      "  - or both, to never reuse a server (it then needs the port free):",
      `      E2E_REUSE_SERVER=0 E2E_PORT=${PORT + 1} yarn test:e2e`,
    ].join("\n"),
  );
}

export default async function assertDevServerIsThisCheckout() {
  // Nothing to verify when Playwright is guaranteed to have started the server.
  if (!REUSE_EXISTING_SERVER) return;

  const expected = canonical(CHECKOUT);
  const url = `http://localhost:${PORT}${DEV_IDENTITY_PATH}`;

  let identity;
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    identity = await response.json();
  } catch (error) {
    refuse(
      `${url} did not answer (${error.message}). Whatever holds the port is not ` +
        "this project's Vite dev server, or it was started before this check existed.",
      expected,
    );
  }

  const actual = canonical(String(identity?.root ?? ""));
  if (actual !== expected) {
    refuse(`actual:   ${actual} (pid ${identity?.pid ?? "?"}, commit ${identity?.commit ?? "?"})`, expected);
  }
}
