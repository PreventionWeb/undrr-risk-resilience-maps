import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/layers.js", () => ({
  TABS: [
    {
      id: "test-tab",
      label: "Test",
      layers: [
        {
          id: "vt-view",
          key: "vt-layer",
          label: "VT Layer",
          type: "vt",
          desc: "A readable layer description.",
          source: "Example source",
          sourceUrl: "https://example.com/data",
        },
        { id: "rt-view", key: "rt-layer", label: "RT Layer", type: "rt" },
        {
          id: null,
          key: "compound",
          label: "Compound Layer",
          type: "vt",
          sources: [
            { id: "compound-src-0", label: "Source A" },
            { id: "compound-src-1", label: "Source B" },
          ],
        },
      ],
    },
  ],
}));

// The copy button's behaviour comes from Mangrove's CDN module; record how the
// panel asks for it instead of fetching it. `loaded` stands in for the module
// request, so a test can leave it pending (a slow CDN) or settle it false (a
// CDN that never answers). The local fallback is the real one.
const copyButton = vi.hoisted(() => ({ calls: [], loaded: null }));
vi.mock("./mangrove-copy-button.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    initMangroveCopyButtons: (scope, options) => {
      copyButton.calls.push({ scope, options });
      return copyButton.loaded;
    },
  };
});

import {
  buildSiteInspectorPanel,
  showSiteInspector,
  hideSiteInspector,
  isSiteInspectorVisible,
} from "./site-inspector.js";

function setupDOM() {
  document.body.innerHTML = `<div id="app-map"></div>`;
}

beforeEach(() => {
  setupDOM();
  copyButton.calls.length = 0;
  // By default the module is already in: `initMangroveCopyButtons` resolves
  // true on the next microtask, exactly as a warm cache would.
  copyButton.loaded = Promise.resolve(true);
});

describe("buildSiteInspectorPanel", () => {
  it("appends the panel to #app-map", () => {
    buildSiteInspectorPanel();
    expect(document.getElementById("site-inspector")).toBeTruthy();
    expect(document.getElementById("app-map").contains(document.getElementById("site-inspector"))).toBe(true);
  });

  it("starts hidden", () => {
    buildSiteInspectorPanel();
    expect(document.getElementById("site-inspector").hidden).toBe(true);
  });

  it("does not duplicate the panel if called twice", () => {
    buildSiteInspectorPanel();
    buildSiteInspectorPanel();
    expect(document.querySelectorAll("#site-inspector").length).toBe(1);
  });
});

