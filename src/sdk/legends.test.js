import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const ask = vi.fn();
  return { ask, sdk: { ask } };
});

vi.mock("./client.js", () => ({
  getSDK: () => mocks.sdk,
}));

import {
  getMapXLegend,
  parseMapXLegend,
  resetMapXLegendCache,
  resolveMapXLegend,
  resolveParsedMapXLegend,
} from "./legends.js";

function vectorView(overrides = {}) {
  return {
    id: "MX-TEST",
    type: "vt",
    data: {
      geometry: { type: "polygon" },
      style: {
        titleLegend: { en: "Risk level", fr: "Niveau de risque" },
        hideNulls: false,
        rules: [
          {
            color: "#f7fbff",
            opacity: 0.7,
            value: 0,
            value_to: 10,
            label_en: "Low",
            label_fr: "Faible",
            sprite: "none",
          },
          {
            color: "rgb(8, 48, 107)",
            opacity: 1,
            value: 10,
            value_to: 20,
            label_en: "High",
            sprite: "none",
            add_border: true,
            color_border: "#ffffff",
          },
        ],
        nulls: [{ color: "#cccccc", opacity: 1, value: "", label_en: "No data", sprite: "none" }],
        custom: { json: '{"enable":false}' },
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.ask.mockReset();
  mocks.sdk = { ask: mocks.ask };
  resetMapXLegendCache();
});

describe("parseMapXLegend", () => {
  it("normalises vector rules, title, opacity, border, and no-data styling", () => {
    expect(parseMapXLegend(vectorView())).toEqual({
      title: "Risk level",
      entries: [
        {
          color: "#f7fbff",
          label: "Low",
          opacity: 0.7,
          size: null,
          geometry: "polygon",
          borderColor: null,
        },
        {
          color: "rgb(8, 48, 107)",
          label: "High",
          opacity: 1,
          size: null,
          geometry: "polygon",
          borderColor: "#ffffff",
        },
        {
          color: "#cccccc",
          label: "No data",
          opacity: 1,
          size: null,
          geometry: "polygon",
          borderColor: null,
        },
      ],
    });
  });

  it("uses the requested language and falls back to a rule value when its label is blank", () => {
    const view = vectorView();
    view.data.style.rules[1].label_fr = "";
    view.data.style.rules[1].label_en = "";
    view.data.style.rules[1].value = "Very high";

    const legend = parseMapXLegend(view, "fr");
    expect(legend.title).toBe("Niveau de risque");
    expect(legend.entries.map((entry) => entry.label)).toEqual(["Faible", "Very high", "No data"]);
  });

  it("omits null rules when MapX marks them hidden", () => {
    const view = vectorView();
    view.data.style.hideNulls = true;
    expect(parseMapXLegend(view).entries).toHaveLength(2);
  });

  it("ignores non-language title metadata when selecting a fallback language", () => {
    const view = vectorView();
    view.data.style.titleLegend = {
      description: "Internal metadata, not a title",
      fr: "Niveau de risque",
    };

    expect(parseMapXLegend(view, "de").title).toBe("Niveau de risque");
  });

  it("reports why raster and custom-style views require image fallbacks", () => {
    expect(resolveParsedMapXLegend({ ...vectorView(), type: "rt" })).toEqual({
      legend: null,
      reason: "raster",
    });

    const custom = vectorView();
    custom.data.style.custom.json = '{"enable":true}';
    expect(resolveParsedMapXLegend(custom)).toEqual({
      legend: null,
      reason: "custom-style",
    });
  });

  it.each([
    ["raster views", { ...vectorView(), type: "rt" }],
    [
      "enabled custom styles",
      (() => {
        const view = vectorView();
        view.data.style.custom.json = '{"enable":true}';
        return view;
      })(),
    ],
    [
      "malformed custom styles",
      (() => {
        const view = vectorView();
        view.data.style.custom.json = "{";
        return view;
      })(),
    ],
    [
      "object-form enabled custom styles",
      (() => {
        const view = vectorView();
        view.data.style.custom.json = { enable: true };
        return view;
      })(),
    ],
    [
      "sprite rules",
      (() => {
        const view = vectorView();
        view.data.style.rules[0].sprite = "airport";
        return view;
      })(),
    ],
    [
      "unsafe colours",
      (() => {
        const view = vectorView();
        view.data.style.rules[0].color = "url(javascript:alert(1))";
        return view;
      })(),
    ],
    [
      "unsafe border colours",
      (() => {
        const view = vectorView();
        view.data.style.rules[0].add_border = true;
        view.data.style.rules[0].color_border = "url(example)";
        return view;
      })(),
    ],
    [
      "unknown geometry",
      (() => {
        const view = vectorView();
        view.data.geometry.type = "collection";
        return view;
      })(),
    ],
    [
      "malformed null rules",
      (() => {
        const view = vectorView();
        view.data.style.nulls = {};
        return view;
      })(),
    ],
    [
      "excessive combined rule counts",
      (() => {
        const view = vectorView();
        view.data.style.rules = Array.from({ length: 500 }, () => ({
          color: "#fff",
          label_en: "Value",
        }));
        view.data.style.nulls = [{ color: "#ccc", label_en: "No data" }];
        return view;
      })(),
    ],
  ])("returns null for %s so the caller can use the PNG fallback", (_name, view) => {
    expect(parseMapXLegend(view)).toBeNull();
  });
});

describe("getMapXLegend", () => {
  it("loads the catalogue once and resolves multiple view legends from the cache", async () => {
    const second = vectorView({ id: "MX-SECOND" });
    mocks.ask.mockResolvedValue([vectorView(), second]);

    const firstLegend = await getMapXLegend("MX-TEST");
    const secondLegend = await getMapXLegend("MX-SECOND");

    expect(firstLegend.title).toBe("Risk level");
    expect(secondLegend.title).toBe("Risk level");
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    expect(mocks.ask).toHaveBeenCalledWith("get_views");
  });

  it("returns null when the view is not in the active project catalogue", async () => {
    mocks.ask.mockResolvedValue([vectorView()]);
    await expect(getMapXLegend("MX-MISSING")).resolves.toBeNull();
    expect(mocks.ask).toHaveBeenCalledTimes(2);
  });

  it("refreshes a cached catalogue once when view_add makes a later view available", async () => {
    const second = vectorView({ id: "MX-SECOND" });
    mocks.ask.mockResolvedValueOnce([vectorView()]).mockResolvedValueOnce([vectorView(), second]);

    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();
    await expect(resolveMapXLegend("MX-SECOND")).resolves.toMatchObject({
      legend: { title: "Risk level" },
      reason: null,
    });
    expect(mocks.ask).toHaveBeenCalledTimes(2);
  });

  it("scopes the catalogue cache to the active SDK manager", async () => {
    mocks.ask.mockResolvedValue([vectorView()]);
    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();

    const nextAsk = vi.fn().mockResolvedValue([vectorView({ id: "MX-NEXT" })]);
    mocks.sdk = { ask: nextAsk };

    await expect(getMapXLegend("MX-NEXT")).resolves.toBeTruthy();
    expect(nextAsk).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed catalogue request so a later attempt can retry", async () => {
    mocks.ask.mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce([vectorView()]);
    await expect(getMapXLegend("MX-TEST")).rejects.toThrow("temporary");
    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();
    expect(mocks.ask).toHaveBeenCalledTimes(2);
  });
});
