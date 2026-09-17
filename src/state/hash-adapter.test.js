import { beforeEach, describe, expect, it, vi } from "vitest";
import { TABS } from "../config/layers.js";
import { createHashAdapter } from "./hash-adapter.js";
import { createLayersStore, toUrlLayers, urlKeyOrder } from "./layers-store.js";

beforeEach(() => {
  history.replaceState(null, "", "#");
});

/** A stand-in window: its own event target, location and history. */
function fakeWindow(hash = "") {
  const target = new EventTarget();
  target.location = { hash };
  const navigate = (_state, _title, url) => {
    target.location.hash = url;
  };
  target.history = { pushState: vi.fn(navigate), replaceState: vi.fn(navigate) };
  return target;
}

describe("createHashAdapter", () => {
  it("reads the current hash as URL state", () => {
    history.replaceState(null, "", "#hazard?layers=earthquake-pga:2,landslides");
    expect(createHashAdapter().read()).toEqual({
      tab: "hazard",
      layers: [
        { key: "earthquake-pga", sourceIdx: 2 },
        { key: "landslides", sourceIdx: 0 },
      ],
    });
  });

  it("pushes by default and replaces on request", () => {
    const adapter = createHashAdapter();
    const lengthBefore = history.length;

    adapter.write({ tab: "exposure", layers: [{ key: "population", sourceIdx: 0 }] });
    expect(location.hash).toBe("#exposure?layers=population");
    expect(history.length).toBe(lengthBefore + 1);

    adapter.write({ tab: "exposure", layers: [] }, { replace: true });
    expect(location.hash).toBe("#exposure");
    expect(history.length).toBe(lengthBefore + 1);
  });

  it("does not add an entry when the hash is already current", () => {
    const adapter = createHashAdapter();
    adapter.write({ tab: "hazard", layers: [] });
    const lengthBefore = history.length;

    adapter.write({ tab: "hazard", layers: [] });

    expect(history.length).toBe(lengthBefore);
  });

  it("reads and writes the target's location and history, not the globals", () => {
    const target = fakeWindow("#hazard?layers=landslides");
    const adapter = createHashAdapter({ target });

    expect(adapter.read()).toEqual({ tab: "hazard", layers: [{ key: "landslides", sourceIdx: 0 }] });

    adapter.write({ tab: "exposure", layers: [{ key: "population", sourceIdx: 0 }] });
    adapter.write({ tab: "exposure", layers: [] }, { replace: true });
    // Already current: no call.
    adapter.write({ tab: "exposure", layers: [] });

    expect(target.history.pushState).toHaveBeenCalledTimes(1);
    expect(target.history.pushState).toHaveBeenCalledWith(null, "", "#exposure?layers=population");
    expect(target.history.replaceState).toHaveBeenCalledWith(null, "", "#exposure");
    expect(target.location.hash).toBe("#exposure");
    expect(location.hash).toBe("");
  });

  it("calls subscribers with the parsed state on hashchange until unsubscribed", () => {
    const target = fakeWindow();
    const adapter = createHashAdapter({ target });
    const fn = vi.fn();
    const unsubscribe = adapter.subscribe(fn);

    target.location.hash = "#risk?layers=aal-public:1";
    target.dispatchEvent(new Event("hashchange"));
    expect(fn).toHaveBeenCalledWith({ tab: "risk", layers: [{ key: "aal-public", sourceIdx: 1 }] });

    unsubscribe();
    target.dispatchEvent(new Event("hashchange"));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("removes every listener on destroy", () => {
    const target = fakeWindow();
    const adapter = createHashAdapter({ target });
    const first = vi.fn();
    const second = vi.fn();
    adapter.subscribe(first);
    adapter.subscribe(second);

    adapter.destroy();
    target.dispatchEvent(new Event("hashchange"));

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("listens on window by default", () => {
    const adapter = createHashAdapter();
    const fn = vi.fn();
    adapter.subscribe(fn);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    adapter.destroy();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// The same key order the sidebar serialises the hash in.
const CONFIG_ORDER = urlKeyOrder(TABS);

const EDRA_VARIANTS = encodeURIComponent(
  JSON.stringify({ "edra-crop-yield-reduction": { crop: "MAIZE", scenario: "30" } }),
);

// Shared links must survive a read → store → write cycle byte for byte, so
// links already in circulation keep working after the store refactor.
describe("shared-link round trip through the layers store", () => {
  it.each([
    ["compound and simple hazard layers", "#hazard?layers=river-flooding:1,earthquake-pga:2,landslides"],
    [
      "an EDRA layer with variants",
      "#hazard?layers=edra-crop-yield-reduction,river-flooding:2&variants=%7B%22edra-crop-yield-reduction%22%3A%7B%22crop%22%3A%22MAIZE%22%2C%22scenario%22%3A%2230%22%7D%7D",
    ],
    ["layers from several tabs", "#exposure?layers=recovery-speed:3,population,hdi"],
    // Grouped tabs: the sidebar lists these by R2R category (Societies, Economy,
    // Environment), but links keep config order.
    ["risk layers from different R2R groups", "#risk-resilience?layers=ecosystem-loss,aal-to-gdp-2025"],
    [
      "resilience layers from different R2R groups",
      "#resilience?layers=change-fiscal-gap,early-warning-coverage",
    ],
    [
      "vulnerability layers from different R2R groups",
      "#vulnerability?layers=intact-forests,water-stress,hdi",
    ],
  ])("keeps %s unchanged", (_name, link) => {
    history.replaceState(null, "", link);
    const adapter = createHashAdapter();
    const lengthBefore = history.length;

    // What restore does: apply each layer, recording the view that carries it.
    const { tab, layers } = adapter.read();
    const store = createLayersStore();
    for (const { key, sourceIdx, settings } of layers) {
      store.set(key, {
        desired: true,
        applied: true,
        viewId: `MX-${key}-${sourceIdx}`,
        sourceIdx,
        settings: settings ?? null,
      });
    }
    adapter.write({ tab, layers: toUrlLayers(store.all(), CONFIG_ORDER) }, { replace: true });

    expect(location.hash).toBe(link);
    expect(history.length).toBe(lengthBefore);
  });

  it("covers grouped tabs whose rows are not in config order", () => {
    // Guards the fixtures above: if these orders ever agree, the grouped-tab
    // links no longer test anything.
    for (const id of ["risk-resilience", "resilience", "vulnerability"]) {
      const tab = TABS.find((candidate) => candidate.id === id);
      const rowOrder = urlKeyOrder([{ layers: tab.groups.flatMap((group) => group.layers) }]);
      expect(rowOrder).not.toEqual(urlKeyOrder([tab]));
    }
  });

  it("uses the encoded EDRA variants the fixture expects", () => {
    expect(EDRA_VARIANTS).toBe(
      "%7B%22edra-crop-yield-reduction%22%3A%7B%22crop%22%3A%22MAIZE%22%2C%22scenario%22%3A%2230%22%7D%7D",
    );
  });
});
