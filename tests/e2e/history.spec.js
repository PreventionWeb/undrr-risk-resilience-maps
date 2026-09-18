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

const hash = (page) => new URL(page.url()).hash;
const historyLength = (page) => page.evaluate(() => history.length);

test.describe("back and forward", () => {
  test("one action is one entry, and each step restores its own layers", async ({ page }) => {
    await gotoApp(page, "#hazard");

    const landslides = layerRow(page, "Landslides");
    const tsunamis = layerRow(page, "Tsunamis");
    const landslidesOn = layerSwitch(landslides);
    const tsunamisOn = layerSwitch(tsunamis);

    const start = await historyLength(page);

    await toggleLayer(landslides);
    await expect(landslidesOn).toBeChecked();
    await expect(page).toHaveURL(/#hazard\?layers=landslides$/);
    expect(await historyLength(page)).toBe(start + 1);

    await toggleLayer(tsunamis);
    await expect(tsunamisOn).toBeChecked();
    await expect(page).toHaveURL(/#hazard\?layers=landslides,tsunamis$/);
    expect(await historyLength(page)).toBe(start + 2);

    const entries = await historyLength(page);

    await page.goBack();
    await expect(page).toHaveURL(/#hazard\?layers=landslides$/);
    await expect(landslidesOn).toBeChecked();
    await expect(tsunamisOn).not.toBeChecked();

    await page.goBack();
    await expect(page).toHaveURL(/#hazard$/);
    await expect(landslidesOn).not.toBeChecked();
    await expect(tsunamisOn).not.toBeChecked();

    await page.goForward();
    await expect(page).toHaveURL(/#hazard\?layers=landslides$/);
    await expect(landslidesOn).toBeChecked();
    await expect(tsunamisOn).not.toBeChecked();

    await page.goForward();
    await expect(page).toHaveURL(/#hazard\?layers=landslides,tsunamis$/);
    await expect(landslidesOn).toBeChecked();
    await expect(tsunamisOn).toBeChecked();

    // Reconciling a history entry corrects it in place; moving through history
    // must not pile up entries of its own.
    expect(await historyLength(page)).toBe(entries);
  });

  test("a double toggle while MapX is busy makes one entry that ends where it started", async ({ page }) => {
    await gotoApp(page, "#hazard");
    // Longer than it takes to click twice, so the second click provably lands
    // while the first view_add is unanswered.
    await setMapxLatency(page, 1_000);

    const landslides = layerRow(page, "Landslides");
    const start = await historyLength(page);

    // Latest intent wins, and the whole interaction is one entry.
    await toggleLayer(landslides);
    await toggleLayer(landslides);

    await expect(layerSwitch(landslides)).not.toBeChecked();

    // The switch tells the truth long before MapX has answered either call, so
    // wait for both to settle before counting.
    await settled(landslides);
    expect(await openViews(page)).toEqual([]);
    expect(hash(page)).toBe("#hazard");
    // The add still reached the map and pushed an entry naming the layer; the
    // removal that followed replaced that entry rather than pushing a second.
    expect(await historyLength(page)).toBe(start + 1);
  });
});
