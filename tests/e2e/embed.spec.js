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

let nextId = 0;
/** Send a command with a fresh id, and return the id. */
async function sendWithId(page, name, payload) {
  nextId += 1;
  const id = `${name}-${nextId}`;
  await hostSend(page, name, payload, { id });
  return id;
}

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

  test("gives the map the whole height the nav and attribution leave, at any frame height", async ({
    page,
  }) => {
    // `#mapx` is `height: 100%`, which only resolves if `.app-map` has a definite
    // height. With `.embed-root` at `min-height` alone it did not, so the MapX
    // iframe fell back to the browser's 150px default under a tall empty area.
    for (const height of [900, 420]) {
      await page.setViewportSize({ width: 1200, height });
      await gotoEmbed(page, "?tab=hazard");
      const { appMap, mapx } = await page.evaluate(() => ({
        appMap: document.querySelector(".app-map").getBoundingClientRect().height,
        mapx: document.querySelector("#mapx").getBoundingClientRect().height,
      }));
      expect(appMap).toBeGreaterThan(200);
      expect(Math.abs(mapx - appMap)).toBeLessThanOrEqual(1);
    }
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

/** The embed's own frame, for reading the MapX stub inside it. */
const embedFrame = (page) => page.frames().find((frame) => frame.url().includes("/embed.html"));

/** The MapX calls the embed made, by method, in order. */
const stubCalls = (target, method) =>
  target.evaluate((name) => window.__mapxStub.calls.filter((call) => call.method === name), method);

/** The host's message carrying `id`, once it arrives. */
const reply = async (page, id) => {
  await expect.poll(async () => (await hostMessages(page)).some((message) => message.id === id)).toBe(true);
  return (await hostMessages(page)).find((message) => message.id === id);
};

test.describe("embed: camera from the URL", () => {
  test("fits a country named by area once the map is ready, without MapX's own fit", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard&area=ken");
    await expect
      .poll(() => page.evaluate(() => window.__mapxStub.camera.bounds))
      .toEqual([33.9, -4.7, 41.9, 5.0]);
    expect(await stubCalls(page, "common_loc_get_bbox")).toEqual([
      { method: "common_loc_get_bbox", params: { code: "KEN" } },
    ]);
    // `common_loc_fit_bbox` with no animation never answers on real MapX.
    expect(await stubCalls(page, "common_loc_fit_bbox")).toEqual([]);
  });

  test("prefers bbox to center and area, and frames the map to it without animation", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard&layers=landslides&area=KEN&center=10,10&bbox=-20,-35,52,38");
    await expect.poll(() => page.evaluate(() => window.__mapxStub.camera.bounds)).toEqual([-20, -35, 52, 38]);
    expect(await stubCalls(page, "common_loc_get_bbox")).toEqual([]);
    expect(await stubCalls(page, "map_fly_to")).toEqual([]);
    expect(await stubCalls(page, "map_jump_to")).toHaveLength(1);
    // The URL's layers are restored before the camera moves: `ready` waits for them.
    const calls = await page.evaluate(() => window.__mapxStub.calls.map((call) => call.method));
    expect(calls.indexOf("view_add")).toBeLessThan(calls.indexOf("map_jump_to"));
  });

  test("applies a zoom without a centre after the area fit", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard&area=KEN&zoom=4");
    await expect.poll(() => page.evaluate(() => window.__mapxStub.camera.zoom)).toBe(4);
    const jumps = await stubCalls(page, "map_jump_to");
    expect(jumps).toHaveLength(2);
    expect(jumps[1].params).toEqual({ zoom: 4 });
    expect((await page.evaluate(() => window.__mapxStub.camera.center)).lng).toBeCloseTo(37.9);
  });

  test("ignores a camera parameter that does not validate, and keeps the default view", async ({ page }) => {
    await gotoEmbed(page, "?tab=hazard&bbox=10,0,-10,5&center=200,0");
    await expect(page.locator('.nav-tab-link[data-tab="hazard"]')).toHaveClass(/is-active/);
    expect(await stubCalls(page, "map_set_bounds_array")).toEqual([]);
    expect(await stubCalls(page, "map_jump_to")).toEqual([]);
  });
});

