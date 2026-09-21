/**
 * Refuses the run when the dev server on the suite's port is not one this suite
 * can trust: it belongs to a different checkout, or it is not serving the app at
 * "/".
 *
 * Playwright starts (or reuses) `config.webServer` before global setup, so by
 * the time this runs something is answering on the port — the only open
 * questions are whose code it is and where it puts the app. See `dev-server.js`
 * for why reuse is worth keeping and what it costs if unchecked, and
 * `vite.config.js` for the 20-minute CI timeout a non-"/" base once caused.
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

/**
 * A base other than "/" is the failure this suite cannot see for itself:
 * `page.goto("/")` still reaches the app, because Vite redirects the root to the
 * base, so the specs that open the viewer keep passing — while every
 * `page.goto("/embed.html")` gets Vite's "did you mean …?" page and times out.
 * Twenty minutes of retries for a one-line config mistake. Fail in a second
 * instead, with the cause named.
 */
function refuseBase(base) {
  throw new Error(
    [
      `The dev server on port ${PORT} serves the app under "${base}", not "/" — refusing to run the E2E suite.`,
      "",
      'Every spec addresses the app relative to `baseURL` ("/", "/embed.html"),',
      "so a non-root base turns the whole suite into timeouts: Vite redirects",
      '"/" to the base and answers any other path with its "did you mean …?"',
      "page, which builds no map and never sets `window.__mapxStub`.",
      "",
      '`vite.config.js` applies the GitHub Pages base to `command === "build"`',
      "only. If that changed, change it back rather than teach the specs a base.",
    ].join("\n"),
  );
}

export default async function assertDevServerIsThisCheckout() {
  const expected = canonical(CHECKOUT);
  const url = `http://localhost:${PORT}${DEV_IDENTITY_PATH}`;

  let identity;
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    identity = await response.json();
  } catch (error) {
    // Playwright started the server itself, so its identity is not in question;
    // only a reused server has to prove who it is.
    if (!REUSE_EXISTING_SERVER) throw error;
    refuse(
      `${url} did not answer (${error.message}). Whatever holds the port is not ` +
        "this project's Vite dev server, or it was started before this check existed.",
      expected,
    );
  }

  if (identity?.base !== "/") refuseBase(String(identity?.base));

  // Nothing more to verify when Playwright is guaranteed to have started the server.
  if (!REUSE_EXISTING_SERVER) return;

  const actual = canonical(String(identity?.root ?? ""));
  if (actual !== expected) {
    refuse(`actual:   ${actual} (pid ${identity?.pid ?? "?"}, commit ${identity?.commit ?? "?"})`, expected);
  }
}
