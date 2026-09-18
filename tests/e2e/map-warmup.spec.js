import { expect, gotoApp, layerRow, layerSwitch, openTab, test, toggleLayer } from "./fixtures/app.js";

/**
 * While an information page is shown the map is not hidden: it stays laid out
 * inside the viewport so the browser keeps rendering the cross-origin MapX
 * iframe and MapX finishes loading before the first data-tab click (see
 * "Why the map warms up behind the information pages" in ARCHITECTURE.md).
 *
 * That only holds if the map is genuinely rendered, which is also the one thing
 * that could hand it back to the mouse, the keyboard or a screen reader. These
 * specs pin both halves.
 */
test.describe("map warm-up behind an information page", () => {
  test("the map keeps loading in the viewport, out of reach", async ({ page }) => {
    await gotoApp(page, "#home");

    const map = page.locator("#app-map");

    // Rendered: laid out, inside the viewport, and not hidden by any of the
    // ways that stop a browser painting an iframe.
    const state = await map.evaluate((el) => {
      const styles = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        display: styles.display,
        visibility: styles.visibility,
        opacity: styles.opacity,
        pointerEvents: styles.pointerEvents,
        inViewport: box.width > 0 && box.height > 0 && box.top < window.innerHeight && box.bottom > 0,
      };
    });
    expect(state).toMatchObject({
      display: "block",
      visibility: "visible",
      opacity: "0",
      pointerEvents: "none",
      inViewport: true,
    });

    // Out of reach: invisible, out of the accessibility tree, and inert -- on
    // the map and on each of its children, which cover each other's blind spot
    // (Mangrove's preview gate strips `inert` from every child of <body> when
    // the PIN is accepted; a panel appended after the sidebar is built has only
    // the map's).
    await expect(map).toHaveClass(/is-warming/);
    await expect(map).toHaveAttribute("aria-hidden", "true");
    await expect(map).toHaveAttribute("inert", "");
    // The parts that hold something focusable carry it themselves as well.
    for (const id of ["#mapx", "#sidebar", "#inspect-toggle"]) {
      await expect(map.locator(id)).toHaveAttribute("inert", "");
    }

    // Not a tab stop: tabbing through the page never lands inside the map.
    await page.locator("body").press("Tab");
    for (let i = 0; i < 30; i++) {
      expect(
        await page.evaluate(() => document.getElementById("app-map").contains(document.activeElement)),
      ).toBe(false);
      await page.keyboard.press("Tab");
    }

    // Not a click target either: the information page is what a click hits.
    const hit = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return document.getElementById("app-map").contains(el);
    });
    expect(hit).toBe(false);

    // The information page is still the full-page view, with the global footer.
    await expect(page.locator("#info-page")).toBeVisible();
    await expect(page.locator("[data-tab-panel='home']")).toBeVisible();
    // (The footer's content comes from the PreventionWeb widget, which the
    // fixture stubs out, so this asks whether the page shows it, not whether
    // it has drawn anything.)
    expect(await page.locator("#global-footer").evaluate((el) => el.hidden)).toBe(false);
  });

  test("opening a data tab hands the map back", async ({ page }) => {
    await gotoApp(page, "#home");
    await openTab(page, "hazard");

    const map = page.locator("#app-map");
    await expect(map).not.toHaveClass(/is-warming/);
    await expect(map).not.toHaveAttribute("aria-hidden", "true");
    expect(await map.evaluate((el) => el.hasAttribute("inert"))).toBe(false);
    expect(await map.locator("> *").evaluateAll((els) => els.some((el) => el.hasAttribute("inert")))).toBe(
      false,
    );

    await expect(map).toBeVisible();
    await expect(page.locator("#info-page")).toBeHidden();

    // And the layer panel inside it works as before.
    const row = layerRow(page, "Landslides");
    await toggleLayer(row);
    await expect(layerSwitch(row)).toBeChecked();
    await expect(page).toHaveURL(/#hazard\?layers=landslides$/);
  });
});
