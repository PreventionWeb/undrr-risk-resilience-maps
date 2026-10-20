import {
  expect,
  gotoApp,
  layerRow,
  layerSwitch,
  settled,
  test,
  toggleLayer,
  viewId,
} from "./fixtures/app.js";

/**
 * MapX 1.14.2 changed what the opacity getter answers and added a one-per-click
 * `click_features` event (unep-grid/mapx#1135, #1139). The app picks its path
 * from the version the Manager reports, so the same build has to work on the
 * production release and on the next one.
 */
for (const { version, clickEvent, otherEvent } of [
  { version: "1.14.1", clickEvent: "click_attributes", otherEvent: "click_features" },
  { version: "1.14.2-alpha.3", clickEvent: "click_features", otherEvent: "click_attributes" },
]) {
  test.describe(`MapX ${version}`, () => {
    test.use({ mapxVersion: version });

    test("a fresh layer's opacity slider reads 100%", async ({ page }) => {
      await gotoApp(page, "#hazard");
      const flooding = layerRow(page, "River Flooding");
      await toggleLayer(flooding);
      await expect(layerSwitch(flooding)).toBeChecked();
      await settled(flooding);

      await expect(flooding.locator(".layer-slider-slot input.mg-range")).toHaveValue("100");
      await expect(flooding.locator(".opacity-value")).toHaveText("100%");
    });

    test(`map clicks arrive as ${clickEvent} only, and fill the infobox`, async ({ page }) => {
      await gotoApp(page, "#hazard");
      expect(await page.evaluate((event) => window.__mapxStub.listening(event), clickEvent)).toBe(true);
      expect(await page.evaluate((event) => window.__mapxStub.listening(event), otherEvent)).toBe(false);

      const infobox = page.locator("#infobox");
      const feature = { name: "Site A", hazard: "flood" };
      await page.evaluate(
        ({ event, feature }) =>
          window.__mapxStub.emit(
            event,
            event === "click_features"
              ? { attributes: { "MX-SITE": [feature] }, lngLat: { lng: 1, lat: 2 } }
              : { part: 1, nPart: 1, idView: "MX-SITE", attributes: [feature], lngLat: { lng: 1, lat: 2 } },
          ),
        { event: clickEvent, feature },
      );
      await expect(infobox).toBeVisible();
      await expect(infobox.locator(".infobox-title")).toHaveText("Site A");
    });

    test("the site inspector reads a raster layer that missed as queried", async ({ page }) => {
      await gotoApp(page, "#hazard");
      const flooding = layerRow(page, "River Flooding");
      await toggleLayer(flooding);
      await settled(flooding);
      await page.locator('[data-ui="inspect-toggle"]').click();

      // A click that hits nothing on an open raster view: 1.14.1 reports the
      // view with no features, 1.14.2 leaves it out of `attributes`.
      await page.evaluate(
        ({ event, idView }) =>
          window.__mapxStub.emit(
            event,
            event === "click_features"
              ? { attributes: {}, lngLat: { lng: 1, lat: 2 } }
              : { part: 1, nPart: 1, idView, attributes: [], lngLat: { lng: 1, lat: 2 } },
          ),
        { event: clickEvent, idView: viewId("river-flooding") },
      );
      const row = page.locator("#site-inspector .site-inspector-layer-row");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("No data at this location.");
    });
  });
}

test.describe("MapX 1.14.2 empty clicks", () => {
  test.use({ mapxVersion: "1.14.2-alpha.3" });

  test("a click that hits nothing closes the infobox", async ({ page }) => {
    await gotoApp(page, "#hazard");
    const infobox = page.locator("#infobox");
    await page.evaluate(() =>
      window.__mapxStub.emit("click_features", { attributes: { "MX-SITE": [{ name: "Site A" }] } }),
    );
    await expect(infobox).toBeVisible();

    await page.evaluate(() => window.__mapxStub.emit("click_features", { attributes: {} }));
    await expect(infobox).toBeHidden();
  });
});
