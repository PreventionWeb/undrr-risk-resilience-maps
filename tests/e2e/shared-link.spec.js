import { expect, gotoApp, layerRow, layerSwitch, openViews, test } from "./fixtures/app.js";

const SHARED_LINK = "#hazard?layers=river-flooding:1,earthquake-pga:2,landslides";

test.describe("shared link", () => {
  test("restores three layers, their sources, and leaves the URL byte-identical", async ({ page }) => {
    await gotoApp(page, SHARED_LINK);

    const flooding = layerRow(page, "River Flooding");
    const earthquake = layerRow(page, "Earthquake PGA");
    const landslides = layerRow(page, "Landslides");

    await expect(layerSwitch(flooding)).toBeChecked();
    await expect(layerSwitch(earthquake)).toBeChecked();
    await expect(layerSwitch(landslides)).toBeChecked();

    // River Flooding's sub-tabs widget shows source 1 of Depth/Frequency/Exposure.
    await expect(flooding.locator('.widget-sub-tab[aria-selected="true"]')).toHaveText("Frequency");
    // Earthquake PGA's stepped slider shows source 2 of five return periods.
    await expect(earthquake.locator("input.widget-slider-input")).toHaveValue("2");
    // Landslides has no index in the link, so it restores on its first source.
    await expect(landslides.locator('.widget-sub-tab[aria-selected="true"]')).toHaveText("Exposure");

    // The restore rewrites the URL in place once every layer has settled. A
    // shared link must survive that untouched, character for character.
    await expect(page).toHaveURL(new RegExp(`${SHARED_LINK.replace(/[?]/g, "\\?")}$`));
    expect(new URL(page.url()).hash).toBe(SHARED_LINK);

    // The three views MapX was asked for, in the link's order.
    expect(await openViews(page)).toHaveLength(3);
  });

  test("restores nothing from a link with no layers", async ({ page }) => {
    await gotoApp(page, "#hazard");

    await expect(layerSwitch(layerRow(page, "Landslides"))).not.toBeChecked();
    expect(new URL(page.url()).hash).toBe("#hazard");
    expect(await openViews(page)).toEqual([]);
  });
});
