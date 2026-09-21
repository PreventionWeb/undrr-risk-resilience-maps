import { describe, expect, it, vi } from "vitest";
import {
  buildCrossTabSections,
  buildTabPanel,
  EMPTY_TAB_MESSAGE,
  updateDisabledLayerVisibility,
} from "./layer-panel.js";

const layer = (key, extra = {}) => ({ key, id: `MX-${key.toUpperCase()}`, label: key, type: "vt", ...extra });
const unpublished = (key) => layer(key, { id: null });

/** A fake row factory: records calls and returns a labelled element. */
function rowFactory() {
  const addRow = vi.fn((l, variant, tabId) => {
    const element = document.createElement("div");
    element.className = variant === "full" ? "layer-item" : "cross-tab-item";
    element.dataset.key = l.key;
    element.dataset.tabId = tabId;
    return { element };
  });
  return addRow;
}

const keys = (container, selector) => [...container.querySelectorAll(selector)].map((el) => el.dataset.key);

describe("buildTabPanel", () => {
  const flat = {
    id: "hazard",
    label: "Hazard",
    description: "Hazard layers",
    definitionUrl: "https://example.org/hazard",
    layers: [layer("quake"), unpublished("storm"), layer("flood")],
    groups: null,
  };

  it("builds a hidden panel with its tab id, intro and a full row per layer", () => {
    const addRow = rowFactory();
    const panel = buildTabPanel(flat, { addRow });

    expect(panel.hasAttribute("id")).toBe(false);
    expect(panel.className).toBe("tab-panel");
    expect(panel.dataset.tabPanel).toBe("hazard");
    expect(panel.style.display).toBe("none");
    expect(panel.querySelector(".tab-panel-intro p").textContent).toBe("Hazard layers");
    expect(panel.querySelector(".tab-panel-glossary")).toBeNull();
    const link = panel.querySelector(".tab-panel-intro a");
    expect(link.href).toBe("https://example.org/hazard");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener");
    expect(link.textContent).toBe("UNDRR definition");

    expect(addRow.mock.calls.map(([l, variant, tabId]) => [l.key, variant, tabId])).toEqual([
      ["quake", "full", "hazard"],
      ["storm", "full", "hazard"],
      ["flood", "full", "hazard"],
    ]);
    expect(keys(panel, ":scope > .layer-item")).toEqual(["quake", "storm", "flood"]);
  });

  it("marks unpublished rows and hides them unless disabled layers are shown", () => {
    const hidden = buildTabPanel(flat, { addRow: rowFactory() });
    const storm = hidden.querySelector("[data-key='storm']");
    expect(storm.dataset.layerDisabled).toBe("true");
    expect(storm.classList.contains("layer-disabled")).toBe(true);
    expect(storm.hidden).toBe(true);
    expect(hidden.querySelector("[data-key='quake']").hidden).toBe(false);

    const shown = buildTabPanel(flat, { addRow: rowFactory(), showDisabled: true });
    expect(shown.querySelector("[data-key='storm']").hidden).toBe(false);
  });

  it("adds the glossary and shows the empty state only without published layers", () => {
    const withLayers = buildTabPanel(flat, { addRow: rowFactory() });
    expect(withLayers.querySelector(".tab-panel-empty").hidden).toBe(true);

    const empty = buildTabPanel(
      { ...flat, glossary: "AAL means average annual loss.", layers: [unpublished("storm")] },
      { addRow: rowFactory() },
    );
    expect(empty.querySelector(".tab-panel-glossary").textContent).toBe("AAL means average annual loss.");
    const message = empty.querySelector(".tab-panel-empty");
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe(EMPTY_TAB_MESSAGE);
  });

  it("renders R2R groups as open details, in group order", () => {
    const econ = layer("econ");
    const soc = layer("soc");
    const grouped = {
      ...flat,
      layers: [econ, soc],
      groups: [
        { id: "societies", label: "Societies", layers: [soc] },
        { id: "economy", label: "Economy", layers: [econ] },
      ],
    };

    const panel = buildTabPanel(grouped, { addRow: rowFactory() });

    const groups = [...panel.querySelectorAll("details.layer-group")];
    expect(groups.map((g) => [g.open, g.querySelector("summary.layer-group-heading").textContent])).toEqual([
      [true, "Societies"],
      [true, "Economy"],
    ]);
    expect(keys(panel, ".layer-group-items > .layer-item")).toEqual(["soc", "econ"]);
    expect(panel.querySelectorAll(":scope > .layer-item")).toHaveLength(0);
  });

  it("wraps the group stack in a flush Mangrove accordion of direct details children", () => {
    const soc = layer("soc");
    const econ = layer("econ");
    const grouped = {
      ...flat,
      layers: [soc, econ],
      groups: [
        { id: "societies", label: "Societies", layers: [soc] },
        { id: "economy", label: "Economy", layers: [econ] },
      ],
    };

    const panel = buildTabPanel(grouped, { addRow: rowFactory() });

    const stack = panel.querySelector(":scope > .layer-groups");
    expect([...stack.classList]).toEqual(["layer-groups", "mg-accordion", "mg-accordion--flush"]);
    // Mangrove's accordion rules are all `.mg-accordion > details`, so every
    // group has to stay a direct child of the container.
    expect(stack.querySelectorAll(":scope > details.layer-group")).toHaveLength(2);
    expect(panel.querySelectorAll(":scope > details.layer-group")).toHaveLength(0);
    // The summary stays the only control in the header: no nested interactive
    // element, and the row's own expand button is untouched.
    expect(stack.querySelectorAll("summary button, summary a, summary input")).toHaveLength(0);
  });

  it("leaves an ungrouped tab without an accordion", () => {
    const panel = buildTabPanel(flat, { addRow: rowFactory() });
    expect(panel.querySelector(".mg-accordion")).toBeNull();
  });
});

