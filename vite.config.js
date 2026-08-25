import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";

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

export default defineConfig({
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
  test: { environment: "jsdom" },
});
