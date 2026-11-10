import { readFile } from "node:fs/promises";
import { expect, gotoApp, layerRow, openViews, settled, test } from "./fixtures/app.js";

/**
 * Map downloads default on; `?downloads=0` hides the controls. Raster rows link their GeoTIFF and
 * region-level vector views generate a CSV through the progress dialog. MapX is
 * the suite's stub, which (like MapX) only returns a table for a view the
 * session has loaded.
 */

const sourcesPage = (page) => page.locator('.info-page-panel[data-tab-panel="sources"]');

test("downloads=0 hides map download controls", async ({ page }) => {
  await page.goto("/?downloads=0#hazard?layers=landslides");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  const row = layerRow(page, "Landslides");
  await settled(row);
  // The row is expanded (its body is showing) and still has no download controls.
  await expect(row.locator(".layer-body")).toBeVisible();
  await expect(page.locator(".layer-downloads, .layer-downloads-slot")).toHaveCount(0);

  await page.goto("/?downloads=0#sources");
  await expect(sourcesPage(page)).toBeVisible();
  await expect(sourcesPage(page).locator("th", { hasText: /^Download$/ })).toHaveCount(0);
  await expect(page.locator("[data-action='download-csv'], dialog")).toHaveCount(0);
});

test("by default, Sources links each raster GeoTIFF with format and size", async ({ page }) => {
  await gotoApp(page, "#hazard?layers=landslides");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  const row = layerRow(page, "Landslides");
  await settled(row);
  await page.goto("/#sources");
  const link = sourcesPage(page).locator('a[href="https://gar-data.unepgrid.ch/2026/ls_phex.tif"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://gar-data.unepgrid.ch/2026/ls_phex.tif");
  await expect(link).toHaveAttribute("download", "ls_phex.tif");
  await expect(link).toHaveAccessibleName("Download ls_phex.tif: Landslides – Exposure (GeoTIFF, 75.7 MB)");
});

test("Sources downloads a values-only CSV without selecting the map", async ({ page }) => {
  await page.goto("/#sources");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  await expect(sourcesPage(page).locator("th", { hasText: /^Download$/ })).toHaveCount(0);
  const button = sourcesPage(page).locator('[data-view-id="MX-VCP83-3E2TG-PJWFJ"]');
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
  expect(calls.some(([method]) => method === "view_remove")).toBe(true);
  expect(await openViews(page)).not.toContain(id);

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
  await page.getByRole("link", { name: "Sources", exact: true }).first().click();
  const button = sourcesPage(page).locator('[data-view-id="MX-VCP83-3E2TG-PJWFJ"]');
  const id = await button.getAttribute("data-view-id");
  let downloaded = false;
  page.on("download", () => {
    downloaded = true;
  });
  await button.click();
  const dialog = page.locator("dialog.download-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("progress")).not.toHaveAttribute("value");
  await expect(dialog.locator("progress")).toHaveAccessibleName(/Step 1 of 3:/);
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

test("a slow CSV read shows honest progress and a cancellable wait hint without motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await gotoApp(page, "#risk-resilience?layers=recovery-speed");
  const row = layerRow(page, "Recovery Speed");
  await settled(row);
  await page.clock.install();
  await page.evaluate(() => {
    window.__mapxStub.tableDelayMs = 20_000;
  });
  await page.getByRole("link", { name: "Sources", exact: true }).first().click();
  const button = sourcesPage(page).locator('[data-view-id="MX-VCP83-3E2TG-PJWFJ"]');
  await button.click();
  const dialog = page.locator("dialog.download-dialog");
  await expect(dialog.locator("progress")).not.toHaveAttribute("value");
  await page.clock.fastForward(10_000);
  await expect(dialog.locator('[data-part="notice"]')).toHaveText(/choose Cancel/);
  expect(await dialog.locator("progress").evaluate((el) => el.matches(":indeterminate"))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("slow-download.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test("embed: downloads default on", async ({ page }) => {
  await page.goto("/embed.html?tab=hazard&layers=landslides");
  await page.waitForFunction(() => window.__mapxStub?.ready);
  const row = layerRow(page, "Landslides");
  await settled(row);
  const link = row.getByRole("button", { name: "Citation, methodology and downloads", exact: true });
  await link.click();
  const resources = page.locator(".metric-resources-dialog");
  await expect(resources).toBeVisible();
  await expect(resources.locator('a[href="https://gar-data.unepgrid.ch/2026/ls_phex.tif"]')).toBeVisible();
  await expect(resources.getByRole("link", { name: "View all sources", exact: false })).toHaveAttribute(
    "href",
    /\/#sources$/,
  );
  await expect(row.locator(".layer-downloads")).toHaveCount(0);
});

for (const embed of [false, true]) {
  test(`repository kill switch overrides downloads=1 (${embed ? "embed" : "standalone"})`, async ({
    page,
  }) => {
    // Serve the real feature module with only the repository switch changed.
    // This exercises the same UI paths as a build deployed with downloads off.
    await page.route("**/src/config/features.js*", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      expect(body).toContain("MAP_DOWNLOADS_ENABLED = true;");
      await route.fulfill({
        response,
        body: body.replace("MAP_DOWNLOADS_ENABLED = true;", "MAP_DOWNLOADS_ENABLED = false;"),
      });
    });
    await page.goto(
      embed
        ? "/embed.html?downloads=1&tab=hazard&layers=landslides"
        : "/?downloads=1#hazard?layers=landslides",
    );
    await page.waitForFunction(() => window.__mapxStub?.ready === true);
    await settled(layerRow(page, "Landslides"));
    await expect(layerRow(page, "Landslides").locator(".layer-body")).toBeVisible();
    await expect(page.locator(".layer-downloads, .layer-downloads-slot, dialog")).toHaveCount(0);
  });
}

test("embed opt-out follows the full-viewer link", async ({ page }) => {
  await page.goto("/embed.html?downloads=0&tab=hazard&layers=landslides");
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  await settled(layerRow(page, "Landslides"));
  await expect(page.locator(".layer-downloads, .layer-downloads-slot")).toHaveCount(0);
  const link = page.locator("[data-ui-full-viewer]");
  await expect(link).toHaveAttribute("href", /downloads=0/);
  const href = await link.getAttribute("href");
  await page.goto(href);
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  await settled(layerRow(page, "Landslides"));
  await expect(page.locator(".layer-downloads, .layer-downloads-slot")).toHaveCount(0);
});

test("a modal reports unavailable clipboard access and keeps its URL selectable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await gotoApp(page, "#hazard?layers=river-flooding");
  const row = layerRow(page, "River Flooding");
  await settled(row);
  await page.getByRole("link", { name: "Sources", exact: true }).first().click();
  const download = sourcesPage(page).locator(
    'a[href="https://gar-data.unepgrid.ch/2026/global_pc_h25glob.tif"]',
  );
  await download.click();
  const dialog = page.getByRole("dialog", { name: "Download a large file?" });
  const copy = dialog.getByRole("button", { name: "Copy file URL" });
  await copy.click();
  await expect(copy.locator("[aria-live]")).toHaveText("Copy failed. Select the text and copy it manually.");
  await expect(copy).not.toHaveClass(/mg-copy-button--copied/);
  await expect(dialog).toHaveAttribute("data-state", "confirm");
  const url = dialog.locator("code");
  expect(
    await url.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      return window.getSelection().toString();
    }),
  ).toBe("https://gar-data.unepgrid.ch/2026/global_pc_h25glob.tif");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(download).toBeFocused();
  await download.click();
  await expect(dialog.getByRole("button", { name: "Copy file URL" }).locator("[aria-live]")).toBeEmpty();
});

test("metric resources preserve the scenario, support downloads and return focus to the map", async ({
  page,
}) => {
  await gotoApp(page, "#gar?layers=gar26-aal-crops:7");
  const row = layerRow(page, "Crop average annual loss (%)");
  await settled(row);
  const trigger = row.getByRole("button", { name: "Citation, methodology and downloads", exact: true });
  const before = await openViews(page);
  await trigger.click();
  const resources = page.getByRole("dialog", {
    name: "Resources: Crop average annual loss (%) – Rice AAL (%) – Warming level +2°C",
    exact: true,
  });
  await expect(resources).toBeVisible();
  await expect(resources).toContainText("rice production loss under a +2°C warming level");
  await expect(resources.getByRole("heading", { name: "Citation", exact: true })).toBeVisible();
  await expect(resources.getByRole("link", { name: "Learn more about this metric" })).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(resources.getByRole("link", { name: "View all sources", exact: false })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(resources.getByRole("button", { name: "Close resources", exact: true })).toBeFocused();
  const button = resources.locator('[data-view-id="MX-KU5ID-GHTH8-C2WG3"]');
  const downloaded = page.waitForEvent("download");
  await button.click();
  await downloaded;
  const progress = page.locator("dialog.download-dialog:not(.metric-resources-dialog)");
  await expect(progress).toHaveAttribute("data-state", "done");
  await page.keyboard.press("Escape");
  await expect(progress).toBeHidden();
  await expect(resources).toBeVisible();
  await expect(button).toBeFocused();
  await page.setViewportSize({ width: 390, height: 600 });
  const bounds = await resources.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.height).toBeLessThanOrEqual(600);
  await resources.getByRole("button", { name: "Back to map" }).click();
  await expect(resources).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/#gar\?layers=gar26-aal-crops:7$/);
  expect(await openViews(page)).toEqual(before);
  await expect(row.getByRole("combobox")).toHaveValue("7");
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(resources).toBeHidden();
  await expect(trigger).toBeFocused();
});
