import {
  layerRow,
  layerSwitch,
  openViews,
  previewGateAttributes,
  settled,
  toggleLayer,
  unlockPreviewGate,
} from "./fixtures/app.js";
import { expect, gotoEmbed, gotoHost, hostMessages, hostSend, hostUrl, test } from "./fixtures/embed.js";

/** A row inside the embed's frame; the app fixture's row helpers take any scope. */
const embedRow = (frame, label) =>
  frame
    .locator(".layer-item")
    .filter({ has: frame.locator(".layer-label", { hasText: new RegExp(`^${label}$`) }) });

/** The messages the host has received, by name. */
const named = async (page, name) => (await hostMessages(page)).filter((message) => message.name === name);

test.describe("embed: URL parameters", () => {
  test("opens the tab, the layers and their sources the URL asks for", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard&layers=river-flooding:1,landslides");

    const flooding = layerRow(page, "River Flooding");
    await expect(layerSwitch(flooding)).toBeChecked();
    await expect(flooding.locator('.widget-sub-tab[aria-selected="true"]')).toHaveText("Frequency");
    await expect(layerSwitch(layerRow(page, "Landslides"))).toBeChecked();
    await expect(page.locator('.nav-tab-link[data-tab="hazard"]')).toHaveClass(/is-active/);
    expect(await openViews(page)).toHaveLength(2);
  });

  test("ignores an unknown tab, an unknown layer and an out-of-range source", async ({ page }) => {
    await gotoEmbed(page, "?tab=nowhere&layers=not-a-layer,river-flooding:99");

    // Falls back to the first tab, drops the unknown key, and takes the layer's
    // first source rather than a neighbouring one it was never asked for.
    await expect(page.locator('.nav-tab-link[data-tab="risk-resilience"]')).toHaveClass(/is-active/);
    expect(await openViews(page)).toHaveLength(1);
    await expect(
      layerRow(page, "River Flooding").locator('.widget-sub-tab[aria-selected="true"]'),
    ).toHaveText("Depth");
  });

  test("shows only the tabs and layers the allowlists name", async ({ page }) => {
    await gotoEmbed(page, "?tabs=hazard,exposure&allow=landslides,river-flooding");

    await expect(page.locator(".nav-tab-link")).toHaveCount(1);
    await expect(page.locator('.nav-tab-link[data-tab="hazard"]')).toBeVisible();
    await expect(embedRow(page, "Landslides")).toBeVisible();
    await expect(embedRow(page, "Earthquake PGA")).toHaveCount(0);
  });

  test("starts the panel collapsed on request", async ({ page }) => {
    await gotoEmbed(page, "?panel=collapsed");
    await expect(page.locator(".layer-panel")).toHaveClass(/is-collapsed/);

    await gotoEmbed(page, "?panel=expanded");
    await expect(page.locator(".layer-panel")).not.toHaveClass(/is-collapsed/);
  });

  test("has no information pages, header or footer, but keeps a subtle attribution", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard");

    await expect(page.locator(".mg-page-header")).toHaveCount(0);
    await expect(page.locator("#info-page")).toHaveCount(0);
    await expect(page.locator(".nav-info-link")).toHaveCount(0);
    await expect(page.locator(".embed-attribution")).toBeVisible();
  });

  test("carries the standalone viewer's preview gate, unlocked here by the fixture", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard");

    const gate = page.locator("[data-mg-preview-access]");
    await expect(gate).toHaveAttribute("data-mg-preview-id", "grar-map-viewer");
    await expect(gate).toHaveClass(/mg-preview-access--unlocked/);
  });

  test("uses the same gate id and PIN as index.html, so the two cannot drift", () => {
    const viewer = previewGateAttributes("index.html");
    const embed = previewGateAttributes("embed.html");

    expect(embed.id).toBe(viewer.id);
    expect(embed.pin).toBe(viewer.pin);
    expect(embed.pin).toMatch(/^\d{4}$/);
  });

  test("renders an empty state, not the whole config, when an allowlist selects nothing", async ({
    page,
  }) => {
    // Finding 2's table, in a browser: each of these used to show all five tabs
    // and all 25 layers, which is the opposite of what the URL asked for.
    for (const search of ["?allow=no-such-layer", "?tabs=no-such-tab"]) {
      await gotoEmbed(page, search, { waitForMap: false });

      await expect(page.locator("[data-ui-embed-empty]")).toBeVisible();
      await expect(page.locator(".nav-tab-link")).toHaveCount(0);
      await expect(page.locator(".layer-item")).toHaveCount(0);
      await expect(page.locator("#mapx")).toHaveCount(0);
    }
  });

  test("narrows to the tabs it was given when the two allowlists do not overlap", async ({ page }) => {
    // `population` is real, but it lives in `exposure`: a plausible host mistake.
    await gotoEmbed(page, "?tabs=hazard&allow=population");

    await expect(page.locator(".nav-tab-link")).toHaveCount(1);
    await expect(page.locator('.nav-tab-link[data-tab="hazard"]')).toBeVisible();
    await expect(embedRow(page, "Population")).toHaveCount(0);
    await expect(embedRow(page, "Landslides")).toBeVisible();
  });

  test("offers a full-viewer link carrying the state on screen", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard&layers=landslides");

    const link = page.locator("[data-ui-full-viewer]");
    await expect(link).toHaveAttribute("href", /#hazard\?layers=landslides$/);

    await toggleLayer(layerRow(page, "River Flooding"));
    await expect(link).toHaveAttribute("href", /#hazard\?layers=river-flooding,landslides$/);
  });

  test("never writes to its own URL or history", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard&layers=landslides");
    const before = { url: page.url(), length: await page.evaluate(() => history.length) };

    await toggleLayer(layerRow(page, "River Flooding"));
    await expect(layerSwitch(layerRow(page, "River Flooding"))).toBeChecked();
    await page.locator('.nav-tab-link[data-tab="exposure"]').click();
    await expect(page.locator('.nav-tab-link[data-tab="exposure"]')).toHaveClass(/is-active/);

    expect(page.url()).toBe(before.url);
    expect(new URL(page.url()).hash).toBe("");
    expect(await page.evaluate(() => history.length)).toBe(before.length);
  });
});

