import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

// A reproducible build sets SOURCE_DATE_EPOCH; without it or git, the build
// time is used, and then every build gets a new `?v=` build id (harmless: it
// only refreshes caches).
const sourceDate = Number(process.env.SOURCE_DATE_EPOCH);
const lastUpdated = gitValue(
  "%cI",
  (Number.isFinite(sourceDate) && sourceDate > 0 ? new Date(sourceDate * 1000) : new Date()).toISOString(),
);
const commitHash = gitValue("%h", "local");

/**
 * GitHub Pages deploys to /<repo-name>/, so a build made on GitHub Actions has
 * to carry that base. A *dev server* must not: it is only ever a local server,
 * on Actions as much as here, and the E2E suite addresses it at "/".
 *
 * Keying this on `GITHUB_ACTIONS` alone moved the dev server's whole app under
 * `/undrr-risk-resilience-maps/` in CI. `page.goto("/")` survived that (Vite
 * redirects the root to the base), so every spec that opens the app kept
 * passing and the breakage was invisible — but `page.goto("/embed.html")` got
 * Vite's "did you mean /undrr-risk-resilience-maps/embed.html?" page instead of
 * the embed, and every embed spec timed out waiting for a map that no page was
 * building. `tests/e2e/global-setup.js` now refuses a dev server whose base is
 * not "/", so this cannot come back as a 20-minute timeout again.
 *
 * A third target overrides this from the command line: undrr/drupal-microsites
 * runs `vite build --base=./` to serve the app at
 * www.undrr.org/m/risk-and-resilience-maps/ (README § Deployment). Keep every
 * asset and runtime URL relative so that build keeps working.
 */
const base = (command) =>
  command === "build" && process.env.GITHUB_ACTIONS ? "/undrr-risk-resilience-maps/" : "/";

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
        res.end(
          JSON.stringify({
            root: server.config.root,
            base: server.config.base,
            pid: process.pid,
            commit: commitHash,
          }),
        );
      });
    },
  };
}

/**
 * Append one build-wide cache buster (`?v=<build id>`) to every reference
 * between the build's own files: HTML → scripts and styles, and chunk →
 * chunk imports, lazy ones included.
 *
 * File names are fixed (see `build.rollupOptions.output`), so an `embed.html`
 * cached from any release still finds files that exist. The query makes each
 * build's files a separate cache entry: a new `embed.js?v=B` only ever imports
 * `shared.js?v=B`, never a copy of `shared.js` that a browser or Cloudflare
 * kept from build A. The chunks' internal export names are assigned per
 * build, so a pair from two builds may fail to link or, worse, link to the
 * wrong functions (PreventionWeb/undrr-risk-resilience-maps#91).
 *
 * The build id hashes the content of every emitted file before the queries are
 * added, so it changes whenever any output does. The output embeds the commit
 * date and hash (`define` below); see `lastUpdated` for builds without git.
 *
 * Scope: only JS and CSS outputs have fixed names and get the query. Other
 * emitted assets (images, fonts) keep a content hash in their name
 * (`assetFileNames`), because CSS `url()` and `new URL()` references to them
 * are not rewritten here. Sourcemaps are refused: inserting the query shifts
 * columns, and the maps would point at the wrong code. The rewrite matches
 * quoted paths, so a string literal that is exactly such a path (`"./shared.js"`)
 * in our own source would be rewritten too; nothing in src/ has one.
 */
export function buildQuery() {
  return {
    name: "build-query",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(options, bundle) {
        if (options.sourcemap) {
          throw new Error("build-query: sourcemaps would be wrong after the ?v= rewrite; see vite.config.js");
        }
        const files = Object.values(bundle);
        const hash = createHash("sha256");
        // A plain code-unit sort and length-prefixed fields: the id must not
        // depend on the locale, or on where one file's name ends and its content starts.
        const ordered = [...files].sort((a, b) =>
          a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
        );
        for (const file of ordered) {
          const content = file.type === "chunk" ? file.code : file.source;
          hash.update(`${file.fileName.length}:${file.fileName}${content.length}:`).update(content);
        }
        const query = `?v=${hash.digest("hex").slice(0, 10)}`;
        const names = files
          .map((file) => file.fileName.split("/").pop())
          .filter((name) => /\.(?:js|css)$/.test(name))
          .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        if (names.length === 0) return;
        // A quoted reference to one of our files, in the forms Vite writes: a
        // chunk import beside it (`"./shared.js"`) or a path into `assets/`
        // (`"./assets/embed.css"`, `"/base/assets/main.js"`, `"assets/x.js"`).
        // Any other string that happens to end in one of the names, such as
        // `"src/embed/main.js"`, is not a reference and is left alone.
        const reference = new RegExp(
          `(["'\`])((?:\\./|(?:[^"'\`\\s]*/)?assets/)(?:${names.join("|")}))\\1`,
          "g",
        );
        const addQuery = (text) =>
          text.replace(reference, (_m, quote, path) => `${quote}${path}${query}${quote}`);
        for (const file of files) {
          if (file.type === "chunk") file.code = addQuery(file.code);
          else if (/\.(?:html|css)$/.test(file.fileName) && typeof file.source === "string") {
            file.source = addQuery(file.source);
          }
        }
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [devServerIdentity(), buildQuery()],
  root: ".",
  base: base(command),
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
        // The iframe embed (docs/embedding.md phase 1): a second HTML entry over
        // the same modules, so it shares this bundle and its cache headers and
        // needs no pipeline of its own.
        embed: "embed.html",
      },
      // Fixed file names, no content hashes (PreventionWeb/undrr-risk-resilience-maps#89).
      // A cached copy of `embed.html` from an earlier release must still find
      // its scripts: with hashed names, each deploy deleted the files an older
      // copy named, and a GAR embed stayed blank on 404s. `buildQuery()` above
      // adds `?v=<build id>` to every reference, so caches still keep each
      // build's files apart (docs/deployment.md "Caching").
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        // CSS is referenced only from HTML and gets the query; anything else
        // (images, fonts) is referenced from CSS `url()` or `new URL()`, which the
        // query rewrite doesn't cover, so it keeps a content hash. Those are
        // leaf files: a stale hashed one breaks nothing that imports it.
        assetFileNames: (asset) =>
          (asset.names ?? [asset.name ?? ""]).some((name) => name.endsWith(".css"))
            ? "assets/[name][extname]"
            : "assets/[name]-[hash][extname]",
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
}));
