import { readFile } from "node:fs/promises";
import { expect, gotoApp, layerRow, openViews, settled, test } from "./fixtures/app.js";

/**
 * Prototype data downloads (#64) are behind `?downloads=1`. Without it nothing
 * download-related may appear; with it raster rows link their GeoTIFF and
 * region-level vector views generate a CSV through the progress dialog. MapX is
 * the suite's stub, which (like MapX) only returns a table for a view the
 * session has loaded.
 */

const sourcesPage = (page) => page.locator('.info-page-panel[data-tab-panel="sources"]');

test("without the flag, nothing download-related appears", async ({ page }) => {
  await gotoApp(page, "#hazard?layers=landslides");
  const row = layerRow(page, "Landslides");
  await settled(row);
  // The row is expanded (its body is showing) and still has no download controls.
  await expect(row.locator(".layer-body")).toBeVisible();
  await expect(page.locator(".layer-downloads, .layer-downloads-slot")).toHaveCount(0);

  await gotoApp(page, "#sources");
  await expect(sourcesPage(page)).toBeVisible();
  await expect(sourcesPage(page).locator("th", { hasText: /^Download$/ })).toHaveCount(0);
  await expect(page.locator("[data-action='download-csv'], dialog")).toHaveCount(0);
});

test("with ?downloads=1, a raster row links its GeoTIFF with format and size", async ({ page }) => {
  await page.goto("/?downloads=1#hazard?layers=landslides");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  const row = layerRow(page, "Landslides");
  await settled(row);
  const link = row.locator("a.layer-downloads__link");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://gar-data.unepgrid.ch/2026/ls_phex.tif");
  await expect(link).toHaveAttribute("download", "ls_phex.tif");
  await expect(link).toHaveAccessibleName("Download ls_phex.tif: Landslides – Exposure (GeoTIFF, 75.7 MB)");
});

test("a Sources dataset opens in the viewer, where its values-only CSV can be downloaded", async ({
  page,
}) => {
  await page.goto("/?downloads=1#sources");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  await expect(sourcesPage(page).locator("th", { hasText: /^Download$/ })).toHaveCount(0);
  await expect(sourcesPage(page).locator(".layer-downloads")).toHaveCount(0);
  await sourcesPage(page).getByRole("link", { name: "Recovery Speed", exact: true }).click();
  await expect(page).toHaveURL(/#risk-resilience\?layers=recovery-speed$/);
  const row = layerRow(page, "Recovery Speed");
  await settled(row);
  const button = row.locator("[data-action='download-csv']");
  const id = await button.getAttribute("data-view-id");
  const downloadEvent = page.waitForEvent("download");
  await button.click();

  const dialog = page.locator("dialog.download-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-state", "done");
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(new RegExp(`_${id}\\.csv$`));
  const text = await readFile(await download.path(), "utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const lines = text.slice(1).trimEnd().split("\r\n");
  expect(lines).toContain(`#,MapX view ID: ${id}`);
  expect(lines.filter((line) => !line.startsWith("#,")).slice(1)).toEqual([
    "CCA,Region A,1",
    "CCB,Region B,2.5",
    "xQZ,Placeholder area,7",
  ]);
  expect(lines.some((line) => line.startsWith('#,"Disclaimer: The designations employed'))).toBe(true);
  await expect(dialog.locator('[role="status"]')).toHaveText(/Download started: .*\(3 regions\)\./);

  // Downloading the displayed map reads it without adding or removing it.
  const calls = await page.evaluate((viewIdToFind) => {
    return window.__mapxStub.calls
      .filter((call) => call.params.idView === viewIdToFind)
      .map((call) => [call.method, call.params.zoomToView]);
  }, id);
  expect(calls.filter(([method]) => method === "get_view_table_attribute")).toHaveLength(1);
  expect(calls.filter(([method]) => method === "view_add")).toHaveLength(1);
  expect(calls.some(([method]) => method === "view_remove")).toBe(false);
  expect(await openViews(page)).toContain(id);

  // Escape closes the dialog and returns focus to the button.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test("closing the dialog mid-fetch keeps the displayed map intact", async ({ page }) => {
  await page.goto("/?downloads=1#risk-resilience?layers=recovery-speed");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  const row = layerRow(page, "Recovery Speed");
  await settled(row);
  await page.evaluate(() => {
    window.__mapxStub.tableDelayMs = 600;
    window.__mapxStub.calls = [];
  });
  const button = row.locator("[data-action='download-csv']");
  const id = await button.getAttribute("data-view-id");
  let downloaded = false;
  page.on("download", () => {
    downloaded = true;
  });
  await button.click();
  const dialog = page.locator("dialog.download-dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  expect(await openViews(page)).toContain(id);
  await expect(page.locator('[data-ui="mapx"]')).not.toHaveClass(/is-reading-data/);
  // Wait for the slow table response to settle before checking cancellation.
  await page.waitForFunction(() => window.__mapxStub.tableReadsCompleted > 0);
  expect(downloaded).toBe(false);
  const calls = await page.evaluate(
    (viewId) =>
      window.__mapxStub.calls.filter((call) => call.params.idView === viewId).map((call) => call.method),
    id,
  );
  expect(calls).toEqual(["get_view_table_attribute"]);
});

test("embed: downloads=1 shows the same controls", async ({ page }) => {
  await page.goto("/embed.html?downloads=1&tab=hazard&layers=landslides");
  await page.waitForFunction(() => window.__mapxStub?.ready);
  const row = layerRow(page, "Landslides");
  await settled(row);
  await expect(row.locator("a.layer-downloads__link")).toHaveAttribute(
    "href",
    "https://gar-data.unepgrid.ch/2026/ls_phex.tif",
  );
});
