import { expect, openTab, test } from "./fixtures/app.js";

// Hold readiness, not the network: every service remains stubbed. These tests
// verify how a long wait is presented, not the real MapX service's speed.
for (const mode of [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
  { name: "reduced motion", reducedMotion: "reduce" },
  { name: "forced colours", forcedColors: "active" },
  { name: "reduced motion and forced colours", reducedMotion: "reduce", forcedColors: "active" },
  { name: "RTL", rtl: true },
  {
    name: "mobile RTL reduced motion and forced colours",
    viewport: { width: 390, height: 844 },
    rtl: true,
    reducedMotion: "reduce",
    forcedColors: "active",
  },
]) {
  test(`startup feedback: ${mode.name}`, async ({ page }, testInfo) => {
    if (mode.viewport) await page.setViewportSize(mode.viewport);
    await page.emulateMedia({
      reducedMotion: mode.reducedMotion ?? "no-preference",
      forcedColors: mode.forcedColors ?? "none",
    });
    await page.addInitScript(() => {
      window.__mapxStubHoldReady = true;
    });
    await page.goto("/#hazard");
    if (mode.rtl)
      await page.locator("html").evaluate((el) => {
        el.dir = "rtl";
      });
    const feedback = page.locator(".map-loading:visible");
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText("Loading map…");
    await expect(page.locator('[data-ui="mapx"]')).toHaveAttribute("aria-busy", "true");
    // No full-map wash or hidden frame: MapX must keep painting to start up.
    await expect(page.locator('[data-ui="mapx"]')).toHaveCSS("opacity", "1");
    if (!mode.viewport || mode.viewport.width > 720) {
      await expect(feedback).toHaveCSS("pointer-events", "none");
    } else {
      // A CSS-visible card could still be underneath the panel. Its message
      // must actually be what a user can see at the centre of its rectangle.
      expect(
        await feedback.locator(".map-loading__message").evaluate((el) => {
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return el.contains(hit);
        }),
      ).toBe(true);
      const header = await page.locator(".layer-panel-header").boundingBox();
      const statusBox = await feedback.boundingBox();
      expect(statusBox.y).toBeGreaterThanOrEqual(header.y + header.height);
    }
    const bounds = await feedback.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    if (mode.reducedMotion) {
      await expect(feedback.locator(".mg-loader")).toHaveCSS("animation-name", "none");
      await expect(feedback.locator(".mg-loader")).toHaveCSS("border-top-style", "dashed");
    }
    if (mode.forcedColors)
      await expect(feedback).toHaveCSS(
        mode.viewport?.width <= 720 ? "border-bottom-style" : "border-top-style",
        "solid",
      );
    await page.screenshot({ path: testInfo.outputPath("loading.png") });
    if (mode.name === "desktop") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(feedback.locator(".mg-loader")).toHaveCSS("animation-name", "none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(feedback.locator(".mg-loader")).not.toHaveCSS("animation-name", "none");
    }
    // No focus trap: the panel can still be collapsed during startup.
    const collapse = page.locator('[data-ui="panel-toggle"]');
    await collapse.focus();
    await page.keyboard.press("Enter");
    await expect(collapse).toHaveAttribute("aria-expanded", "false");
    await page.waitForFunction(() => window.__mapxStub?.listening("ready"));
    await page.evaluate(() => window.__mapxStub.releaseReady());
    await expect(feedback).toHaveCount(0);
    await expect(page.locator('[data-ui="mapx"]')).not.toHaveAttribute("aria-busy");
    await expect(page.locator("#map-service-notice")).toBeHidden();
  });
}

test("startup failure replaces loading feedback, and a late ready recovers", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__mapxStubHoldReady = true;
  });
  await page.goto("/#hazard");
  await page.waitForFunction(() => window.__mapxStub?.listening("ready"));
  await page.clock.fastForward(31_000);
  await expect(page.locator("#map-service-notice")).toBeVisible();
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await expect(page.locator('[data-ui="mapx"]')).not.toHaveAttribute("aria-busy");
  await page.evaluate(() => window.__mapxStub.releaseReady());
  await expect(page.locator("#map-service-notice")).toBeHidden();
});

test("an information page hides pending map feedback until the map is opened", async ({ page }) => {
  await page.addInitScript(() => {
    window.__mapxStubHoldReady = true;
  });
  await page.goto("/#home");
  await expect(page.locator("#info-page")).toBeVisible();
  await expect(page.locator("#app-map")).toHaveAttribute("aria-hidden", "true");
  await openTab(page, "hazard");
  await expect(page.locator(".map-loading:visible")).toBeVisible();
  await page.waitForFunction(() => window.__mapxStub?.listening("ready"));
  await page.evaluate(() => window.__mapxStub.releaseReady());
  await expect(page.locator(".map-loading")).toHaveCount(0);
});

test("embedded maps show the same startup feedback", async ({ page }) => {
  await page.addInitScript(() => {
    window.__mapxStubHoldReady = true;
  });
  await page.goto("/embed.html?tab=hazard");
  await expect(page.locator(".map-loading:visible")).toBeVisible();
  await page.waitForFunction(() => window.__mapxStub?.listening("ready"));
  await page.evaluate(() => window.__mapxStub.releaseReady());
  await expect(page.locator(".map-loading")).toHaveCount(0);
});
