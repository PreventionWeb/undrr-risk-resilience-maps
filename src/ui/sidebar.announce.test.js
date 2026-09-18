import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle, waitFor } from "../../tests/support/async.js";

// One announcement per layer event, however many rows the layer has.
//
// "Population" sits in Exposure, so a sidebar over these three tabs gives it
// three placements: the full row in its own tab and a compact cross-tab row in
// each of the other two panels. Every write to the instance's live region is
// recorded, so "announced once" is asserted as one write, not as final text.

const mocks = vi.hoisted(() => ({
  viewAdd: vi.fn(),
  viewRemove: vi.fn(),
}));
/** Every write to the live region, in order (see the announcer.js mock below). */
const written = vi.hoisted(() => []);

vi.mock("../config/layers.js", () => ({
  TABS: [
    {
      id: "exposure",
      label: "Exposure",
      description: "Exposure layers",
      layers: [{ key: "pop", id: "MX-POP", label: "Population", type: "vt", desc: "Pop." }],
    },
    {
      id: "hazard",
      label: "Hazard",
      description: "Hazard layers",
      layers: [{ key: "quake", id: "MX-QUAKE", label: "Earthquake", type: "rt", desc: "Quake." }],
    },
    {
      id: "risk",
      label: "Risk",
      description: "Risk layers",
      layers: [{ key: "aal", id: "MX-AAL", label: "Average Annual Loss", type: "rt", desc: "AAL." }],
    },
  ],
}));
vi.mock("../sdk/views.js", () => ({ viewAdd: mocks.viewAdd, viewRemove: mocks.viewRemove }));
vi.mock("../sdk/client.js", () => ({ isSDKReady: () => true, onSDKReadyChange: () => () => {} }));
vi.mock("./layer-controls.js", () => ({ addOpacitySlider: vi.fn(), addLegend: vi.fn() }));
vi.mock("./home.js", () => ({ buildHomePanel: () => document.createElement("div") }));
vi.mock("./info-panels.js", () => ({
  buildSourcesPanel: () => document.createElement("div"),
  buildAboutPanel: () => document.createElement("div"),
}));
vi.mock("./global-footer.js", () => ({ setGlobalFooterVisible: vi.fn() }));
vi.mock("./mangrove-tabs.js", () => ({ initMangroveTabs: vi.fn() }));
vi.mock("../utils/panels.js", () => ({
  makeDraggable: vi.fn(),
  makeResizable: vi.fn(),
  onPanelCollapse: vi.fn(),
  onPanelExpand: vi.fn(),
}));
vi.mock("../external/index.js", () => ({
  isExternalLayer: () => false,
  openExternalLayer: vi.fn(),
  closeExternalLayer: vi.fn(),
  replaceExternalLayer: vi.fn(),
  getExternalLayerDefinition: () => ({}),
  getExternalLayerRuntime: () => null,
}));
// The real announcer, with every write it makes recorded.
vi.mock("./announcer.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    createLayerAnnouncer: (doc) => {
      const real = actual.createLayerAnnouncer(doc);
      return {
        ...real,
        announce(key, message, record) {
          const wrote = real.announce(key, message, record);
          if (wrote) written.push({ key, message });
          return wrote;
        },
      };
    },
  };
});

import { createSidebar } from "./sidebar.js";
import * as store from "../state/store.js";

const SHELL = `
  <div id="sidebar" data-ui="layer-panel">
    <div class="layer-panel-header"></div>
    <div id="panel-body" data-ui="panel-body"></div>
  </div>
  <button id="panel-toggle" data-ui="panel-toggle"></button>
  <button id="layer-clear-btn" data-ui="clear-layers" hidden></button>
  <div id="app-map" data-ui="app-map"></div>
  <div id="info-page" data-ui="info-page"></div>`;

let sidebar = null;

/**
 * URL state kept in memory: these tests are about the live region, and a real
 * hash would add history writes and a reconcile of its own.
 */
