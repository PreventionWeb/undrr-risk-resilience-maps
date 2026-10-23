import { readFileSync } from "node:fs";
import { test, expect, gotoApp } from "./fixtures/app.js";
const views = JSON.parse(readFileSync(new URL("../fixtures/legends/mapx-views.json", import.meta.url)));
const rasters = JSON.parse(readFileSync(new URL("../fixtures/legends/geoserver.json", import.meta.url)));

test.beforeEach(async ({ page }) => {
  await page.addInitScript((catalogue) => {
    window.__mapxStubViews = catalogue;
  }, views);
  await page.route("https://datacore.unepgrid.ch/geoserver/wms?*", async (route) => {
    const layer = new URL(route.request().url()).searchParams.get("layer");
    const view = views.find(
      (view) => view.type === "rt" && new URL(view.data.source.legend).searchParams.get("layer") === layer,
    );
    if (!view) throw new Error(`Unexpected legend request: ${layer}`);
    await route.fulfill({ json: rasters[view.id], headers: { "access-control-allow-origin": "*" } });
  });
});

test("cyclone surge uses HTML classes and only fetches its comparison image on demand", async ({ page }) => {
  await gotoApp(page, "#hazard?layers=cyclone-surge");
  const legend = page.locator('[data-legend-mode="mapx-raster-structured"]');
  await expect(legend).toContainText("Low exposure");
  await expect(legend.locator('[role="listitem"]')).toHaveCount(4);
  await expect(legend).toContainText("No data");
  await expect(page.locator(".legend-image-fallback")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__mapxStub.calls.filter((call) => call.method === "get_view_legend_image").length,
    ),
  ).toBe(0);
  await page.getByText("Show MapX image legend (comparison)", { exact: true }).click();
  await expect(page.locator(".legend-diagnostic img")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => window.__mapxStub.calls.filter((call) => call.method === "get_view_legend_image").length,
    ),
  ).toBe(1);
});

test("HDI displays a continuous ramp with readable stop labels", async ({ page }) => {
  await gotoApp(page, "#vulnerability?layers=hdi");
  await expect(page.locator(".html-legend-ramp > span")).toHaveCount(4);
  await expect(page.locator(".html-legend-rules")).toContainText("0.529");
});

test("the GAR raster group keeps both sublayer legends", async ({ page }) => {
  await gotoApp(page, "#gar?layers=sdg-drought");
  await expect(page.locator(".html-legend").first()).toContainText("SDG15.3.1");
  await expect(page.locator(".html-legend").first()).toContainText("Drought frequency 30");
});

test("the custom bivariate legend is an accessible HTML table", async ({ page }) => {
  await gotoApp(page, "#gar?layers=water-scarcity-child-nutrition");
  const table = page.locator(".html-legend-matrix");
  await expect(table.locator("td[aria-label]")).toHaveCount(16);
  await expect(table.getByRole("columnheader")).toHaveCount(4);
  await expect(table.getByRole("rowheader")).toHaveCount(4);
});
