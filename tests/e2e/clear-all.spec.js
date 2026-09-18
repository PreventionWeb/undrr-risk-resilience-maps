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
} from "./fixtures/app.js";

test.describe("clear all", () => {
  test("leaves nothing on when it runs while layers are still loading", async ({ page }) => {
    await gotoApp(page, "#hazard");
    // Longer than the three clicks and the clear take, so all three adds are
    // provably unanswered when Clear all runs.
    await setMapxLatency(page, 1_500);

    const rows = ["Landslides", "Tsunamis", "River Flooding"].map((label) => layerRow(page, label));
    const clear = page.locator("#layer-clear-btn");

    // Three turn-ons back to back, then Clear all before MapX has answered
    // them: the layers are cleared mid-flight, not after they settle.
    for (const row of rows) await toggleLayer(row);
    await clear.click();

    for (const row of rows) await expect(layerSwitch(row)).not.toBeChecked();
    for (const row of rows) await expect(row).not.toHaveClass(/layer-active/);

    await expect(page).toHaveURL(/#hazard$/);
    // Once every call has settled, the adds that landed after the clear have
    // been undone too: nothing is left on the map.
    for (const row of rows) await settled(row);
    expect(await openViews(page)).toEqual([]);
    // And the control that clears them is gone again.
    await expect(clear).toBeHidden();
  });
});