describe("updateDisabledLayerVisibility", () => {
  const hdi = layer("hdi");
  const forests = unpublished("forests");
  const tab = {
    id: "vulnerability",
    label: "Vulnerability",
    description: "",
    layers: [hdi, forests],
    groups: [
      { id: "societies", label: "Societies", layers: [hdi] },
      { id: "environment", label: "Environment", layers: [forests] },
    ],
  };

  it("shows and hides unpublished rows and the groups left without visible rows", () => {
    const panel = buildTabPanel(tab, { id: "tab-vulnerability", addRow: rowFactory() });
    const [societies, environment] = panel.querySelectorAll(".layer-group");

    updateDisabledLayerVisibility(panel, tab, false);
    expect(panel.querySelector("[data-key='forests']").hidden).toBe(true);
    expect(societies.hidden).toBe(false);
    expect(environment.hidden).toBe(true);

    updateDisabledLayerVisibility(panel, tab, true);
    expect(panel.querySelector("[data-key='forests']").hidden).toBe(false);
    expect(environment.hidden).toBe(false);
  });

  it("shows the empty state only while disabled layers are hidden", () => {
    const emptyTab = { ...tab, layers: [unpublished("forests")], groups: null };
    const panel = buildTabPanel(emptyTab, { id: "tab-vulnerability", addRow: rowFactory() });
    const empty = panel.querySelector(".tab-panel-empty");

    updateDisabledLayerVisibility(panel, emptyTab, true);
    expect(empty.hidden).toBe(true);
    updateDisabledLayerVisibility(panel, emptyTab, false);
    expect(empty.hidden).toBe(false);
  });
});

describe("buildCrossTabSections", () => {
  const econ = layer("econ");
  const soc = layer("soc");
  const tabs = [
    { id: "risk", label: "Risk", layers: [layer("aal")], groups: null },
    {
      id: "vulnerability",
      label: "Vulnerability",
      layers: [econ, soc, unpublished("forests")],
      groups: [
        { id: "societies", label: "Societies", layers: [soc] },
        { id: "economy", label: "Economy", layers: [econ] },
        { id: "environment", label: "Environment", layers: [unpublished("forests")] },
      ],
    },
    {
      id: "exposure",
      label: "Exposure",
      layers: [unpublished("pop"), layer("roads"), { ...layer("x"), key: undefined }],
    },
    { id: "resilience", label: "Resilience", layers: [unpublished("ews")] },
  ];

  it("lists other tabs' published, keyed layers as compact rows owned by the current tab", () => {
    const addRow = rowFactory();
    const container = buildCrossTabSections(tabs[0], tabs, { addRow });

    // A flush Mangrove accordion around the whole stack of `<details>`.
    expect([...container.classList]).toEqual(["cross-tab-sections", "mg-accordion", "mg-accordion--flush"]);
    const sections = [...container.querySelectorAll(":scope > details.cross-tab-section")];
    // Risk is the current tab and Resilience has nothing published.
    expect(sections.map((s) => s.querySelector("summary.cross-tab-summary").textContent)).toEqual([
      "Vulnerability",
      "Exposure",
    ]);
    for (const section of sections) expect(section.open).toBe(false);

    // Groups keep their order and skip empty groups.
    expect([...sections[0].querySelectorAll(".cross-tab-group-label")].map((p) => p.textContent)).toEqual([
      "Societies",
      "Economy",
    ]);
    expect(keys(sections[0], ".cross-tab-item")).toEqual(["soc", "econ"]);
    expect(keys(sections[1], ".cross-tab-item")).toEqual(["roads"]);
    expect(sections[1].querySelector(".cross-tab-group-label")).toBeNull();

    expect(addRow.mock.calls.map(([l, variant, tabId]) => [l.key, variant, tabId])).toEqual([
      ["soc", "compact", "risk"],
      ["econ", "compact", "risk"],
      ["roads", "compact", "risk"],
    ]);
  });

  it("returns an empty container when no other tab has published layers", () => {
    const container = buildCrossTabSections(tabs[3], [tabs[3]], { addRow: rowFactory() });
    expect(container.children).toHaveLength(0);
  });

  it("returns an empty container when currentTab has crossTab: false", () => {
    const isolatedTab = { id: "gar", label: "GAR", layers: [layer("gar1")], crossTab: false };
    const container = buildCrossTabSections(isolatedTab, [...tabs, isolatedTab], { addRow: rowFactory() });
    expect(container.children).toHaveLength(0);
  });

  it("excludes tabs with crossTab: false from other tabs' cross-tab sections", () => {
    const isolatedTab = { id: "gar", label: "GAR", layers: [layer("gar1")], crossTab: false };
    const container = buildCrossTabSections(tabs[0], [...tabs, isolatedTab], { addRow: rowFactory() });
    const sectionLabels = [...container.querySelectorAll(":scope > details.cross-tab-section")].map(
      (s) => s.querySelector("summary.cross-tab-summary").textContent,
    );
    expect(sectionLabels).not.toContain("GAR");
  });
});
