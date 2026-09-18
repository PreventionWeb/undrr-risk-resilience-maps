import {
  expect,
  gotoApp,
  layerRow,
  layerSwitch,
  openTab,
  test,
  toggleLayer,
  unlockPreviewGate,
} from "./fixtures/app.js";

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

    // The warm-up is scheduled behind requestIdleCallback, so the rendered
    // state is the thing to wait for before measuring it.
    await expect(map).toHaveClass(/is-warming/);

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
    // the map and on each of its children. A MutationObserver holds that for as
    // long as the map is warming, whatever else touches the container (see
    // "the preview gate" case below).
    await expect(map).toHaveAttribute("aria-hidden", "true");
    await expect(map).toHaveAttribute("inert", "");
    // Every child carries it too -- including the site-inspector panel, which
    // `buildSiteInspectorPanel()` appends after the sidebar has already
    // switched to the home tab.
    await expect(map.locator("#site-inspector")).toHaveCount(1);
    expect(
      await map
        .locator("> *")
        .evaluateAll((els) => els.filter((el) => !el.hasAttribute("inert")).map((el) => el.id)),
    ).toEqual([]);

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

  test("the skip link is hidden while there is no map to skip to", async ({ page }) => {
    await gotoApp(page, "#home");
    await expect(page.locator(".mg-skip-link")).toBeHidden();

    await openTab(page, "hazard");
    await expect(page.locator(".mg-skip-link")).not.toHaveAttribute("hidden", "");
  });
});

/**
 * The gate is the one thing on the page that reaches into the map's own
 * attributes: on a correct PIN, Mangrove's `preview-access.js` calls
 * `removeAttribute("inert")` on **every direct child of `<body>`**, and
 * `#app-map` is one of them. Before this was re-asserted, "Skip to map" put
 * focus inside an invisible, `aria-hidden` region, and the next Tab skipped the
 * whole page.
 */
test.describe("map warm-up after a real PIN unlock", () => {
  test.use({ previewUnlocked: false });

  test("keeps the map out of reach, skip link included", async ({ page }) => {
    await page.goto("/#home");
    await unlockPreviewGate(page);
    await page.waitForFunction(() => window.__mapxStub?.ready === true);

    const map = page.locator("#app-map");
    await expect(map).toHaveClass(/is-warming/);

    // The container's own `inert` is back, and so is every child's -- the
    // site-inspector panel is the one the gate used to leave uncovered.
    await expect(map).toHaveAttribute("inert", "");
    await expect(map).toHaveAttribute("aria-hidden", "true");
    expect(
      await map
        .locator("> *")
        .evaluateAll((els) => els.filter((el) => !el.hasAttribute("inert")).map((el) => el.id)),
    ).toEqual([]);

    // The skip link is hidden, so Tab cannot reach it in the first place.
    await expect(page.locator(".mg-skip-link")).toBeHidden();

    // And even driven directly, activating it leaves focus outside the map.
    await page.locator(".mg-skip-link").evaluate((el) => {
      el.hidden = false;
      el.focus();
    });
    expect(await page.evaluate(() => document.activeElement?.className)).toContain("mg-skip-link");
    await page.keyboard.press("Enter");
    expect(
      await page.evaluate(() => document.getElementById("app-map").contains(document.activeElement)),
    ).toBe(false);

    // The next Tab still moves through the page rather than nowhere.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");

    // Tabbing from the top never lands inside the map either.
    await page.locator("body").press("Tab");
    for (let i = 0; i < 60; i++) {
      expect(
        await page.evaluate(() => document.getElementById("app-map").contains(document.activeElement)),
      ).toBe(false);
      await page.keyboard.press("Tab");
    }
  });
});
