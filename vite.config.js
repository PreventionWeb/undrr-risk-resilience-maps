import { defineConfig } from "vite";

// GitHub Pages deploys to /<repo-name>/ subpath.
// Local dev uses "/" via the server config override.
const base = process.env.GITHUB_ACTIONS
  ? "/undrr-risk-resilience-maps/"
  : "/";

export default defineConfig({
  root: ".",
  base,
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
