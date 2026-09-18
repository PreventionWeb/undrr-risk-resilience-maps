import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { DEV_IDENTITY_PATH } from "./tests/e2e/dev-server.js";

function gitValue(format, fallback) {
  try {
    return execFileSync("git", ["log", "-1", `--format=${format}`], {
      encoding: "utf8",
    }).trim();
  } catch {
    return fallback;
  }
}

const lastUpdated = gitValue("%cI", new Date().toISOString());
const commitHash = gitValue("%h", "local");

// GitHub Pages deploys to /<repo-name>/ subpath.
// Local dev uses "/" via the server config override.
const base = process.env.GITHUB_ACTIONS ? "/undrr-risk-resilience-maps/" : "/";

/**
 * Says which checkout this dev server is serving.
 *
 * `playwright.config.js` reuses an already-running server on its port, which is
 * convenient until the server belongs to another worktree — then the suite
 * silently tests someone else's code. `tests/e2e/global-setup.js` asks this
 * endpoint who it is and refuses the run on a mismatch. Dev only (`apply:
 * "serve"`), so it is never part of a build.
 */
function devServerIdentity() {
  return {
    name: "dev-server-identity",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(DEV_IDENTITY_PATH, (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({ root: server.config.root, pid: process.pid, commit: commitHash }));
      });
    },
  };
}

export default defineConfig({
  plugins: [devServerIdentity()],
  root: ".",
  base,
  define: {
    __APP_LAST_UPDATED__: JSON.stringify(lastUpdated),
    __APP_COMMIT_HASH__: JSON.stringify(commitHash),
  },
  server: { port: 3001 },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
  test: {
    environment: "jsdom",
    // Vitest's 5 s default is a wall-clock budget, and these DOM suites chain
    // dozens of event-loop turns per test: on a saturated machine a turn costs
    // tens of milliseconds instead of a fraction of one, and correct tests time
    // out. A timeout is not an assertion, so give it room rather than let the
    // machine's load decide the result. See
    // unisdr/undrr-risk-resilience-maps#15.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Unit tests live beside the module they cover, so the suite is exactly
    // `src/` plus `scripts/`. Anchoring `include` at the project root keeps
    // checkouts nested inside this one (git worktrees under
    // `.claude/worktrees/`, each with its own full `src/`) out of the run:
    // `src/**` does not match `.claude/worktrees/x/src/**`. A new top-level
    // directory with unit tests has to be added here.
    include: ["{src,scripts}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,jsx,tsx}"],
    // Setting `exclude` replaces vitest's defaults, so the ones that matter are
    // repeated here. `.claude/**` is the belt to `include`'s braces; the rest
    // are scratch directories an agent or a local run may leave behind.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**",
      "**/.cache/**",
      ".claude/**",
      "outputs/**",
      "playwright-report/**",
      "test-results/**",
      // The Playwright specs under tests/e2e also match vitest's default
      // `*.spec.js` pattern; they are a browser suite (`yarn test:e2e`).
      "tests/e2e/**",
    ],
  },
});