test.describe("embed: host camera control", () => {
  test("advertises what it can do in ready", async ({ page, origins }) => {
    await gotoHost(page, origins, "?tab=hazard");
    const [ready] = await named(page, "ready");
    expect(ready.payload.features).toEqual(
      expect.arrayContaining([
        "set-view",
        "fit-bounds",
        "fit-area",
        "fit-layer",
        "get-view",
        "variants",
        "queue",
      ]),
    );
  });

  test("turns on a layer, then zooms to the area it covers", async ({ page, origins }) => {
    // The issue's story step, sent as one script without waiting in between:
    // fit-layer waits for the layer set-layers is still turning on.
    const embed = await gotoHost(page, origins, "?tab=hazard");
    // Landslides is a raster (`rt`) view with no configured bounds, so its
    // extent comes from MapX's source summary. A slow `view_add` makes sure
    // fit-layer really arrives while the layer is still loading.
    await embedFrame(page).evaluate(() => {
      window.__mapxStub.delayMs = 300;
      window.__mapxStub.defaultExtent = { lng1: 60, lat1: 5, lng2: 100, lat2: 40 };
    });

    await hostSend(page, "set-layers", { layers: [{ key: "landslides" }] }, { id: "s1" });
    await hostSend(page, "fit-layer", { key: "landslides" }, { id: "s2" });

    const view = await reply(page, "s2");
    expect(view.name).toBe("view");
    expect(view.payload.bounds).toEqual([60, 5, 100, 40]);
    expect(view.payload.center).toEqual({ lng: 80, lat: 22.5 });
    await expect(layerSwitch(embedRow(embed, "Landslides"))).toBeChecked();

    const calls = await embedFrame(page).evaluate(() => window.__mapxStub.calls.map((call) => call.method));
    expect(calls.indexOf("view_add")).toBeLessThan(calls.indexOf("get_view_source_summary"));
    expect(calls.indexOf("get_view_source_summary")).toBeLessThan(calls.indexOf("map_jump_to"));
    expect(calls).not.toContain("map_set_bounds_array");
  });

  test("refuses to fit a layer that is off, or one the embed does not show", async ({ page, origins }) => {
    await gotoHost(page, origins, "?tabs=hazard&allow=landslides,river-flooding");

    expect((await reply(page, await sendWithId(page, "fit-layer", { key: "landslides" }))).payload.code).toBe(
      "layer-off",
    );
    for (const key of ["population", "no-such-layer"]) {
      expect((await reply(page, await sendWithId(page, "fit-layer", { key }))).payload.code).toBe(
        "unknown-layer",
      );
    }
    expect(await stubCalls(embedFrame(page), "map")).toEqual([]);
    // Refusing did not turn anything on behind the layer state's back.
    expect(await stubCalls(embedFrame(page), "view_add")).toEqual([]);
  });

  test("fits a raster layer whose extent MapX reports north edge first", async ({ page, origins }) => {
    await gotoHost(page, origins, "?tab=hazard&layers=landslides");
    await embedFrame(page).evaluate(() => {
      window.__mapxStub.defaultExtent = { lng1: 60, lat1: 40, lng2: 100, lat2: 5 };
    });
    const view = await reply(page, await sendWithId(page, "fit-layer", { key: "landslides", animate: true }));
    expect(view).toMatchObject({ name: "view", payload: { bounds: [60, 5, 100, 40] } });
    expect(await stubCalls(embedFrame(page), "map_fly_to")).toHaveLength(1);
  });

  test("reports no-extent for a layer MapX cannot give an extent for", async ({ page, origins }) => {
    await gotoHost(page, origins, "?tab=hazard&layers=landslides");
    await embedFrame(page).evaluate(() => {
      window.__mapxStub.defaultExtent = null;
    });
    const error = await reply(page, await sendWithId(page, "fit-layer", { key: "landslides" }));
    expect(error).toMatchObject({ name: "error", payload: { code: "no-extent" } });
  });

  test("sets and reads the view", async ({ page, origins }) => {
    await gotoHost(page, origins, "?tab=hazard");

    const moved = await reply(
      page,
      await sendWithId(page, "set-view", { center: { lng: 36.8, lat: -1.3 }, zoom: 99, animate: true }),
    );
    expect(moved.payload).toMatchObject({ center: { lng: 36.8, lat: -1.3 }, zoom: 22 });
    const [fly] = await stubCalls(embedFrame(page), "map_fly_to");
    expect(fly.params.duration).toBeLessThan(10_000);

    const read = await reply(page, await sendWithId(page, "get-view", {}));
    expect(read).toMatchObject({ name: "view", payload: { center: { lng: 36.8, lat: -1.3 }, zoom: 22 } });
    expect(read.payload.bounds).toHaveLength(4);
  });

  test("fits an area and a box, and names what it cannot do", async ({ page, origins }) => {
    await gotoHost(page, origins, "?tab=hazard");

    expect(
      (await reply(page, await sendWithId(page, "fit-area", { code: "m49_014" }))).payload.bounds,
    ).toEqual([21.0, -26.9, 51.4, 18.0]);
    // Answered as soon as MapX says it has no box, not after a timeout.
    const started = Date.now();
    expect((await reply(page, await sendWithId(page, "fit-area", { code: "XYZ" }))).payload.code).toBe(
      "unknown-area",
    );
    expect(Date.now() - started).toBeLessThan(3000);
    const animated = await reply(page, await sendWithId(page, "fit-area", { code: "KEN", animate: true }));
    expect(animated.payload.bounds).toEqual([33.9, -4.7, 41.9, 5.0]);
    await embedFrame(page).evaluate(() => {
      window.__mapxStub.maxBounds = [-30, -40, 60, 40];
    });
    expect(
      (await reply(page, await sendWithId(page, "fit-bounds", { bounds: [50, 0, 70, 10] }))).payload.code,
    ).toBe("out-of-bounds");
    await embedFrame(page).evaluate(() => {
      window.__mapxStub.maxBounds = null;
    });
    expect((await reply(page, await sendWithId(page, "fit-area", { code: "Kenya" }))).payload.code).toBe(
      "malformed",
    );
    // The view is read once the camera has landed, not mid-flight.
    expect(
      (await reply(page, await sendWithId(page, "fit-bounds", { bounds: [0, 0, 10, 10], animate: true })))
        .payload.bounds,
    ).toEqual([0, 0, 10, 10]);
    expect(
      (await reply(page, await sendWithId(page, "fit-bounds", { bounds: [10, 0, -10, 5] }))).payload.code,
    ).toBe("malformed");
  });

  test("queues a whole script sent before ready and runs it in order", async ({ page, origins }) => {
    await page.addInitScript(() => {
      window.__mapxStubHoldReady = true;
    });
    await page.goto(hostUrl(origins, "?tab=hazard", { parentOrigin: origins.host }));
    const embed = page.frameLocator("#map");
    // The embed is mounted (and listening) once its nav is drawn; the map is not ready.
    await expect(embed.locator('.nav-tab-link[data-tab="hazard"]')).toBeVisible();
    expect(await named(page, "ready")).toEqual([]);

    await hostSend(page, "set-layers", { layers: [{ key: "landslides" }] }, { id: "q1" });
    await hostSend(page, "fit-area", { code: "KEN" }, { id: "q2" });
    await hostSend(page, "get-state", {}, { id: "q3" });
    await page.waitForTimeout(200);
    // Kept, not refused and not lost.
    expect(await named(page, "error")).toEqual([]);

    await embedFrame(page).evaluate(() => window.__mapxStub.releaseReady());

    const state = await reply(page, "q3");
    const messages = (await hostMessages(page)).map((message) => `${message.name}:${message.id ?? ""}`);
    expect(messages.indexOf("ready:")).toBeLessThan(messages.indexOf("view:q2"));
    expect(messages.indexOf("view:q2")).toBeLessThan(messages.indexOf("state:q3"));
    // set-layers was dispatched first; by the time get-state ran, fit-area had
    // been awaited, so the layer had time to land.
    expect(state.payload.tab).toBe("hazard");
    await expect(layerSwitch(embedRow(embed, "Landslides"))).toBeChecked();
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
    // `locked` is the gate's answer, not a constant written by whoever posts
    // the message: while the gate is shut, no `ready` may ever claim otherwise.
    for (const message of await named(page, "ready")) expect(message.payload.locked).toBe(true);

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
    // Hold the map's `ready` until the PIN has been answered, which is what real
    // MapX does behind the gate: it cannot paint, so it makes no progress (#24).
    // The stub is local JavaScript and would otherwise be ready a tick after the
    // frame loaded — and this spec would then be reading a `ready` posted while
    // the embed was still locked, and proving nothing about the unlock at all.
    await page.addInitScript(() => {
      window.__mapxStubHoldReady = true;
    });
    const embed = await gotoHost(page, origins, "?tab=hazard");

    // Locked, so the only `ready` so far is the gate's, and it says so.
    expect((await named(page, "ready")).map((message) => message.payload.locked)).toEqual([true]);

    await unlockPreviewGate(embed);
    const frame = page.frames().find((candidate) => candidate.url().includes("/embed.html"));
    await frame.evaluate(() => window.__mapxStub.releaseReady());

    // The real `ready` follows, from the map this time, and reports an open gate.
    await expect.poll(async () => (await named(page, "ready")).at(-1)?.payload.locked).toBe(false);

    await hostSend(page, "set-tab", { tab: "exposure" });
    await expect(embed.locator('.nav-tab-link[data-tab="exposure"]')).toHaveClass(/is-active/);
  });

  test("never claims an open gate on a map that became ready while locked", async ({ page, origins }) => {
    // The stub is ready a tick after the frame loads, gate or no gate, so a
    // locked embed really does post a second `ready` here. It has to say the
    // gate is shut: the field is a claim about the gate, and a host that was
    // told otherwise would show its visitor a map behind a PIN prompt.
    const embed = await gotoHost(page, origins, "?tab=hazard");
    await expect.poll(async () => (await named(page, "ready")).length).toBe(2);

    for (const message of await named(page, "ready")) expect(message.payload.locked).toBe(true);
    await expect(embed.locator(".mg-preview-access__overlay")).toBeVisible();
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
