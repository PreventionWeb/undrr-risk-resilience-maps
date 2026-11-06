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
      "overlong labels and values",
      (() => {
        const view = vectorView();
        view.data.style.rules[0].label_en = "x".repeat(201);
        view.data.style.rules[0].label_fr = "x".repeat(201);
        view.data.style.rules[0].value = "x".repeat(201);
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

  it("shares a catalogue refresh across simultaneous cross-project legend misses", async () => {
    const second = vectorView({ id: "MX-SECOND" });
    const third = vectorView({ id: "MX-THIRD" });
    mocks.ask.mockResolvedValueOnce([vectorView()]).mockResolvedValueOnce([vectorView(), second, third]);
    await getMapXLegend("MX-TEST");

    const legends = await Promise.all([
      getMapXLegend("MX-SECOND"),
      getMapXLegend("MX-THIRD"),
      getMapXLegend("MX-SECOND"),
    ]);

    expect(legends.every((legend) => legend?.title === "Risk level")).toBe(true);
    expect(mocks.ask).toHaveBeenCalledTimes(2);

    // A later view_add still requires a fresh catalogue; misses are not cached.
    mocks.ask.mockResolvedValueOnce([vectorView({ id: "MX-LATER" })]);
    await expect(getMapXLegend("MX-LATER")).resolves.toBeTruthy();
    expect(mocks.ask).toHaveBeenCalledTimes(3);
  });

  it("refreshes again for a view added while the previous refresh was pending", async () => {
    const second = vectorView({ id: "MX-SECOND" });
    const third = vectorView({ id: "MX-THIRD" });
    let releaseRefresh;
    const refresh = new Promise((resolve) => (releaseRefresh = resolve));
    let started;
    const refreshStarted = new Promise((resolve) => (started = resolve));
    mocks.ask
      .mockResolvedValueOnce([vectorView()])
      .mockImplementationOnce(() => {
        started();
        return refresh;
      })
      .mockResolvedValueOnce([vectorView(), second, third]);
    await getMapXLegend("MX-TEST");

    const earlier = getMapXLegend("MX-SECOND");
    await refreshStarted;
    // This view_add completes after the service took the pending snapshot.
    const later = getMapXLegend("MX-THIRD");
    releaseRefresh([vectorView(), second]);

    await expect(earlier).resolves.toMatchObject({ title: "Risk level" });
    await expect(later).resolves.toMatchObject({ title: "Risk level" });
    expect(mocks.ask).toHaveBeenCalledTimes(3);
  });

  it("shares the refresh while preserving image fallback for absent views", async () => {
    mocks.ask.mockResolvedValue([vectorView()]);

    await expect(Promise.all([getMapXLegend("MX-MISSING"), getMapXLegend("MX-OTHER")])).resolves.toEqual([
      null,
      null,
    ]);
    expect(mocks.ask).toHaveBeenCalledTimes(2);
  });

  it("allows a new request after a shared refresh fails", async () => {
    mocks.ask.mockResolvedValueOnce([vectorView()]).mockRejectedValueOnce(new Error("refresh failed"));
    await getMapXLegend("MX-TEST");
    const results = await Promise.allSettled([getMapXLegend("MX-SECOND"), getMapXLegend("MX-THIRD")]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(mocks.ask).toHaveBeenCalledTimes(2);

    mocks.ask.mockResolvedValueOnce([vectorView({ id: "MX-SECOND" })]);
    await expect(getMapXLegend("MX-SECOND")).resolves.toBeTruthy();
    expect(mocks.ask).toHaveBeenCalledTimes(3);
  });

  it("does not evict a new manager's catalogue when the old manager rejects late", async () => {
    let rejectOld;
    mocks.ask.mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectOld = reject)));
    const oldRequest = getMapXLegend("MX-TEST");
    const oldFailure = expect(oldRequest).rejects.toThrow("old manager retired");

    const nextAsk = vi.fn().mockResolvedValue([vectorView({ id: "MX-NEXT" })]);
    mocks.sdk = { ask: nextAsk };
    await getMapXLegend("MX-NEXT");
    rejectOld(new Error("old manager retired"));
    await oldFailure;
    await expect(getMapXLegend("MX-NEXT")).resolves.toBeTruthy();
    expect(nextAsk).toHaveBeenCalledTimes(1);
  });

  it("keeps the replacement snapshot after reset when an old request succeeds late", async () => {
    let releaseOld;
    mocks.ask
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)))
      .mockResolvedValueOnce([vectorView({ id: "MX-NEXT" })]);
    const oldRequest = getMapXLegend("MX-TEST");
    resetMapXLegendCache();

    await expect(getMapXLegend("MX-NEXT")).resolves.toBeTruthy();
    releaseOld([vectorView()]);
    await expect(oldRequest).resolves.toBeTruthy();
    await expect(getMapXLegend("MX-NEXT")).resolves.toBeTruthy();
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
