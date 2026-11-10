import { expect, gotoApp, layerRow, openViews, settled, test } from "./fixtures/app.js";

const MAP = "#hazard?layers=river-flooding:1,earthquake-pga:2,landslides";

async function settleMap(page) {
  await settled(layerRow(page, "River Flooding"));
  await settled(layerRow(page, "Earthquake PGA"));
  await settled(layerRow(page, "Landslides"));
}

test("map Share opens the shared modal with resources and the complete map link", async ({ page }) => {
  await page.addInitScript(() => {
    window.copiedMapLinks = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => window.copiedMapLinks.push(text),
      },
    });
  });
  await gotoApp(page, MAP);
  await settleMap(page);
  const views = await openViews(page);
  const trigger = page.getByRole("button", { name: "Share map", exact: true });
  await trigger.click();
  const modal = page.getByRole("dialog", { name: "Share this map", exact: true });
  await expect(modal).toBeVisible();
  await expect(modal.locator(".mg-share")).toBeVisible();
  await expect(modal.locator("details")).toHaveCount(3);
  const url = page.url();
  const linkedIn = new URL(await modal.getByRole("link", { name: "Share on LinkedIn" }).getAttribute("href"));
  expect(linkedIn.searchParams.get("url")).toBe(url);
  await modal.getByRole("button", { name: "Copy map link", exact: true }).click();
  await expect(modal.getByRole("status")).toHaveText("Map link copied.");
  expect(await page.evaluate(() => window.copiedMapLinks)).toEqual([url]);
  const flood = modal
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "River Flooding" }) });
  await flood.locator("summary").click();
  await expect(flood.getByRole("heading", { name: "Citation", exact: true })).toBeVisible();
  await expect(flood.getByRole("link", { name: "Learn more about this metric" })).toBeVisible();
  await modal.getByRole("button", { name: "Back to map" }).click();
  await expect(trigger).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await openViews(page)).toEqual(views);
  await layerRow(page, "Landslides")
    .getByRole("button", { name: "Citation, methodology and downloads", exact: true })
    .click();
  const metric = page.getByRole("dialog", { name: /^Resources: Landslides/ });
  await expect(metric.locator(".mg-share")).toBeVisible();
  expect(await metric.getByRole("link", { name: "Share on LinkedIn" }).getAttribute("href")).toBe(
    linkedIn.href,
  );
  await expect(page.locator(".metric-resources-dialog")).toHaveCount(1);
});

test("embedded sharing links the standalone map, preserves scenarios and download opt-outs", async ({
  page,
}) => {
  await page.goto("/embed.html?downloads=0&tab=hazard&layers=river-flooding:1,earthquake-pga:2,landslides");
  await page.waitForFunction(() => window.__mapxStub?.ready);
  await settleMap(page);
  await page.getByRole("button", { name: "Share map", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Share this map", exact: true });
  const link = new URL(await modal.getByRole("link", { name: "Share on LinkedIn" }).getAttribute("href"));
  const shared = new URL(link.searchParams.get("url"));
  expect(shared.pathname).toBe("/");
  expect(shared.search).toBe("?downloads=0");
  expect(shared.hash).toBe(MAP);
  await expect(modal.locator(".layer-downloads")).toHaveCount(0);
});

test("failed copying offers a selectable map URL and can still return to the map", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await gotoApp(page, "#hazard");
  await page.getByRole("button", { name: "Share map", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Share this map", exact: true });
  await modal.getByRole("button", { name: "Copy map link", exact: true }).click();
  await expect(modal.getByRole("status")).toContainText("Could not copy");
  const fallback = modal.getByRole("textbox", { name: "Map link for manual copying" });
  await expect(fallback).toBeVisible();
  await expect(fallback).toBeFocused();
  await expect(fallback).toHaveValue(page.url());
  expect(await fallback.evaluate((input) => input.selectionEnd - input.selectionStart)).toBe(
    page.url().length,
  );
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(page.getByRole("button", { name: "Share map", exact: true })).toBeFocused();
});
