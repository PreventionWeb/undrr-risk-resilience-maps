import { expect, gotoApp, layerRow, layerSwitch, test } from "./fixtures/app.js";

test.describe("keyboard", () => {
  test("Tab reaches a layer switch, Space turns it on and Enter turns it off", async ({ page }) => {
    await gotoApp(page, "#hazard");

    const landslides = layerRow(page, "Landslides");
    const toggle = layerSwitch(landslides);

    // The row's two controls are siblings: the expand button, then the switch.
    await landslides.locator("button.layer-expand").focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();

    // Space is a checkbox's native activation.
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await expect(page).toHaveURL(/#hazard\?layers=landslides$/);

    // Enter is not, and the row adds it because the panel's switches are
    // expected to answer both (see the keyboard fix in the changelog).
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).not.toBeChecked();
    await expect(page).toHaveURL(/#hazard$/);
  });
});