function memoryAdapter() {
  let state = { tab: null, layers: [] };
  return {
    read: () => state,
    write: (next) => {
      state = { tab: next.tab, layers: next.layers };
    },
    subscribe: () => () => {},
    destroy: () => {},
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Population's full row, in its own tab's panel. */
const homeRow = () =>
  [...document.querySelectorAll('[data-tab-panel="exposure"] .layer-item')].find(
    (item) => item.querySelector(".layer-label").textContent === "Population",
  );

/** Population's compact rows, in the other tabs' cross-tab sections. */
const crossRows = () =>
  ["hazard", "risk"].map((tabId) =>
    [...document.querySelectorAll(`[data-tab-panel="${tabId}"] .cross-tab-item`)].find(
      (item) => item.querySelector(".cross-tab-label").textContent === "Population",
    ),
  );

/** Every switch for Population, across its three placements. */
const allSwitches = () => [homeRow(), ...crossRows()].map((row) => row.querySelector(".layer-eye"));

/** Messages written to the live region for a layer, in order. */
const messagesFor = (key) => written.filter((entry) => entry.key === key).map((entry) => entry.message);

describe("layer announcements", () => {
  beforeEach(() => {
    // replaceState, not `location.hash = ""`: assigning the hash makes jsdom
    // queue a `hashchange` task that can land inside a later test.
    history.replaceState(null, "", "#");
    document.body.innerHTML = SHELL;
    store.openViews.clear();
    written.length = 0;
    mocks.viewAdd.mockReset().mockResolvedValue(undefined);
    mocks.viewRemove.mockReset().mockResolvedValue(undefined);
    sidebar?.destroy();
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    sidebar.showTab("exposure");
  });

  // Teardown belongs to the test that started the work: destroy the instance
  // and let its in-flight SDK replies settle here, not inside the next test.
  afterEach(async () => {
    sidebar?.destroy();
    sidebar = null;
    await settle(() => [store.openViews.size, written.length]);
  });

  it("gives the instance one live region and the rows none", () => {
    expect(document.querySelectorAll(".layer-announcer")).toHaveLength(1);
    const region = document.querySelector(".layer-announcer");
    expect(region.parentElement).toBe(document.body);
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.classList.contains("mg-u-sr-only")).toBe(true);
    expect(region.id).toBe("");
    expect(allSwitches()).toHaveLength(3);
    for (const row of [homeRow(), ...crossRows()]) {
      expect(row.querySelector(".layer-announcer")).toBeNull();
    }
  });

  it("announces a slow load once, not once per placement", async () => {
    const slow = deferred();
    mocks.viewAdd.mockReturnValueOnce(slow.promise);

    homeRow().querySelector(".layer-eye").click();

    // All three rows rendered the busy record; one of them announced it.
    expect(allSwitches().every((input) => input.getAttribute("aria-busy") === "true")).toBe(true);
    expect(messagesFor("pop")).toEqual(["Loading Population…"]);

    slow.resolve();
    await waitFor(() => expect(sidebar.store.get("pop").applied).toBe(true));

    // The call settled: the busy sentence is dropped exactly once.
    expect(messagesFor("pop")).toEqual(["Loading Population…", ""]);
    expect(document.querySelector(".layer-announcer").textContent).toBe("");
  });

  it("announces a failed load once, not once per placement", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.viewAdd.mockRejectedValueOnce(new Error("offline"));

    crossRows()[0].querySelector(".layer-eye").click();
    await waitFor(() => expect(sidebar.store.get("pop").status).toBe("error"));
    warn.mockRestore();

    expect(messagesFor("pop")).toEqual(["Loading Population…", "", "Could not load Population. It is off."]);
    expect(document.querySelector(".layer-announcer").textContent).toBe(
      "Could not load Population. It is off.",
    );
  });

  it("announces a failed turn-off once, not once per placement", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    homeRow().querySelector(".layer-eye").click();
    await waitFor(() => expect(sidebar.store.get("pop").applied).toBe(true));
    written.length = 0;
    mocks.viewRemove.mockRejectedValueOnce(new Error("postMessage timeout"));

    crossRows()[1].querySelector(".layer-eye").click();
    await waitFor(() => expect(sidebar.store.get("pop").status).toBe("error"));
    warn.mockRestore();

    expect(messagesFor("pop")).toEqual([
      "Turning off Population…",
      "",
      "Could not change Population. It is still on as before.",
    ]);
  });

  it("announces the same failure again when it happens again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.viewAdd.mockRejectedValue(new Error("offline"));
    const eye = homeRow().querySelector(".layer-eye");

    const failures = () =>
      messagesFor("pop").filter((message) => message === "Could not load Population. It is off.");

    eye.click();
    await waitFor(() => expect(failures()).toHaveLength(1));
    eye.click();
    await waitFor(() => expect(failures()).toHaveLength(2));
    warn.mockRestore();

    // Two failures, two announcements — and not one per placement either.
    expect(failures()).toHaveLength(2);
  });

  it("keeps every row's visible error line, since only the announcement is shared", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.viewAdd.mockRejectedValueOnce(new Error("offline"));

    homeRow().querySelector(".layer-eye").click();
    await waitFor(() => expect(sidebar.store.get("pop").status).toBe("error"));
    warn.mockRestore();

    for (const row of [homeRow(), ...crossRows()]) {
      const line = row.querySelector(".layer-error");
      expect(line.textContent).toBe("Could not load Population. It is off.");
      // Seen, not heard: the live region is the only thing that speaks.
      expect(line.getAttribute("aria-hidden")).toBe("true");
    }
  });

  /** Earthquake's compact row in Population's tab. */
  const quakeRow = () =>
    [...document.querySelectorAll('[data-tab-panel="exposure"] .cross-tab-item')].find(
      (item) => item.querySelector(".cross-tab-label").textContent === "Earthquake",
    );

  it("does not let the layer that settles last wipe the other layer's message", async () => {
    const slowPop = deferred();
    const slowQuake = deferred();
    mocks.viewAdd.mockImplementation((id) => (id === "MX-POP" ? slowPop.promise : slowQuake.promise));
    const region = document.querySelector(".layer-announcer");

    homeRow().querySelector(".layer-eye").click();
    expect(region.textContent).toBe("Loading Population…");

    // Earthquake starts loading too, from its compact row in this tab. Both
    // layers have something to say, so the region carries both sentences:
    // overwriting one with the other would lose it.
    quakeRow().querySelector(".layer-eye").click();
    expect(region.textContent).toBe("Loading Population… Loading Earthquake…");

    // Population arrives first; dropping its busy sentence must not take
    // Earthquake's standing message with it.
    slowPop.resolve();
    await waitFor(() => expect(sidebar.store.get("pop").applied).toBe(true));
    expect(region.textContent).toBe("Loading Earthquake…");

    slowQuake.resolve();
    await waitFor(() => expect(sidebar.store.get("quake").applied).toBe(true));
    expect(region.textContent).toBe("");
  });

  it("keeps a standing message when the layer that spoke last settles first", async () => {
    const slowPop = deferred();
    const slowQuake = deferred();
    mocks.viewAdd.mockImplementation((id) => (id === "MX-POP" ? slowPop.promise : slowQuake.promise));
    const region = document.querySelector(".layer-announcer");

    homeRow().querySelector(".layer-eye").click();
    quakeRow().querySelector(".layer-eye").click();

    // The other order: Earthquake, which spoke last, settles first. Population
    // is still loading, so its "Loading…" has to be left standing.
    slowQuake.resolve();
    await waitFor(() => expect(sidebar.store.get("quake").applied).toBe(true));
    expect(region.textContent).toBe("Loading Population…");

    slowPop.resolve();
    await waitFor(() => expect(sidebar.store.get("pop").applied).toBe(true));
    expect(region.textContent).toBe("");
  });

  it("announces two layers failing together without losing either", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.viewAdd.mockRejectedValue(new Error("offline"));
    const region = document.querySelector(".layer-announcer");

    homeRow().querySelector(".layer-eye").click();
    quakeRow().querySelector(".layer-eye").click();
    await waitFor(() => expect(sidebar.store.get("pop").status).toBe("error"));
    await waitFor(() => expect(sidebar.store.get("quake").status).toBe("error"));
    warn.mockRestore();

    expect(region.textContent).toContain("Could not load Population. It is off.");
    expect(region.textContent).toContain("Could not load Earthquake. It is off.");
  });

  it("puts the region in the root's body when the root is not an element", () => {
    // An embed may pass a document or a fragment. Falling back to the layer
    // panel would put the region inside `#app-map`, which an information page
    // hides, so nothing would be announced there — the bug this region fixes.
    sidebar.destroy();
    sidebar = createSidebar(document, { stateAdapter: memoryAdapter() });

    const region = document.querySelector(".layer-announcer");
    expect(region.parentElement).toBe(document.body);
    expect(region.closest('[data-ui="panel-body"]')).toBeNull();
  });

  it("takes its region out of the page on destroy, and the next instance brings one", () => {
    sidebar.destroy();
    expect(document.querySelectorAll(".layer-announcer")).toHaveLength(0);

    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    expect(document.querySelectorAll(".layer-announcer")).toHaveLength(1);
  });
});
