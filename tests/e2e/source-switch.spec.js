import {
  expect,
  gotoApp,
  layerRow,
  layerSwitch,
  openViews,
  setMapxLatency,
  settled,
  test,
  toggleLayer,
  viewId,
} from "./fixtures/app.js";

test.describe("source switch", () => {
  test("quick picks end on the last one, with widget, URL and legend agreeing", async ({ page }) => {
    await gotoApp(page, "#hazard");

    const flooding = layerRow(page, "River Flooding");
    await toggleLayer(flooding);
    await expect(layerSwitch(flooding)).toBeChecked();
    await settled(flooding);
    const entriesBeforePicks = await page.evaluate(() => history.length);

    const sources = flooding.locator(".widget-sub-tab");
    await expect(sources).toHaveCount(3);

    // Depth → Frequency → Exposure, with MapX slow enough that the second pick
    // provably lands while the first is still in flight, so an earlier pick can
    // reach the map after a later one. The latest pick must win.
    await setMapxLatency(page, 1_000);
    await sources.nth(1).click();
    await sources.nth(2).click();

    const expected = viewId("river-flooding", 2);

    // The widget shows the pick it ended on.
    await expect(flooding.locator('.widget-sub-tab[aria-selected="true"]')).toHaveText("Exposure");
    // The URL names the same source.
    await expect(page).toHaveURL(/#hazard\?layers=river-flooding:2$/);
    // The opacity slider is built for the view actually on the map.
    await expect(flooding.locator(".layer-slider-slot input.mg-range")).toHaveAttribute(
      "data-view-id",
      expected,
    );
    // And so is the legend: the stub's legend image carries its own view id.
    const legend = flooding.locator(".layer-legend-slot img.layer-legend-img");
    await expect(legend).toHaveCount(1);
    await expect(legend).toHaveAttribute("src", new RegExp(expected));

    // One layer on the map, on its final source only.
    await settled(flooding);
    expect(await openViews(page)).toEqual([expected]);
    // Two picks are still one user action: the first pick's entry is replaced
    // by the second, not added to, so Back returns to Depth in one step.
    expect(await page.evaluate(() => history.length)).toBe(entriesBeforePicks + 1);
  });
});
