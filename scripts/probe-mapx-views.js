/**
 * Probe MapX projects via Playwright + SDK to dump full view catalogues.
 *
 * The MapX REST API requires authentication (idUser, idProject, token),
 * so the only unauthenticated way to list views is through the SDK's
 * iframe postMessage bridge. This script loads a minimal HTML page with
 * the SDK, connects to each project, calls get_views, and writes the
 * results to JSON and CSV files.
 *
 * Usage:
 *   npx playwright test scripts/probe-mapx-views.js
 *
 * Or run directly (requires @playwright/test):
 *   node -e "require('@playwright/test')" && npx playwright test scripts/probe-mapx-views.js
 *
 * Prerequisites:
 *   npm install @playwright/test
 *   npx playwright install chromium
 *
 * Output:
 *   research/mapx-views-{project-name}.json  -- full view data per project
 *   research/mapx-views-all.csv              -- combined flat CSV
 */

import { test } from "@playwright/test";
import { writeFileSync } from "fs";
import { join } from "path";

const PROJECTS = [
  { id: "MX-2LD-FBB-58N-ROK-8RH", name: "eco-drr" },
  { id: "MX-YBJ-YYF-08R-UUR-QW6", name: "home" },
];

const RESEARCH_DIR = join(import.meta.dirname, "..", "research");

test("probe MapX view catalogues", async ({ page }) => {
  test.setTimeout(180_000); // 3 min total

  const allViews = [];

  for (const project of PROJECTS) {
    console.log(`\nProbing ${project.name} (${project.id})...`);

    // Serve a minimal page that loads the SDK and dumps views
    await page.setContent(`
      <!DOCTYPE html>
      <html><body>
        <div id="mapx-container" style="width:1px;height:1px;"></div>
        <script src="https://app.mapx.org/sdk/mxsdk.umd.js"></script>
        <script>
          window._probeResult = null;
          window._probeError = null;
          window._probeDone = false;

          const mgr = new mxsdk.Manager({
            container: document.getElementById("mapx-container"),
            url: "https://app.mapx.org/?project=${project.id}&language=en&theme=color_light",
            params: { closePanels: true },
            style: { width: "1px", height: "1px", border: "none" },
          });

          const timeout = setTimeout(() => {
            window._probeError = "Timeout after 90s";
            window._probeDone = true;
          }, 90000);

          mgr.on("ready", async () => {
            try {
              const views = await mgr.ask("get_views");
              window._probeResult = views.map(v => ({
                id: v.id,
                type: v.type || "unknown",
                title: v.data?.title?.en || v.data?.title?.fr || Object.values(v.data?.title || {})[0] || "(untitled)",
                abstract: (v.data?.abstract?.en || v.data?.abstract?.fr || "").substring(0, 500),
                project: "${project.id}",
                projectName: "${project.name}",
              }));
            } catch (e) {
              window._probeError = e.message;
            }
            clearTimeout(timeout);
            window._probeDone = true;
          });
        </script>
      </body></html>
    `);

    // Wait for probe to complete
    await page.waitForFunction(() => window._probeDone, { timeout: 120_000 });

    const error = await page.evaluate(() => window._probeError);
    if (error) {
      console.error(`  Error: ${error}`);
      continue;
    }

    const views = await page.evaluate(() => window._probeResult);
    console.log(`  Found ${views.length} views`);

    // Sort by type then title
    views.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));

    // Write per-project JSON
    const jsonPath = join(RESEARCH_DIR, `mapx-views-${project.name}.json`);
    writeFileSync(jsonPath, JSON.stringify(views, null, 2));
    console.log(`  Wrote ${jsonPath}`);

    allViews.push(...views);
  }

  // Write combined CSV
  const csvHeader = "project,project_id,view_id,type,title,abstract";
  const csvRows = allViews.map((v) => {
    const esc = (s) => `"${(s || "").replace(/"/g, '""')}"`;
    return [esc(v.projectName), esc(v.project), esc(v.id), esc(v.type), esc(v.title), esc(v.abstract)].join(",");
  });
  const csvPath = join(RESEARCH_DIR, "mapx-views-all.csv");
  writeFileSync(csvPath, [csvHeader, ...csvRows].join("\n"));
  console.log(`\nWrote combined CSV: ${csvPath} (${allViews.length} views)`);
});