test.describe("embed: the host message API", () => {
  test("announces itself and reports every settled change", async ({ page, origins }) => {
    const embed = await gotoHost(page, origins, "?tab=hazard");

    const [ready] = await named(page, "ready");
    expect(ready).toMatchObject({ type: "undrr-risk-map", v: 1, name: "ready" });
    expect(ready.payload.version).toBe(1);
    expect(ready.payload.tabs).toContain("hazard");
    expect(ready.payload.layers).toContain("landslides");

    await toggleLayer(embedRow(embed, "Landslides"));

    await expect
      .poll(async () => (await named(page, "state")).at(-1)?.payload)
      .toEqual({
        tab: "hazard",
        layers: [{ key: "landslides", sourceIdx: 0 }],
      });
  });

  test("echoes the instance id so a page with two embeds can tell them apart", async ({ page, origins }) => {
    await gotoHost(page, origins, "?instance=map-1");
    for (const message of await hostMessages(page)) expect(message.instance).toBe("map-1");
  });

  test("obeys set-tab, set-layers and get-state", async ({ page, origins }) => {
    const embed = await gotoHost(page, origins, "?tab=hazard");

    await hostSend(page, "set-tab", { tab: "exposure" });
    await expect(embed.locator('.nav-tab-link[data-tab="exposure"]')).toHaveClass(/is-active/);

    await hostSend(page, "set-layers", { tab: "hazard", layers: [{ key: "river-flooding", sourceIdx: 1 }] });
    await expect(layerSwitch(embedRow(embed, "River Flooding"))).toBeChecked();
    await expect(
      embedRow(embed, "River Flooding").locator('.widget-sub-tab[aria-selected="true"]'),
    ).toHaveText("Frequency");

    await hostSend(page, "get-state", {}, { id: "req-7" });
    await expect
      .poll(async () => (await hostMessages(page)).find((message) => message.id === "req-7"))
      .toMatchObject({
        name: "state",
        payload: { tab: "hazard", layers: [{ key: "river-flooding", sourceIdx: 1 }] },
      });
  });

  test("clamps and drops what a host command asks for, exactly as a URL is clamped", async ({
    page,
    origins,
  }) => {
    const embed = await gotoHost(page, origins, "?tabs=hazard");

    await hostSend(page, "set-layers", {
      layers: [{ key: "population" }, { key: "river-flooding", sourceIdx: 99 }, "junk"],
    });

    await expect(layerSwitch(embedRow(embed, "River Flooding"))).toBeChecked();
    // The switch is checked on intent; the state message reports what MapX
    // shows, so wait for the call to settle before asking for it.
    await settled(embedRow(embed, "River Flooding"));

    // `population` belongs to a tab this embed does not show, `"junk"` is not an
    // entry at all, and source 99 falls back to the layer's first source.
    await hostSend(page, "get-state", {}, { id: "after-clamp" });
    await expect
      .poll(async () => (await hostMessages(page)).find((m) => m.id === "after-clamp")?.payload.layers)
      .toEqual([{ key: "river-flooding", sourceIdx: 0 }]);
  });

  test("answers an unknown protocol version instead of guessing", async ({ page, origins }) => {
    await gotoHost(page, origins, "");

    await page.evaluate(() =>
      document
        .getElementById("map")
        .contentWindow.postMessage(
          { type: "undrr-risk-map", v: 99, name: "set-tab", payload: { tab: "hazard" } },
          window.__harness.embedOrigin,
        ),
    );

    await expect
      .poll(async () => (await named(page, "error")).at(-1)?.payload.code)
      .toBe("unsupported-version");
  });

  test("answers an unknown version once, not once per message", async ({ page, origins }) => {
    // Finding 5: 2,000 messages in version 2 produced 2,000 replies.
    await gotoHost(page, origins, "");
    const before = (await named(page, "error")).length;

    await page.evaluate(() => {
      const frame = document.getElementById("map").contentWindow;
      for (let i = 0; i < 50; i += 1) {
        frame.postMessage(
          { type: "undrr-risk-map", v: 2, name: "set-tab", payload: { tab: "hazard" } },
          window.__harness.embedOrigin,
        );
      }
    });

    await expect.poll(async () => (await named(page, "error")).length).toBe(before + 1);
    expect((await named(page, "error")).at(-1).payload.code).toBe("unsupported-version");
  });

  test("refuses a set-layers that is not a list instead of clearing the map", async ({ page, origins }) => {
    // Finding 6: `{layers: null}`, `{layers: "nope"}` and a missing key all used
    // to reconcile the map to nothing.
    const embed = await gotoHost(page, origins, "?tab=hazard&layers=landslides");
    const landslides = embedRow(embed, "Landslides");
    await expect(layerSwitch(landslides)).toBeChecked();

    for (const payload of [{ layers: null }, { layers: "nope" }, {}]) {
      await hostSend(page, "set-layers", payload);
    }

    await expect.poll(async () => (await named(page, "error")).length).toBe(3);
    for (const message of await named(page, "error")) expect(message.payload.code).toBe("malformed");
    // The layer the URL asked for is still on the map, and the embed still says so.
    await expect(layerSwitch(landslides)).toBeChecked();
    await hostSend(page, "get-state", {}, { id: "after-malformed" });
    await expect
      .poll(async () => (await hostMessages(page)).find((m) => m.id === "after-malformed")?.payload.layers)
      .toEqual([{ key: "landslides", sourceIdx: 0 }]);
  });

  test("ignores malformed traffic without breaking", async ({ page, origins }) => {
    const embed = await gotoHost(page, origins, "?tab=hazard");
    const before = (await hostMessages(page)).length;

    await page.evaluate(() => {
      const frame = document.getElementById("map").contentWindow;
      const origin = window.__harness.embedOrigin;
      for (const payload of [
        null,
        "set-tab",
        { type: "other-app", v: 1, name: "set-tab" },
        { type: "undrr-risk-map", v: 1, name: "eval", payload: { code: "1" } },
        { type: "undrr-risk-map", v: 1, name: "set-layers", payload: "everything" },
      ]) {
        frame.postMessage(payload, origin);
      }
    });

    // Still on the tab it started on, and not a word said in reply.
    await expect(embed.locator('.nav-tab-link[data-tab="hazard"]')).toHaveClass(/is-active/);
    expect((await hostMessages(page)).length).toBe(before);
  });
});

