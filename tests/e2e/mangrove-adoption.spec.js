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
