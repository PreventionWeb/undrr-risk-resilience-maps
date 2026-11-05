import { readFile } from "node:fs/promises";
import { expect, gotoApp, layerRow, openViews, setMapxLatency, settled, test } from "./fixtures/app.js";

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

test("with ?downloads=1, the Sources page generates a values-only CSV", async ({ page }) => {
  await page.goto("/?downloads=1#sources");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  await expect(
    sourcesPage(page)
      .locator("th", { hasText: /^Download$/ })
      .first(),
  ).toBeAttached();

  const button = sourcesPage(page).locator("[data-action='download-csv']:visible").first();
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

  // The view was added only for the read, without moving the camera, and is gone again.
  const calls = await page.evaluate((viewIdToFind) => {
    return window.__mapxStub.calls
      .filter((call) => call.params.idView === viewIdToFind)
      .map((call) => [call.method, call.params.zoomToView]);
  }, id);
  expect(calls).toEqual([
    ["view_add", false],
    ["get_view_table_attribute", undefined],
    ["view_remove", undefined],
  ]);
  expect(await openViews(page)).not.toContain(id);

  // Escape closes the dialog and returns focus to the button.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test("closing the dialog mid-fetch stops further MapX calls and unmasks the map", async ({ page }) => {
  await page.goto("/?downloads=1#sources");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  // view_add answers slowly, so Escape lands while it is in flight.
  await setMapxLatency(page, 600);
  const button = sourcesPage(page).locator("[data-action='download-csv']:visible").first();
  const id = await button.getAttribute("data-view-id");
  await button.click();
  const dialog = page.locator("dialog.download-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-ui="mapx"]')).toHaveClass(/is-reading-data/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The add it had started is taken off again; nothing is read or downloaded.
  await expect.poll(() => openViews(page)).not.toContain(id);
  await expect(page.locator('[data-ui="mapx"]')).not.toHaveClass(/is-reading-data/);
  const calls = await page.evaluate(
    (viewIdToFind) =>
      window.__mapxStub.calls
        .filter((call) => call.params.idView === viewIdToFind)
        .map((call) => call.method),
    id,
  );
  expect(calls).toEqual(["view_add", "view_remove"]);
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