test.describe("embed: origins", () => {
  test("ignores commands from a frame that is not its parent", async ({ page, origins }) => {
    // The unrelated frame is on a third origin and posts `set-tab` to the embed
    // with `targetOrigin: "*"`, every 100 ms, through `parent.frames[0]`.
    const embed = await gotoHost(page, origins, "?tab=hazard", { unrelated: true });

    await page.waitForTimeout(500);

    await expect(embed.locator('.nav-tab-link[data-tab="hazard"]')).toHaveClass(/is-active/);
    await expect(embed.locator('.nav-tab-link[data-tab="exposure"]')).not.toHaveClass(/is-active/);
  });

  test("refuses to talk to a host whose origin is not the configured one", async ({ page, origins }) => {
    // Configured for a different parent than the page actually framing it, so
    // `ready` never arrives: the embed is simply not addressable from here.
    await page.goto(hostUrl(origins, "?tab=hazard", { parentOrigin: "http://localhost:9" }));
    const embed = page.frameLocator("#map");

    // The embed renders as usual...
    await expect(embed.locator('.nav-tab-link[data-tab="hazard"]')).toHaveClass(/is-active/);
    // ...but says nothing to this host, and takes nothing from it.
    await hostSend(page, "set-tab", { tab: "exposure" });
    await page.waitForTimeout(300);
    expect(await hostMessages(page)).toEqual([]);
    await expect(embed.locator('.nav-tab-link[data-tab="exposure"]')).not.toHaveClass(/is-active/);
  });

  test("falls back to the referrer's origin when the URL names no parent", async ({ page, origins }) => {
    await page.goto(hostUrl(origins, "?tab=hazard"));

    await expect.poll(async () => (await named(page, "ready")).length).toBe(1);
  });

  test("disables the bridge for a parentOrigin that does not parse, rather than using the referrer", async ({
    page,
    origins,
  }) => {
    // Finding 3: each of these left the bridge enabled through the referrer, so a
    // typo in the one parameter a careful host writes reverted it to loose mode.
    for (const value of ["not-a-url", "https:///", "javascript:alert(1)", "//evil.example", ""]) {
      await page.goto(hostUrl(origins, "?tab=hazard", { parentOrigin: value }));
      const embed = page.frameLocator("#map");
      // The embed itself works for the person looking at it...
      await expect(embed.locator('.nav-tab-link[data-tab="hazard"]')).toHaveClass(/is-active/);

      // ...and is not addressable from anywhere.
      await hostSend(page, "set-tab", { tab: "exposure" });
      await page.waitForTimeout(150);
      expect(await hostMessages(page), value).toEqual([]);
      await expect(embed.locator('.nav-tab-link[data-tab="exposure"]')).not.toHaveClass(/is-active/);
    }
  });

  test("leaves the host page's URL and history alone", async ({ page, origins }) => {
    const embed = await gotoHost(page, origins, "?tab=hazard");
    const before = await page.evaluate(() => ({ href: location.href, length: history.length }));

    await toggleLayer(embedRow(embed, "Landslides"));
    await expect(layerSwitch(embedRow(embed, "Landslides"))).toBeChecked();
    await embed.locator('.nav-tab-link[data-tab="exposure"]').click();
    await expect(embed.locator('.nav-tab-link[data-tab="exposure"]')).toHaveClass(/is-active/);
    await hostSend(page, "set-tab", { tab: "hazard" });
    await expect(embed.locator('.nav-tab-link[data-tab="hazard"]')).toHaveClass(/is-active/);

    expect(await page.evaluate(() => ({ href: location.href, length: history.length }))).toEqual(before);
  });
});

