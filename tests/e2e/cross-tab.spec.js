import {
  crossTabRow,
  expect,
  gotoApp,
  layerRow,
  layerSwitch,
  openCrossTabSection,
  openTab,
  test,
  toggleLayer,
} from "./fixtures/app.js";

test.describe("cross-tab toggle", () => {
  test("a layer turned on from another tab renders its own controls exactly once", async ({ page }) => {
    await gotoApp(page, "#hazard");

    // Mangroves lives in Exposure. Turn it on from Hazard's cross-tab section.
    await openCrossTabSection(page, "hazard", "Exposure");
    const compact = crossTabRow(page, "hazard", "Exposure", "Mangroves");
    await toggleLayer(compact);

    await expect(layerSwitch(compact)).toBeChecked();
    await expect(page).toHaveURL(/#hazard\?layers=mangroves$/);
    // The compact row is the visible one, so it is the row that renders.
    await expect(compact.locator(".layer-slider-slot input.mg-range")).toHaveCount(1);

    // Its home row was hidden while it came on, so it has rendered nothing yet
    // (this is the drift that #10 and #12 were about).
    const home = layerRow(page, "Mangroves");
    await expect(home.locator(".layer-slider-slot input.mg-range")).toHaveCount(0);

    await openTab(page, "exposure");

    await expect(layerSwitch(home)).toBeChecked();
    // One slider and one legend, not two: the row renders a view once.
    await expect(home.locator(".layer-slider-slot input.mg-range")).toHaveCount(1);
    await expect(home.locator(".layer-legend-slot .legend-image-fallback")).toHaveCount(1);
    await expect(home).toHaveClass(/layer-active/);

    // The tab switch is its own history entry; the layer is still in the URL.
    await expect(page).toHaveURL(/#exposure\?layers=mangroves$/);

    // Going back to Hazard does not make the compact row render a second set.
    await openTab(page, "hazard");
    await expect(compact.locator(".layer-slider-slot input.mg-range")).toHaveCount(1);
    await expect(compact.locator(".layer-legend-slot .legend-image-fallback")).toHaveCount(1);
  });
});
