import { expect, gotoApp, layerRow, layerSwitch, settled, test, toggleLayer } from "./fixtures/app.js";

// Production MapX is now 1.14.2. These are consumer guarantees; the SDK
// is stubbed so the suite remains independent of the hosted service.
test.describe("MapX 1.14.2", () => {
  test("a fresh layer's opacity slider reads 100%", async ({ page }) => {
    await gotoApp(page, "#hazard");
    const flooding = layerRow(page, "River Flooding");
    await toggleLayer(flooding);
    await expect(layerSwitch(flooding)).toBeChecked();
    await settled(flooding);
    await expect(flooding.locator(".layer-slider-slot input.mg-range")).toHaveValue("100");
    await expect(flooding.locator(".opacity-value")).toHaveText("100%");
  });

  test("listens to click_features alone and fills the infobox", async ({ page }) => {
    await gotoApp(page, "#hazard");
    expect(await page.evaluate(() => window.__mapxStub.listening("click_features"))).toBe(true);
    expect(await page.evaluate(() => window.__mapxStub.listening("click_attributes"))).toBe(false);
    await page.evaluate(() =>
      window.__mapxStub.emit("click_features", {
        attributes: { "MX-SITE": [{ name: "Site A", hazard: "flood" }] },
        lngLat: { lng: 1, lat: 2 },
      }),
    );
    const infobox = page.locator("#infobox");
    await expect(infobox).toBeVisible();
    await expect(infobox.locator(".infobox-title")).toHaveText("Site A");
  });

  test("the site inspector reads a raster layer that missed as queried", async ({ page }) => {
    await gotoApp(page, "#hazard");
    const flooding = layerRow(page, "River Flooding");
    await toggleLayer(flooding);
    await settled(flooding);
    await page.locator('[data-ui="inspect-toggle"]').click();
    await page.evaluate(() =>
      window.__mapxStub.emit("click_features", {
        attributes: {},
        lngLat: { lng: 1, lat: 2 },
      }),
    );
    const row = page.locator("#site-inspector .site-inspector-layer-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("No data at this location.");
  });

  test("a click that hits nothing closes the infobox", async ({ page }) => {
    await gotoApp(page, "#hazard");
    const infobox = page.locator("#infobox");
    await page.evaluate(() =>
      window.__mapxStub.emit("click_features", {
        attributes: { "MX-SITE": [{ name: "Site A" }] },
      }),
    );
    await expect(infobox).toBeVisible();
    await page.evaluate(() => window.__mapxStub.emit("click_features", { attributes: {} }));
    await expect(infobox).toBeHidden();
  });
});
