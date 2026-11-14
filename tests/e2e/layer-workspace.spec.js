import { test, expect, viewId } from "./fixtures/app.js";

const card = (page, uid) => page.locator(`[data-uid="${uid}"]`);

async function openPreview(page) {
  // Tests of an existing workspace seed their own selection. New visitors get none.
  await page.addInitScript(() => {
    const key = "undrr-layer-workspace-preview-v1";
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          items: ["change-fiscal-gap:0", "change-fiscal-gap:1", "early-warning-coverage:0"].map((uid) => ({
            uid,
            opacity: 100,
            visible: true,
          })),
          mode: "single",
          selected: "change-fiscal-gap:0",
          left: "change-fiscal-gap:0",
          right: "change-fiscal-gap:1",
        }),
      );
  });
  await page.goto("/layer-workspace.html");
  await expect(page.locator("#map-status")).toHaveText("Live map");
}

test("collects two child variants independently without replacing the displayed layer", async ({ page }) => {
  await openPreview(page);
  await page.getByRole("button", { name: "Add layers", exact: true }).click();
  await page.getByRole("searchbox").fill("AAL to GDP (2025)");
  await page.locator('[data-add="aal-to-gdp-2025:0"]').click();
  await page.locator('[data-add="aal-to-gdp-2025:3"]').click();
  await expect(page.locator("#catalog-selection-count")).toHaveText("5 variants in your workspace");
  await page.locator("#catalog-done").click();
  await expect(card(page, "aal-to-gdp-2025:0")).toContainText("Earthquake");
  await expect(card(page, "aal-to-gdp-2025:3")).toContainText("Floods");
  await expect(page.locator("#left-map-label")).toContainText("Change in fiscal gap");
  await page.reload();
  await expect(page.locator("#workspace-list .layer-card")).toHaveCount(5);
});

test("reordering the stack updates MapX order and preserves each variant opacity", async ({ page }) => {
  await openPreview(page);
  await page.getByRole("radio", { name: "Overlay", exact: true }).focus();
  await page.keyboard.press("Space");
  await card(page, "early-warning-coverage:0").locator('[data-action="show"]').click();
  await card(page, "early-warning-coverage:0").locator('[data-action="up"]').click();
  await card(page, "early-warning-coverage:0").locator('[data-action="up"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__mapxStub.layerOrder))
    .toEqual([viewId("early-warning-coverage"), viewId("change-fiscal-gap", 0)]);
  await card(page, "early-warning-coverage:0").locator('[data-action="settings"]').click();
  const slider = card(page, "early-warning-coverage:0").getByRole("slider");
  await slider.fill("45");
  await slider.dispatchEvent("input");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__mapxStub.calls
            .filter(
              (c) => c.method === "set_view_layer_transparency" && c.params.idView === "MX-SL3SM-AR11B-4LQ8T",
            )
            .at(-1)?.params,
      ),
    )
    .toEqual({ idView: viewId("early-warning-coverage"), value: 55 });
  await page.reload();
  await expect(page.locator("#workspace-list .layer-card").first()).toHaveAttribute(
    "data-uid",
    "early-warning-coverage:0",
  );
  await card(page, "early-warning-coverage:0").locator('[data-action="settings"]').click();
  await expect(card(page, "early-warning-coverage:0").getByRole("slider")).toHaveValue("45");
});

test("hiding the only displayed layer survives reload and keeps download access", async ({ page }) => {
  await openPreview(page);
  await card(page, "change-fiscal-gap:0").locator('[data-action="show"]').click();
  await expect.poll(() => page.evaluate(() => window.__mapxStub.openViews)).toEqual([]);
  await page.reload();
  await expect(page.locator("#left-map-label")).toContainText("Add or show a layer");
  await page.locator("#review-downloads").click();
  await expect(page.locator("#download-results .download-row")).toHaveCount(3);
  await expect(
    page.locator("#download-results").getByText("Hidden on map · available to download"),
  ).toHaveCount(3);
  await expect(page.locator("#download-results button[data-csv]")).toHaveCount(3);
});

test("clear all gives an empty workspace and adding a variant starts a new map selection", async ({
  page,
}) => {
  await openPreview(page);
  await page.locator("#clear-workspace").click();
  await expect(page.locator("#catalog-panel")).toBeVisible();
  await page.getByRole("searchbox").fill("AAL to GDP (2025)");
  await page.locator('[data-add="aal-to-gdp-2025:0"]').click();
  await page.locator("#catalog-done").click();
  await expect(page.locator("#left-map-label")).toContainText("Earthquake");
  await expect
    .poll(() => page.evaluate(() => window.__mapxStub.openViews))
    .toEqual([viewId("aal-to-gdp-2025", 0)]);
});

