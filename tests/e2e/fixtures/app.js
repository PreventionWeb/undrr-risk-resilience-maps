/**
 * The one fixture every E2E spec imports. It gives each test a page where
 *
 *   - MapX is the stub in `mapx-stub.js` (served from the real SDK URL) and no
 *     request can reach MapX, GeoServer, the MapX mirror or Copernicus/EDRA;
 *   - the Mangrove preview PIN gate is already unlocked, so no spec has to
 *     fight it (it persists the unlock in sessionStorage — see below), unless
 *     the spec says `test.use({ previewUnlocked: false })` and answers it with
 *     `unlockPreviewGate()`. `embed.html` carries the same gate, with the same
 *     id, so the seeding covers the embed and an embed inside a host page too;
 *   - the PreventionWeb footer widget is a no-op, because `index.html` calls
 *     `PW_Widget.initialize` from an inline script.
 *
 * Mangrove's stylesheet and `preview-access.js` are the app's own design system
 * and are still loaded from assets.undrr.org: without them the page is not the
 * page. Everything behavioural is local.
 *
 * Helpers here are selectors and waits only. They assert nothing; specs do.
 */
import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { TABS } from "../../../src/config/layers.js";

const MAPX_SDK_URL = "https://app.mapx.org/sdk/mxsdk.umd.js";
const MAPX_STUB = readFileSync(new URL("./mapx-stub.js", import.meta.url), "utf8");

/**
 * The preview gate keys its unlock by `data-mg-preview-id`, as
 * `mg-preview-access:<id>` in sessionStorage. Seeding it means the overlay is
 * never built, so nothing steals focus or covers the map. (The gate's CSS
 * hides the page until the gate is marked unlocked, so the init script also
 * marks it directly — if assets.undrr.org ever fails to serve the script, the
 * suite still sees the app rather than a blank page.)
 */
const PREVIEW_UNLOCK_KEY = "mg-preview-access:grar-map-viewer";

/** A page's gate attributes, read from its markup so a spec cannot hold a stale copy. */
export function previewGateAttributes(file) {
  const html = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
  const gate = html.match(/<div\s+data-mg-preview-access[\s\S]*?><\/div>/)?.[0] ?? "";
  return Object.fromEntries(
    [...gate.matchAll(/data-mg-preview-([a-z-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
  );
}

/** The gate's PIN, read from the markup so a change to it cannot strand a spec. */
export const PREVIEW_PIN = previewGateAttributes("index.html").pin;

/** Requests a test must never make. */
const BLOCKED = [
  "https://app.mapx.org/**",
  "https://api.mapx.org/**",
  "https://*.unepgrid.ch/**",
  "https://*.copernicus.eu/**",
];

export const test = base.extend({
  /**
   * Is the preview gate already unlocked when the page loads?
   *
   * Every spec but one wants `true`. A spec about what the gate does *to* the
   * page when the PIN is accepted -- it removes `inert` from every direct child
   * of `<body>`, `#app-map` included -- has to answer it for real, and says
   * `test.use({ previewUnlocked: false })`.
   */
  previewUnlocked: [true, { option: true }],

  page: async ({ page, previewUnlocked }, use) => {
    if (previewUnlocked) {
      await page.addInitScript(
        ({ key }) => {
          try {
            sessionStorage.setItem(key, "unlocked");
          } catch {
            // Private mode etc. The class below is then the only unlock.
          }
          document.addEventListener("DOMContentLoaded", () => {
            document.querySelector("[data-mg-preview-access]")?.classList.add("mg-preview-access--unlocked");
          });
        },
        { key: PREVIEW_UNLOCK_KEY },
      );
    }

    // Later routes win, so the blanket denies go first and the SDK stub last.
    for (const pattern of BLOCKED) await page.route(pattern, (route) => route.abort());

    await page.route("https://publish.preventionweb.net/widget.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.PW_Widget = { initialize: function () {} };",
      }),
    );

    await page.route(MAPX_SDK_URL, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        // `loadMapXSdk()` requests the script with crossOrigin="anonymous",
        // so the response has to pass the CORS check.
        headers: { "access-control-allow-origin": "*" },
        body: MAPX_STUB,
      }),
    );

    await use(page);
  },
});

export { expect };

/**
 * Open the app at `hash` and wait until layer changes are accepted: the stub
 * has emitted `ready` and, for a shared link, `restoreFromUrl()` has finished.
 * @param {import("@playwright/test").Page} page
 * @param {string} hash - e.g. `"#hazard?layers=landslides"`; `""` for the home page
 */
