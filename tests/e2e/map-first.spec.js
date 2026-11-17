import { test, expect, viewId } from "./fixtures/app.js";

const featured = viewId("aal-to-gdp-2025", 0);
async function open(page, suffix = "") {
  await page.goto(`/map-first.html${suffix}`);
  await expect(page.locator("#mf-map-status")).toHaveText("Live map");
}

test("opens a real featured map immediately without saving it or gating exploration", async ({ page }) => {
  await open(page);
  await expect(page.locator("#mf-map-kind")).toHaveText("Featured map");
  await expect(page.locator("#mf-current-variant")).toContainText("Earthquake");
  await expect(page.locator("#mf-saved-count")).toHaveText("0");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator("[data-step]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__mapxStub.openViews)).toEqual([featured]);
});

test("viewing replaces the map without saving; saving keeps a precise variant without replacing the map", async ({
  page,
}) => {
  await open(page);
  await page.locator("#mf-search").fill("GDP");
  await page.locator('[data-expand="aal-to-gdp-2025"]').click();
  await page.locator('[data-variant="aal-to-gdp-2025"]').selectOption("3");
  await page.locator('[data-view="aal-to-gdp-2025:3"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__mapxStub.openViews))
    .toEqual([viewId("aal-to-gdp-2025", 3)]);
  await expect(page.locator("#mf-saved-count")).toHaveText("0");
  await page.locator("#mf-save-current").click();
  await expect(page.locator("#mf-saved-count")).toHaveText("1");
  await page.locator('[data-variant="aal-to-gdp-2025"]').selectOption("0");
  await page.locator('[data-save="aal-to-gdp-2025:0"]').click();
  await expect(page.locator("#mf-saved-count")).toHaveText("2");
  await expect
    .poll(() => page.evaluate(() => window.__mapxStub.openViews))
    .toEqual([viewId("aal-to-gdp-2025", 3)]);
  await page.locator("#mf-saved-tab").click();
  await page.locator('[data-compare="aal-to-gdp-2025:0"]').click();
  await expect(page.locator("#right-pane")).toBeVisible();
  await expect(page.locator('[data-side="left"]')).toHaveValue("aal-to-gdp-2025:3");
  await expect(page.locator('[data-side="right"]')).toHaveValue("aal-to-gdp-2025:0");
});

test("clearing saved maps leaves the current map available and never opens onboarding", async ({ page }) => {
  await open(page);
  await page.locator("#mf-save-current").click();
  await page.locator("#mf-saved-tab").click();
  await page.locator("#mf-clear-saved").click();
  await expect(page.locator("#mf-saved-count")).toHaveText("0");
  await expect(page.locator("#mf-saved-list")).toContainText("No saved maps yet");
  await expect.poll(() => page.evaluate(() => window.__mapxStub.openViews)).toEqual([featured]);
  await expect(page.locator("#mf-current-variant")).toContainText("Earthquake");
});

test("country inspection distinguishes a zero estimate from missing data", async ({ page }) => {
  await page.addInitScript(
    ({ id }) => {
      window.__mapxStubTables = {
        [id]: [
          { maplab: "Zero country", iso3cd: "ZZZ", j0_aal_earthquake_existingclimate_togdppercent: 0 },
          { maplab: "Missing country", iso3cd: "MMM", j0_aal_earthquake_existingclimate_togdppercent: null },
        ],
      };
    },
    { id: featured },
  );
  await open(page);
  await expect(page.locator("#mf-country")).toBeEnabled();
  await page.locator("#mf-country").fill("Zero country");
  await page.locator("#mf-country-go").click();
  await expect(page.locator("#mf-inspection-title")).toHaveText("Zero country");
  await expect(page.locator(".mf-value")).toHaveText("0");
  await page.locator("#mf-country").fill("Missing country");
  await page.locator("#mf-country-go").click();
  await expect(page.locator(".mf-value")).toHaveText("No reported data");
});

test("map clicks report the displayed indicator and ignore stale views", async ({ page }) => {
  await open(page);
  await page.evaluate(
    ({ id }) =>
      window.__mapxStub.emit("click_features", {
        attributes: { [id]: [{ maplab: "Test country", iso3cd: "TST", j0_value: 0.25 }] },
        lngLat: { lat: 1, lng: 2 },
      }),
    { id: featured },
  );
  await expect(page.locator("#mf-inspection-title")).toHaveText("Test country");
  await expect(page.locator(".mf-value")).toHaveText("0.25");
  await expect(page.locator("#mf-inspection-body")).toContainText("% of GDP (2025 baseline)");
});

test("saved and displayed maps restore independently; explicit map links take precedence", async ({
  page,
}) => {
  await open(page);
  await page.locator("#mf-save-current").click();
  await page.goto("/map-first.html?map=aal-to-gdp-2025:3");
  await expect(page.locator("#mf-current-variant")).toContainText("Floods");
  await expect(page.locator("#mf-saved-count")).toHaveText("1");
  await page.locator("#mf-downloads").click();
  await expect(page.locator("#mf-download-results .download-row")).toHaveCount(2);
  await expect(page.locator("#mf-download-results")).toContainText("Saved · not on map");
});

test("uses a separate workspace store and fits a narrow screen", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("undrr-layer-workspace-preview-v1", '{"sentinel":"keep"}'),
  );
  await open(page);
  await page.locator("#mf-save-current").click();
  expect(await page.evaluate(() => localStorage.getItem("undrr-layer-workspace-preview-v1"))).toBe(
    '{"sentinel":"keep"}',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("country search does not fetch an unreviewed grid or point table", async ({ page }) => {
  await open(page, "?map=fatalities-gem:0");
  await expect(page.locator("#mf-country")).toBeDisabled();
  await expect(page.locator("#mf-country-hint")).toContainText("Click a feature or location");
  expect(
    await page.evaluate(() =>
      window.__mapxStub.calls.filter((call) => call.method === "get_view_table_attribute"),
    ),
  ).toHaveLength(0);
});