describe("showSiteInspector / hideSiteInspector", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows the panel", () => {
    showSiteInspector({
      lngLat: { lat: 10, lng: 20 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    expect(isSiteInspectorVisible()).toBe(true);
  });

  it("hides the panel", () => {
    showSiteInspector({
      lngLat: { lat: 10, lng: 20 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    hideSiteInspector();
    expect(isSiteInspectorVisible()).toBe(false);
  });

  it("renders coordinates", () => {
    showSiteInspector({
      lngLat: { lat: 12.34567, lng: -56.78901 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    const coords = document.querySelector(".site-inspector-coords-value").textContent;
    expect(coords).toContain("12.34567");
    expect(coords).toContain("-56.78901");
  });

  it("closes on Escape key", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(isSiteInspectorVisible()).toBe(false);
  });

  it("removes Escape handler after close", () => {
    showSiteInspector({ lngLat: { lat: 0, lng: 0 }, views: {}, openViewsSnapshot: new Set() });
    hideSiteInspector();
    // Should not throw
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
});

describe("the coordinates copy button", () => {
  const show = (lat = 12.34567, lng = -56.78901) =>
    showSiteInspector({ lngLat: { lat, lng }, views: {}, openViewsSnapshot: new Set() });

  beforeEach(() => buildSiteInspectorPanel());

  it("is Mangrove's CopyButton in its vanilla form", () => {
    show();
    const button = document.querySelector(".site-inspector-coords-copy");

    expect(button.type).toBe("button");
    for (const className of [
      "mg-button",
      "mg-button-primary",
      "mg-button-outline",
      "mg-button--icon",
      "mg-copy-button",
    ]) {
      expect(button.classList.contains(className)).toBe(true);
    }
    expect(button.hasAttribute("data-mg-copy-button")).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Copy coordinates");
    expect(button.querySelector(".mg-icon.mg-icon-copy.mg-button__icon")).not.toBeNull();

    const feedback = button.querySelector(".mg-copy-button__feedback");
    expect(feedback.getAttribute("aria-hidden")).toBe("true");
    expect(feedback.textContent).toBe("Copied!");

    const live = button.querySelector(".mg-u-sr-only");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");
  });

  it("copies exactly the coordinates it shows", () => {
    show();
    const button = document.querySelector(".site-inspector-coords-copy");
    const shown = document.querySelector(".site-inspector-coords-value").textContent;

    expect(button.dataset.textToCopy).toBe("12.34567, -56.78901");
    expect(button.dataset.textToCopy).toBe(shown);
    expect(button.dataset.copiedLabel).toBe("Coordinates copied to clipboard.");
  });

  it("initialises the Mangrove module over the coordinates row it just built", () => {
    show();

    expect(copyButton.calls).toHaveLength(1);
    const [{ scope, options }] = copyButton.calls;
    expect(scope).toBe(document.querySelector(".site-inspector-coords"));
    expect(scope.contains(document.querySelector("[data-mg-copy-button]"))).toBe(true);
    expect(options.signal.aborted).toBe(false);
  });

  it("abandons a pending initialisation when the row is rebuilt or the panel closes", () => {
    show();
    const first = copyButton.calls[0].options.signal;

    show(1, 2);
    expect(first.aborted).toBe(true);
    const second = copyButton.calls[1].options.signal;
    expect(second.aborted).toBe(false);

    hideSiteInspector();
    expect(second.aborted).toBe(true);
  });

  /**
   * The module is a CDN import, so it can be late or never arrive. The button
   * is present, focusable and labelled from the moment the panel renders, so
   * it has to copy from that moment too; the three tests below cover the
   * module landing, the module never landing, and a click inside the window
   * before it lands.
   */
  describe("without the Mangrove module", () => {
    /** Swap in a recording clipboard for the duration of `fn`. */
    async function withClipboard(fn) {
      const writeText = vi.fn(() => Promise.resolve());
      const clipboard = navigator.clipboard;
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      try {
        await fn(writeText);
      } finally {
        if (clipboard === undefined) delete navigator.clipboard;
        else Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
      }
    }

    it("still copies when the module never loads, and says so", async () => {
      copyButton.loaded = Promise.resolve(false);
      show();
      await copyButton.loaded;

      await withClipboard(async (writeText) => {
        const button = document.querySelector(".site-inspector-coords-copy");
        button.click();
        await Promise.resolve();

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith("12.34567, -56.78901");
        expect(button.classList.contains("mg-copy-button--copied")).toBe(true);
        expect(
          button
            .querySelector(".mg-copy-button__feedback")
            .classList.contains("mg-copy-button__feedback--visible"),
        ).toBe(true);
        expect(button.querySelector(".mg-u-sr-only").textContent).toBe("Coordinates copied to clipboard.");
      });
    });

    it("copies a click made while the module is still loading, exactly once", async () => {
      let applied;
      copyButton.loaded = new Promise((resolve) => (applied = resolve));
      show();

      await withClipboard(async (writeText) => {
        const button = document.querySelector(".site-inspector-coords-copy");
        // Mid-load: the module is not in yet, so the local handler answers.
        button.click();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledTimes(1);

        // The module lands and takes over; the local handler is dropped, so a
        // second click is not written (or announced) twice.
        applied(true);
        await copyButton.loaded;
        await Promise.resolve();
        button.click();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledTimes(1);
      });
    });

    it("says the copy failed when the clipboard refuses", async () => {
      copyButton.loaded = Promise.resolve(false);
      show();
      await copyButton.loaded;

      const clipboard = navigator.clipboard;
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("denied")) },
        configurable: true,
      });
      try {
        const button = document.querySelector(".site-inspector-coords-copy");
        button.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(button.classList.contains("mg-copy-button--copied")).toBe(false);
        expect(button.querySelector(".mg-u-sr-only").textContent).toBe(
          "Copy failed. Select the text and copy it manually.",
        );
      } finally {
        if (clipboard === undefined) delete navigator.clipboard;
        else Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
      }
    });
  });
});

describe("layer rows — VT with data", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows attribute table for VT view with hit", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ country: "Japan", pop: 125 }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    const html = document.querySelector(".site-inspector-layers").innerHTML;
    expect(html).toContain("Japan");
    expect(html).toContain("125");
  });

  it("shows layer context and source links with inspection values", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ romnam: "Japan", iso3cd: "JPN" }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    const row = document.querySelector(".site-inspector-layer-row");
    expect(row.querySelector(".site-inspector-layer-desc").textContent).toContain("readable");
    expect(row.textContent).toContain("Country");
    expect(row.textContent).toContain("Country code");
    expect(row.querySelector('a[href="https://example.com/data"]')).not.toBeNull();
    expect(row.querySelector('a[href="#sources"]')).not.toBeNull();
  });

  it("formats large numeric values for readability", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ jo_pml100_households_existingclimate: 35724591030.8 }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    expect(document.querySelector(".site-inspector-layers").textContent).toContain("35,724,591,030.8");
    expect(document.querySelector(".site-inspector-layers").textContent).toContain("PML housing loss");
  });

  it("uses has-data indicator for VT view with hit", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ name: "X" }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    expect(document.querySelector(".site-inspector-indicator--has-data")).toBeTruthy();
  });

  it("filters SKIP_KEYS from attribute table", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ gid: 1, geom: "POINT(0 0)", name: "Visible" }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    const html = document.querySelector(".site-inspector-layers").innerHTML;
    expect(html).not.toContain(">1<");
    expect(html).not.toContain("POINT");
    expect(html).toContain("Visible");
  });

  it("escapes HTML in attribute values", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ name: '<script>alert("xss")</script>' }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    const html = document.querySelector(".site-inspector-layers").innerHTML;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("layer rows — VT with no hit", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows 'no data' note for VT view with empty attributes", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    expect(document.querySelector(".site-inspector-layers").textContent).toContain("No data");
  });

  it("uses no-data indicator for VT view with no hit", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    expect(document.querySelector(".site-inspector-indicator--no-data")).toBeTruthy();
  });
});

