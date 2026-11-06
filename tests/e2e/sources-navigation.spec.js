import { expect, gotoApp, openTab, test } from "./fixtures/app.js";

for (const enhanced of [true, false]) {
  test(`Sources category navigation preserves reload and history (CDN ${enhanced ? "loaded" : "blocked"})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (!enhanced) await page.route("**/js/on-this-page-nav.js", (route) => route.abort());
    await gotoApp(page, "#sources?layers=landslides");
    const nav = page.getByRole("navigation", { name: "Sources categories" });
    if (enhanced) await expect(nav).toHaveAttribute("data-mg-on-this-page-nav-initialized", "true");
    const historyLength = await page.evaluate(() => history.length);
    await nav.getByRole("link", { name: "Hazard", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#sources-hazard")).toBeFocused();
    await expect(page).toHaveURL(/#sources\?layers=landslides$/);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    const top = await page.locator("#sources-hazard").evaluate((el) => el.getBoundingClientRect().top);
    const navBox = await nav.boundingBox();
    expect(top).toBeGreaterThanOrEqual(navBox.height - 1);
    expect(top).toBeLessThan(navBox.height + 5);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#sources\?layers=landslides$/);
    await openTab(page, "hazard");
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#sources\?layers=landslides$/);
  });
}

test("mobile Sources stays within the viewport and toggles planned metrics", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoApp(page, "#sources");
  const planned = page.locator(".sources-planned").first();
  await expect(planned).toBeHidden();
  await page.getByText("Show metrics under development", { exact: true }).click();
  await expect(planned).toBeVisible();
  await page.getByText("Show metrics under development", { exact: true }).click();
  await expect(planned).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

for (const downloads of [false, true]) {
  test(`dataset names open the exact map variant (downloads ${downloads})`, async ({ page }) => {
    await page.goto(`/${downloads ? "?downloads=1" : "?downloads=0"}#sources`);
    await page.waitForFunction(() => window.__mapxStub?.ready === true);
    const sources = page.locator('[data-tab-panel="sources"]');
    await expect(sources.locator(".layer-downloads, [data-action='download-csv']")).toHaveCount(0);
    const name = "Rice AAL (%) – Warming level +2°C";
    await sources.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/#gar\?layers=gar26-aal-crops:7$/);
    await expect
      .poll(() => page.evaluate(() => window.__mapxStub.openViews))
      .toContain("MX-KU5ID-GHTH8-C2WG3");
    await expect(page.locator('[data-tab-panel="gar"]')).toBeVisible();
    await page.goBack();
    await expect(sources).toBeVisible();
  });
}

test("a copied category link opens Sources at that section", async ({ page }) => {
  await gotoApp(page, "#sources");
  const nav = page.getByRole("navigation", { name: "Sources categories" });
  const href = await nav.getByRole("link", { name: "Hazard", exact: true }).getAttribute("href");
  await gotoApp(page, href);
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  const section = page.locator("#sources-hazard");
  await expect(section).toBeFocused();
  await expect.poll(() => section.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(100);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  await expect(section).toBeFocused();
});