test("display modes use one native radio group with arrow keys and remain next to their context", async ({
  page,
}) => {
  await openPreview(page);
  const modes = page.getByRole("group", { name: "Map display", exact: true });
  await expect(modes.getByRole("radio")).toHaveCount(3);
  const one = modes.getByRole("radio", { name: "One layer", exact: true });
  await one.focus();
  await page.keyboard.press("ArrowRight");
  await expect(modes.getByRole("radio", { name: "Overlay", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(modes.getByRole("radio", { name: "Compare", exact: true })).toBeChecked();
  await expect(page.locator("#right-pane")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector(".display-controls").getBoundingClientRect().bottom <=
          document.querySelector("#map-grid").getBoundingClientRect().top,
      ),
    )
    .toBe(true);
});

test("uses the canonical brand structure and a working skip link", async ({ page }) => {
  await openPreview(page);
  await expect(page.locator(".mg-page-header__decoration > div")).toHaveCount(4);
  await expect(page.locator(".mg-page-header__block--logo a")).toHaveAttribute(
    "href",
    "https://www.undrr.org/",
  );
  const skip = page.getByRole("link", { name: "Skip to content", exact: true });
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("new visitors choose their first layer from real-map previews without preloaded data", async ({
  page,
}) => {
  await page.goto("/layer-workspace.html");
  const dialog = page.locator("#catalog-panel");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#catalog-done")).toBeDisabled();
  await expect(page.locator("#workspace-list .layer-card")).toHaveCount(0);
  await expect(page.locator("#map-left iframe, #map-left [data-mapx-stub]")).toHaveCount(0);
  await expect(page.locator(".featured-layer")).toHaveCount(3);
  await expect
    .poll(() =>
      page
        .locator(".featured-layer img")
        .evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)),
    )
    .toBe(true);
  await dialog.getByRole("button", { name: "Add layer: Early warning coverage", exact: true }).click();
  await expect(page.locator("#catalog-done")).toHaveText("Explore map (1)");
  await expect(dialog).toBeVisible();
  await page.locator("#catalog-done").click();
  await expect(page.locator("#map-status")).toHaveText("Live map");
  await expect
    .poll(() => page.evaluate(() => window.__mapxStub.openViews))
    .toEqual([viewId("early-warning-coverage")]);
  await page.reload();
  await expect(page.locator("#catalog-panel")).not.toBeVisible();
  await expect(page.locator("#workspace-list .layer-card")).toHaveCount(1);
});

test("start preview leaves an existing saved workspace intact", async ({ page }) => {
  await openPreview(page);
  const saved = await page.evaluate(() => localStorage.getItem("undrr-layer-workspace-preview-v1"));
  await page.goto("/layer-workspace.html?start=1");
  await expect(page.getByRole("heading", { name: "Choose your first layer", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add layer: Earthquake losses", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("undrr-layer-workspace-preview-v1"))).toBe(saved);
  await page.goto("/layer-workspace.html");
  await expect(page.locator("#catalog-panel")).not.toBeVisible();
  await expect(page.locator("#workspace-list .layer-card")).toHaveCount(3);
});

test("Escape cannot dismiss the chooser or reveal an unfinished workspace", async ({ page }) => {
  await page.goto("/layer-workspace.html?start=1");
  await page.keyboard.press("Escape");
  await expect(page.locator("#catalog-panel")).toBeVisible();
  await expect(page.locator(".workspace-stage")).toBeHidden();
  await expect(page.locator("[data-step=choose]")).toHaveAttribute("aria-current", "step");
  await expect(page.locator("[data-step=explore]")).toBeDisabled();
  await page.getByRole("button", { name: "Add layer: Early warning coverage", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#catalog-panel")).toBeVisible();
  await expect(page.locator("#map-left [data-mapx-stub]")).toHaveCount(0);
  await page.locator("#catalog-done").click();
  await expect(page.locator(".workspace-stage")).toBeVisible();
  await expect(page.locator("[data-step=explore]")).toHaveAttribute("aria-current", "step");
  await page.locator("[data-step=choose]").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#catalog-panel")).toBeVisible();
  await expect(page.locator("#catalog-selection-count")).toHaveText("1 variant in your workspace");
  await page.locator("[data-step=explore]").click();
  await expect(page.locator(".workspace-stage")).toBeVisible();
});

test("a draft selection restores in the chooser until explicitly continued", async ({ page }) => {
  await page.goto("/layer-workspace.html");
  await page.getByRole("button", { name: "Add layer: Earthquake losses", exact: true }).click();
  await page.reload();
  await expect(page.locator("#catalog-panel")).toBeVisible();
  await expect(page.locator("#catalog-selection-count")).toHaveText("1 variant in your workspace");
  await expect(page.locator(".workspace-stage")).toBeHidden();
  await page.locator("#catalog-done").click();
  await page.reload();
  await expect(page.locator("#catalog-panel")).toBeHidden();
  await expect(page.locator(".workspace-stage")).toBeVisible();
});
