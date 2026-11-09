/** Opt-in live SDK legend audit. Routine unit/e2e tests remain offline.
 * yarn test:mapx-raster-contract [--view MX-…] [--record /path/to/responses.json]
 * Uses the real hosted SDK in an isolated browser and the application's adapters.
 */
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
import { TABS, PRIMARY_PROJECT } from "../src/config/layers.js";

const ids = new Set(
  TABS.flatMap((tab) => tab.layers.flatMap((layer) => layer.sources ?? [layer]))
    .map((source) => source.id)
    .filter(Boolean),
);
const selected = [];
let recordPath = null;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--view" && process.argv[i + 1]?.startsWith("MX-")) selected.push(process.argv[++i]);
  else if (arg === "--record" && process.argv[i + 1]) recordPath = process.argv[++i];
  else throw new Error(`Unknown/incomplete argument: ${arg}`);
}
const toCheck = selected.length ? [...new Set(selected)] : [...ids];
const server = await createServer({
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "mapx-legend-audit-page",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/__legend-audit.html") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            '<!doctype html><html lang="en"><title>MapX legend contract audit</title><div id="map" style="width:1000px;height:700px"></div></html>',
          );
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__legend-audit.html`);
  await page.addScriptTag({ url: "https://app.mapx.org/sdk/mxsdk.umd.js" });
  await page.evaluate(async (project) => {
    const { initSDK } = await import("/src/sdk/client.js");
    window.auditSDK = initSDK(document.getElementById("map"), project);
    let timer;
    try {
      await Promise.race([
        new Promise((resolve) => window.auditSDK.on("ready", resolve)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("MapX ready timeout")), 30000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    // Hide native panels without making the probe depend on this optional setting.
    window.auditSDK.ask("set_immersive_mode", { enable: true }).catch(() => {});
    // The official legend API computes unopened catalogue views too. Render
    // only missing cross-project views, keeping this metadata audit lightweight.
    try {
      window.auditKnownViews = new Set(
        await Promise.race([
          window.auditSDK.ask("get_views_id"),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("catalogue timeout")), 10000);
          }),
        ]),
      );
    } finally {
      clearTimeout(timer);
    }
  }, PRIMARY_PROJECT);
  const results = [];
  const recorded = {};
  for (const idView of toCheck) {
    const result = await page.evaluate(
      async ({ idView, record }) => {
        const sdk = window.auditSDK;
        let timer;
        let added = false;
        try {
          if (!window.auditKnownViews.has(idView)) {
            added = true;
            await Promise.race([
              sdk.ask("view_add", { idView, zoomToView: false }),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("view_add timeout")), 20000);
              }),
            ]);
            clearTimeout(timer);
            window.auditKnownViews.add(idView);
          }
          const { resolveMapXLegend } = await import("/src/sdk/legends.js");
          const resolution = await resolveMapXLegend(idView);
          let raw;
          if (record) {
            raw = await Promise.race([
              sdk.ask("get_view_legend_json", { idView }),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("record timeout")), 10000);
              }),
            ]);
          }
          return { idView, ...resolution, raw };
        } catch (error) {
          return { idView, legend: null, reason: error.message };
        } finally {
          clearTimeout(timer);
          // Cleanup is best-effort and cannot keep the audit waiting indefinitely.
          if (added) sdk.ask("view_remove", { idView }).catch(() => {});
        }
      },
      { idView, record: !!recordPath },
    );
    if (result.raw) recorded[idView] = result.raw;
    results.push({
      view: idView,
      supported: !!result.legend,
      title: result.legend?.title ?? "",
      reason: result.reason,
    });
    console.log(`${result.legend ? "PASS" : "FAIL"} ${idView}: ${result.reason ?? result.legend.title}`);
  }
  if (recordPath) await writeFile(recordPath, JSON.stringify(recorded, null, 2) + "\n");
  const failures = results.filter((result) => !result.supported);
  console.log(
    `${results.length - failures.length}/${results.length} configured legends passed (MapX ${await page.evaluate(() => window.auditSDK.version)}).`,
  );
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