/**
 * The embed is published to GitHub Pages, which cannot send `frame-ancestors`,
 * so the prototype barrier has to be in the page: `embed.html` carries the same
 * Mangrove preview gate as `index.html`. These specs are about what that gate
 * has to be worth — the map unreachable behind it, and the host bridge shut.
 */
test.describe("embed: the preview gate", () => {
  test.use({ previewUnlocked: false });

  test("hides and inerts the whole embed until the PIN is entered", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard&layers=landslides", { waitForMap: false });

    const overlay = page.locator(".mg-preview-access__overlay");
    await expect(overlay).toBeVisible();
    // Not readable: Mangrove's `:has()` rule hides every child of <body>.
    await expect(page.locator(".embed-root")).toBeHidden();
    await expect(page.locator(".layer-panel")).toBeHidden();
    // Not reachable: the gate marks the embed's siblings `inert`, so nothing in
    // it is clickable or a tab stop.
    await expect(page.locator(".embed-root")).toHaveAttribute("inert", "");

    await unlockPreviewGate(page);

    await expect(page.locator(".embed-root")).toBeVisible();
    await expect(page.locator(".embed-root")).not.toHaveAttribute("inert", "");
    await expect(layerSwitch(layerRow(page, "Landslides"))).toBeChecked();
  });

  test("keeps the map from spending its ready budget behind the gate", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard", { waitForMap: false });

    // `canMapLoad()` reads exactly this: a map container whose computed
    // visibility is `hidden` cannot make progress, so the budget must not count.
    // The MapX iframe is throttled to a standstill there for the same reason.
    const container = page.locator("#app-map");
    await expect(container).toBeHidden();
    expect(await container.evaluate((el) => getComputedStyle(el).visibility)).toBe("hidden");

    await unlockPreviewGate(page);
    expect(await container.evaluate((el) => getComputedStyle(el).visibility)).toBe("visible");
  });

  test("asks again rather than looping when the browser blocks its storage", async ({ page }) => {
    // Some browsers refuse storage to a third-party frame altogether. Mangrove's
    // gate then cannot remember the unlock, so the PIN is asked once per load —
    // which has to keep working, rather than trap a visitor behind a gate whose
    // answer never takes.
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new Error("storage blocked");
        },
      });
    });

    await gotoEmbed(page, "?tab=hazard", { waitForMap: false });
    await unlockPreviewGate(page);
    await expect(page.locator(".embed-root")).toBeVisible();

    // Reload: the gate is back, and still answerable.
    await gotoEmbed(page, "?tab=hazard", { waitForMap: false });
    await expect(page.locator(".mg-preview-access__overlay")).toBeVisible();
    await unlockPreviewGate(page);
    await expect(page.locator(".embed-root")).toBeVisible();
  });

  test("tells the host it is locked, and takes no command until it is not", async ({ page, origins }) => {
    const embed = await gotoHost(page, origins, "?tab=hazard");

    // `ready` arrives, so a host can show its own message instead of an
    // apparently broken frame — and it says the embed is locked.
    const [ready] = await named(page, "ready");
    expect(ready.payload).toMatchObject({ version: 1, locked: true });
    expect(ready.payload.tabs).toContain("hazard");

    await hostSend(page, "set-tab", { tab: "exposure" });
    await hostSend(page, "set-layers", { layers: [{ key: "landslides" }] });
    await hostSend(page, "get-state", {}, { id: "locked-read" });

    await expect.poll(async () => (await named(page, "error")).length).toBe(3);
    for (const message of await named(page, "error")) expect(message.payload.code).toBe("locked");
    // Nothing was driven, and nothing was reported.
    expect(await named(page, "state")).toEqual([]);
    await expect(embed.locator('.nav-tab-link[data-tab="exposure"]')).not.toHaveClass(/is-active/);
  });

  test("answers the host once its PIN is entered inside the frame", async ({ page, origins }) => {
    const embed = await gotoHost(page, origins, "?tab=hazard");
    await unlockPreviewGate(embed);

    // The real `ready` follows, from the map this time.
    await expect.poll(async () => (await named(page, "ready")).at(-1)?.payload.locked).toBe(false);

    await hostSend(page, "set-tab", { tab: "exposure" });
    await expect(embed.locator('.nav-tab-link[data-tab="exposure"]')).toHaveClass(/is-active/);
  });

  test("the way out to the full viewer lands on a page that is gated too", async ({ page }) => {
    // Finding 8 resolves here: both ends of the link are behind the same PIN.
    // The href is built when the embed mounts, gate or no gate, so this reads it
    // without unlocking — an unlock would persist for this origin and the
    // standalone page would then let us straight in.
    await gotoEmbed(page, "?tab=hazard", { waitForMap: false });

    const href = await page.locator("[data-ui-full-viewer]").getAttribute("href");
    await page.goto(href);
    await expect(page.locator(".mg-preview-access__overlay")).toBeVisible();
  });
});

test.describe("embed: analytics", () => {
  test("records that it loaded, and the host it is framed in", async ({ page, origins }) => {
    const events = [];
    page.on("console", (message) => {
      if (message.text().startsWith("[analytics]")) events.push(message.text());
    });

    await gotoHost(page, origins, "?tab=hazard&layers=landslides");

    await expect.poll(() => events.join("\n")).toContain("embed_loaded");
    expect(events.join("\n")).toContain(origins.host);
  });
});
