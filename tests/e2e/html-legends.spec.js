import { readFileSync } from "node:fs";
import { test, expect, gotoApp } from "./fixtures/app.js";
const views = JSON.parse(
  readFileSync(new URL("../fixtures/legends/representative-mapx-views.json", import.meta.url)),
);
const rasters = JSON.parse(
  readFileSync(new URL("../fixtures/legends/representative-geoserver.json", import.meta.url)),
);

const sdkLegends = JSON.parse(
  readFileSync(new URL("../fixtures/legends/representative-sdk-legends.json", import.meta.url)),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ catalogue, rasters, sdkLegends }) => {
      window.__mapxStubViews = catalogue;
      window.__mapxStubLegends = {
        ...sdkLegends,
        ...Object.fromEntries(
          Object.entries(rasters).map(([idView, data]) => [
            idView,
            { idView, type: "rt", provider: "geoserver", supported: true, data },
          ]),
        ),
      };
    },
    { catalogue: views, rasters, sdkLegends },
  );
  // A provider request from the parent would regress SDK-owned transport.
  await page.route(/https:\/\/(?:datacore|giri)\.unepgrid\.ch\/geoserver\//, () => {
    throw new Error("Legend provider transport must remain inside MapX");
  });
});

test("structured legends hide the comparison control by default", async ({ page }) => {
  await gotoApp(page, "#hazard?layers=cyclone-surge");
  await expect(page.locator('[data-legend-mode="mapx-raster-structured"]')).toContainText("Low exposure");
  await expect(page.locator("[data-legend-comparison]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__mapxStub.calls.filter((call) => call.method === "get_view_legend_image").length,
    ),
  ).toBe(0);
});

test("cyclone surge uses HTML classes and only fetches its comparison image on demand", async ({ page }) => {
  await gotoApp(page, "?legendComparison=1#hazard?layers=cyclone-surge");
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

test("computed vector rules render through the SDK without catalogue extraction", async ({ page }) => {
  await gotoApp(page, "#risk-resilience?layers=recovery-speed");
  const legend = page.locator('[data-legend-mode="mapx-vector-structured"]').first();
  await expect(legend).toBeVisible();
  await expect(legend).toHaveAttribute("data-legend-transport", "mapx-sdk");
  await expect(legend).toContainText("% of consumption recovered after 1 year of event");
  expect(
    await page.evaluate(() => window.__mapxStub.calls.filter((c) => c.method === "get_views").length),
  ).toBe(0);
});

test("PGA retains its source unit while using the official GeoServer legend", async ({ page }) => {
  await gotoApp(page, "#hazard?layers=earthquake-pga");
  const legend = page.locator('[data-legend-mode="mapx-raster-structured"]').first();
  await expect(legend).toContainText("Peak Ground Acceleration PGA - 250 Years");
  await expect(page.locator(".legend-note").first()).toContainText("cm/s²");
});
