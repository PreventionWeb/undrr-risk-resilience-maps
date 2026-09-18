/**
 * Every notice this app hides with the `hidden` attribute is also a Mangrove
 * component, and Mangrove gives those components a `display` — `flex` for
 * `.mg-notice`, `flex` for `.mg-empty-state`. An author rule beats the UA's
 * `[hidden] { display: none }`, so without a local `[hidden]` rule the notice is
 * on screen from the first paint, permanently, whatever the attribute says.
 *
 * `.embed-empty` shipped without that rule and put a "this embed has no layers
 * to show" warning over every embed. It passed CI because the suite only ever
 * asserted the notice was *visible* in the state that shows it: nothing said it
 * was gone in the states that do not. These specs are the missing half, for all
 * four notices at once — and only a real browser with the real stylesheet can
 * answer it, which is why they are here and not in a jsdom unit test.
 */
import { expect, layerRow, gotoApp, test, toggleLayer } from "./fixtures/app.js";
import { gotoEmbed } from "./fixtures/embed.js";

/**
 * A notice that carries `hidden` must be `display: none` and invisible.
 * `toBeHidden()` alone is not enough evidence: it would also pass for a notice
 * that happens to be laid out at zero size, and the trap is the `display`.
 */
async function expectHiddenAttributeToWork(locator) {
  await expect(locator).toHaveAttribute("hidden", "");
  await expect(locator).toBeHidden();
  expect(await locator.evaluate((el) => getComputedStyle(el).display)).toBe("none");
}

test.describe("a notice with `hidden` is actually hidden", () => {
  test("the embed's empty state stays out of an ordinary embed", async ({ page }) => {
    // The blocker: `.embed-empty` is `.mg-notice`, so every embed carried the
    // warning above its map and its tabs.
    await gotoEmbed(page, "?tab=hazard&layers=landslides");
    await expectHiddenAttributeToWork(page.locator("[data-ui-embed-empty]"));
  });

  test("the MapX service notice stays out of a map that loaded", async ({ page }) => {
    await gotoApp(page, "#hazard");
    await expectHiddenAttributeToWork(page.locator(".map-service-notice"));
  });

  test("a tab panel's empty state stays out of a tab that has layers", async ({ page }) => {
    await gotoApp(page, "#hazard");
    const panel = page.locator('[data-tab-panel="hazard"]');
    // Not just any `.layer-item`: the panel also holds the unpublished layers
    // "Show disabled" reveals, and those carry `hidden` themselves.
    await expect(panel.locator(".layer-item:not([hidden])").first()).toBeVisible();
    await expectHiddenAttributeToWork(panel.locator(".tab-panel-empty"));
  });

  test("the site inspector stays out of the map until a location is inspected", async ({ page }) => {
    await gotoApp(page, "#hazard");
    // The inspector is built with the map and only revealed by a click on it,
    // so an ordinary session never sees it — and a layer being on must not
    // change that.
    await expectHiddenAttributeToWork(page.locator("#site-inspector"));
    await toggleLayer(layerRow(page, "Landslides"));
    await expectHiddenAttributeToWork(page.locator("#site-inspector"));
  });
});