describe("layer rows — RT layer", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows 'not queryable' note for RT layer absent from batch", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: {},
      openViewsSnapshot: new Set(["rt-view"]),
    });
    expect(document.querySelector(".site-inspector-layers").textContent).toContain("Raster layer");
  });

  it("shows GRAY_INDEX attribute table for RT layer that fired click_attributes", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "rt-view": [{ GRAY_INDEX: 42 }] },
      openViewsSnapshot: new Set(["rt-view"]),
    });
    const html = document.querySelector(".site-inspector-layers").innerHTML;
    expect(html).toContain("Pixel Value");
    expect(html).toContain("42");
    expect(html).not.toContain("Raster layer");
  });

  it("shows 'no data' when GRAY_INDEX is the float32 nodata sentinel", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "rt-view": [{ GRAY_INDEX: -3.4028234663852886e38 }] },
      openViewsSnapshot: new Set(["rt-view"]),
    });
    expect(document.querySelector(".site-inspector-layers").textContent).toContain("No data");
    expect(document.querySelector(".site-inspector-layers").textContent).not.toContain("3.40");
  });
});

describe("layer rows — compound layer", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows the source label for a compound source view", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "compound-src-1": [{ value: 99 }] },
      openViewsSnapshot: new Set(["compound-src-1"]),
    });
    const text = document.querySelector(".site-inspector-layer-name").textContent;
    expect(text).toBe("Compound Layer — Source B");
  });
});

describe("empty state", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows empty message when no views in snapshot", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    expect(document.querySelector(".site-inspector-empty")).toBeTruthy();
  });
});
