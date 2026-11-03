import { expect, gotoApp, layerRow, settled, test } from "./fixtures/app.js";

for (const profile of ["standalone", "embed"]) {
  for (const enabled of [false, true]) {
    test(`${profile}: click inspection is ${enabled ? "explicitly enabled" : "off by default"}`, async ({
      page,
    }) => {
      const query = enabled ? "inspect=1&" : "";
      if (profile === "embed") {
        await page.goto(`/embed.html?${query}tab=hazard&layers=landslides`);
        await page.waitForFunction(() => window.__mapxStub?.ready);
      } else {
        await gotoApp(page, `${enabled ? "?inspect=1" : ""}#hazard?layers=landslides`);
      }
      await settled(layerRow(page, "Landslides"));
      const toggle = page.locator('[data-ui="inspect-toggle"]');
      if (enabled) await expect(toggle).toBeVisible();
      else {
        await expect(toggle).toBeHidden();
        await expect(toggle).toBeDisabled();
        // Guard against Mangrove's display rules overriding the hidden attribute.
        await expect(toggle).toHaveCSS("display", "none");
        const calls = await page.evaluate(() => window.__mapxStub.calls);
        expect(calls).toContainEqual(
          expect.objectContaining({ method: "set_features_click_sdk_only", params: { enable: true } }),
        );
      }
      await page.evaluate(() =>
        window.__mapxStub.emit("click_features", {
          attributes: { "MX-SITE": [{ name: "Test site" }] },
          lngLat: { lng: 1, lat: 2 },
        }),
      );
      if (enabled) {
        await expect(page.locator("#infobox")).toBeVisible();
        await toggle.click();
        await page.evaluate(() =>
          window.__mapxStub.emit("click_features", {
            attributes: {},
            lngLat: { lng: 1, lat: 2 },
          }),
        );
        await expect(page.locator("#site-inspector")).toBeVisible();
      } else {
        await expect(page.locator("#infobox")).toBeHidden();
        await expect(page.locator("#site-inspector")).toBeHidden();
      }
    });
  }
}
