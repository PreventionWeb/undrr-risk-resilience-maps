/**
 * The parts of the Mangrove adoption that only a real browser with the real
 * stylesheet can answer: the accordion's hit target, the stack's closing rule,
 * and what the Sources table does on paper. All three were asserted in prose
 * before and all three were wrong or unchecked.
 */
import { expect, gotoApp, openTab, test } from "./fixtures/app.js";

/** WCAG 2.5.8 (AA) minimum, in CSS pixels. */
const MIN_TARGET = 24;
/** `.mg-accordion > details > summary { min-height: 2.75rem }` at a 16px root. */
const MANGROVE_SUMMARY = 44;

test.describe("accordion hit targets", () => {
  test("both disclosure stacks take Mangrove's summary height", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoApp(page, "#hazard");
    await openTab(page, "exposure");

    const heading = page.locator('[data-tab-panel="exposure"] .layer-group-heading:visible').first();
    const summary = page.locator('[data-tab-panel="exposure"] summary.cross-tab-summary:visible').first();

    for (const target of [heading, summary]) {
      const box = await target.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET);
      // No local `min-block-size` shrinks the summary back below the
      // component's own minimum; the type is scaled down, the row is not.
      expect(box.height).toBeGreaterThanOrEqual(MANGROVE_SUMMARY);
    }
  });

  test("the cross-tab stack still closes on a rule", async ({ page }) => {
    await gotoApp(page, "#hazard");
    // Mangrove's divider is `details:not(:last-child)`, so the last section
    // needs its own bottom border or the stack ends mid-air.
    const width = await page.evaluate(() => {
      const sections = [
        ...document.querySelectorAll(
          '[data-tab-panel="hazard"] .cross-tab-sections > details.cross-tab-section',
        ),
      ];
      return getComputedStyle(sections[sections.length - 1]).borderBottomWidth;
    });
    expect(width).toBe("1px");
  });
});

test.describe("the Sources table on paper", () => {
  test("prints whole, without the scroll cap or a pinned header", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoApp(page, "#sources");
    await page.locator(".data-table-wrap").first().waitFor();

    const measure = () =>
      page.evaluate(() => {
        const wrap = document.querySelector(".data-table-wrap");
        const table = wrap.querySelector(".data-table");
        return {
          wrap: wrap.getBoundingClientRect().height,
          table: table.getBoundingClientRect().height,
          headerPosition: getComputedStyle(wrap.querySelector("th")).position,
        };
      });

    // On screen the wrapper caps the table so `mg-table__th--sticky` has a
    // scroll container to pin to.
    const onScreen = await measure();
    expect(onScreen.table).toBeGreaterThan(onScreen.wrap);
    expect(onScreen.headerPosition).toBe("sticky");

    // On paper there is no scrolling, so the cap would simply cut the
    // citations off. It is released, and the header stops pretending to stick.
    await page.emulateMedia({ media: "print" });
    const onPaper = await measure();
    expect(onPaper.wrap).toBeCloseTo(onPaper.table, 0);
    expect(onPaper.headerPosition).toBe("static");
    await page.emulateMedia({ media: null });
  });
});

// Mangrove 2.3 no longer shrinks topbar items. All destinations must remain
// reachable on the rail, including on either side of its 900px breakpoint.
for (const width of [375, 899, 900, 901, 1280]) {
  test(`category navigation stays reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await gotoApp(page, "#hazard");
    const nav = page.locator('nav[aria-label="Map navigation"]');
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(9);
    await links.first().focus();
    for (let i = 1; i < 9; i++) await page.keyboard.press("Tab");
    await expect(links.last()).toBeFocused();

    const geometry = await nav.evaluate((outer) => {
      const rail = outer.querySelector("ul");
      const last = rail.querySelector("li:last-child a").getBoundingClientRect();
      const box = rail.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        outerOverflow: getComputedStyle(outer).overflowX,
        railOverflow: getComputedStyle(rail).overflowX,
        lastLeft: last.left,
        lastRight: last.right,
        railLeft: box.left,
        railRight: box.right,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.outerOverflow).toBe("clip");
    expect(geometry.railOverflow).toBe("auto");
    expect(geometry.lastLeft).toBeGreaterThanOrEqual(geometry.railLeft - 1);
    expect(geometry.lastRight).toBeLessThanOrEqual(geometry.railRight + 1);
    await page.keyboard.press("Enter");
    await expect(page.locator(".nav-info-link[data-panel=about]")).toHaveClass(/is-active/);
  });
}

// Mangrove 2.6 tints a hovered desktop topbar item and sets
// `text-decoration: none` on it. The current page keeps its underline anyway.
test("the current category stays underlined under Mangrove's hover style", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 812 });
  await gotoApp(page, "#hazard");
  const active = page.locator('.nav-tab-link[data-tab="hazard"]');
  await expect(active).toHaveAttribute("aria-current", "page");
  await active.hover();
  // The upstream tint applies (after its short transition), so this test also
  // fails if the hover rule changes shape and the override stops being needed.
  await expect
    .poll(() => active.evaluate((link) => getComputedStyle(link).backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)");
  expect(await active.evaluate((link) => getComputedStyle(link).textDecorationLine)).toContain("underline");
});

// 2.5 restores the browser's own select arrow in forced colours. Our smaller
// source-selector styles must leave that affordance and the control usable.
test("source selects keep their native affordance and work in forced colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await gotoApp(page, "#gar?layers=gar26-aal-crops");
  const select = page.getByRole("combobox", { name: "Crop and climate scenario" });
  await expect(select).toBeVisible();
  await expect(select).toHaveCSS("appearance", "auto");
  await expect(select).toHaveCSS("background-image", "none");
  await select.selectOption("7");
  await expect.poll(() => page.evaluate(() => window.__mapxStub.openViews)).toEqual(["MX-KU5ID-GHTH8-C2WG3"]);
  await expect(select).toHaveValue("7");
});

for (const width of [320, 390]) {
  test(`responsive sharing keeps every action inside its modal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      navigator.share = async () => {};
    });
    await gotoApp(page, "#gar?layers=gar26-aal-crops:7");
    await expect(page.getByRole("button", { name: "Share map", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Share map", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Share this map", exact: true });
    await expect(modal).toBeVisible();
    const actions = modal.locator(".mg-share__button");
    await expect(actions).toHaveCount(5);
    const bounds = await modal.boundingBox();
    for (const action of await actions.all()) {
      const box = await action.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    const copy = modal.getByRole("button", { name: "Copy map link", exact: true });
    expect(await copy.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(page.getByRole("button", { name: "Share map", exact: true })).toBeFocused();
  });
}