export async function gotoApp(page, hash = "") {
  await page.goto(`/${hash}`);
  await page.waitForFunction(() => window.__mapxStub?.ready === true);
  return page;
}

/**
 * Answer the preview gate the way a user does, for a spec that runs with
 * `previewUnlocked: false`. Resolves once the overlay is gone, which is the
 * point at which the gate has removed `inert` from every child of `<body>`.
 *
 * `scope` is a page or a frame: `embed.html` carries the same gate, and a host
 * page's visitor answers it *inside* the iframe (see the embed suite).
 *
 * @param {import("@playwright/test").Page|import("@playwright/test").FrameLocator} scope
 */
export async function unlockPreviewGate(scope) {
  const overlay = scope.locator(".mg-preview-access__overlay");
  await overlay.locator("#mg-preview-access-pin").fill(PREVIEW_PIN);
  await overlay.locator(".mg-preview-access__submit").click();
  await overlay.waitFor({ state: "detached" });
}

/** The view ids MapX currently holds, as the stub saw them. */
export function openViews(page) {
  return page.evaluate(() => [...window.__mapxStub.openViews]);
}

/**
 * Make MapX take `ms` to answer `view_add`/`view_remove`, so a spec about a
 * race can be sure the next action lands while the call is still in flight.
 */
export function setMapxLatency(page, ms) {
  return page.evaluate((value) => {
    window.__mapxStub.delayMs = value;
  }, ms);
}

/** Switch to a data tab the way a user does: the nav link. */
export async function openTab(page, tabId) {
  await page.locator(`.nav-tab-link[data-tab="${tabId}"]`).click();
}

const exact = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/**
 * A layer's full row in its own tab (label, source widget, slider, legend).
 * Scoped to `.layer-label` so a source button that happens to carry the same
 * text (e.g. "Landslides" under AAL to GDP) cannot match.
 */
export function layerRow(page, label) {
  return page.locator(".layer-item").filter({ has: page.locator(".layer-label", { hasText: exact(label) }) });
}

/**
 * One data tab's panel. Every tab panel carries a cross-tab section per other
 * tab, so a cross-tab lookup has to say which panel it means.
 */
export function tabPanel(page, tabId) {
  return page.locator(`[data-tab-panel="${tabId}"]`);
}

/** A cross-tab section (`sectionLabel`'s layers) inside `tabId`'s panel. */
export function crossTabSection(page, tabId, sectionLabel) {
  return tabPanel(page, tabId)
    .locator("details.cross-tab-section")
    .filter({ has: page.locator("summary.cross-tab-summary", { hasText: exact(sectionLabel) }) });
}

/** A layer's compact row inside another tab's cross-tab section. */
export function crossTabRow(page, tabId, sectionLabel, label) {
  return crossTabSection(page, tabId, sectionLabel)
    .locator(".cross-tab-item")
    .filter({ has: page.locator(".cross-tab-label", { hasText: exact(label) }) });
}

/** A row's on/off switch. Mangrove hides the input, so the label is the hit target. */
export function layerSwitch(row) {
  return row.locator("input.layer-eye");
}

/** Toggle a row's layer the way a user does: click the switch. */
export async function toggleLayer(row) {
  await row.locator("label.layer-switch").click();
}

/**
 * Wait until a row has no MapX call in flight. The switch is `aria-busy` from
 * the moment it is clicked until the last call for that layer settles, and the
 * URL is written in the same synchronous store update as the switch, so this is
 * the point at which counting history entries gives a final answer. Polling a
 * count instead would pass on a value the app only passes through.
 */
export async function settled(row) {
  await expect(layerSwitch(row)).toHaveAttribute("aria-busy", "false");
}

/**
 * A layer's MapX view id, read from the app's own config rather than pasted
 * into a spec, so renaming or re-ordering a source cannot leave a stale id
 * asserted here.
 * @param {string} key - layer key
 * @param {number} [sourceIdx]
 */
export function viewId(key, sourceIdx = 0) {
  const layer = TABS.flatMap((tab) =>
    tab.groups ? tab.groups.flatMap((group) => group.layers) : tab.layers,
  ).find((candidate) => candidate.key === key);
  if (!layer) throw new Error(`viewId: no layer config for "${key}"`);
  return layer.sources ? layer.sources[sourceIdx].id : layer.id;
}

/** Open a collapsed cross-tab section in `tabId`'s panel. */
export async function openCrossTabSection(page, tabId, sectionLabel) {
  const section = crossTabSection(page, tabId, sectionLabel);
  await section.locator("summary.cross-tab-summary").click();
  return section;
}
