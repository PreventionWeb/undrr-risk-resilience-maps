import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rasters from "../../tests/fixtures/legends/representative-geoserver.json";
import views from "../../tests/fixtures/legends/representative-mapx-views.json";
import { webcrypto } from "node:crypto";
const mocks = vi.hoisted(() => ({ sdk: { ask: vi.fn() } }));
vi.mock("./client.js", () => ({ getSDK: () => mocks.sdk }));
import {
  getMapXLegend,
  resolveParsedMapXLegend,
  resetMapXLegendCache,
  resolveMapXLegend,
  LEGEND_TIMEOUT_MS,
} from "./legends.js";

function vector(idView = "MX-TEST") {
  return {
    idView,
    type: "vt",
    provider: "mapx",
    supported: true,
    data: {
      title: "Risk level",
      geometry: "polygon",
      attribute: { name: "risk", type: "number" },
      rules: [
        {
          color: "#fff",
          opacity: 0.7,
          size: 1,
          value: 0,
          value_to: 10,
          label: "Low",
          labels: { en: "Low", fr: "Faible" },
          sprite: null,
          color_border: null,
        },
        {
          color: "#123456",
          opacity: 1,
          size: 2,
          value: 10,
          value_to: 20,
          label: "10–20",
          labels: {},
          sprite: null,
          color_border: "#000",
        },
        {
          color: "#ccc",
          opacity: 0,
          size: 1,
          value: null,
          value_to: null,
          label: "No data",
          labels: { en: "No data" },
          sprite: null,
          color_border: null,
        },
      ],
    },
  };
}
beforeEach(() => {
  mocks.sdk = { ask: vi.fn() };
  resetMapXLegendCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("official legend provider adapters", () => {
  it("preserves order, localized labels, explicit ranges, borders, sizes and visible null rules", () => {
    const result = resolveParsedMapXLegend(vector(), "MX-TEST", "fr");
    expect(result.legend).toEqual({
      title: "Risk level",
      entries: [
        { color: "#fff", label: "Faible", opacity: 0.7, size: 1, geometry: "polygon", borderColor: null },
        { color: "#123456", label: "10–20", opacity: 1, size: 2, geometry: "polygon", borderColor: "#000" },
        { color: "#ccc", label: "No data", opacity: 0, size: 1, geometry: "polygon", borderColor: null },
      ],
    });
  });
  it.each(["point", "line", "polygon"])("preserves %s symbols", (geometry) => {
    const result = vector();
    result.data.geometry = geometry;
    expect(resolveParsedMapXLegend(result, result.idView).legend.entries[0].geometry).toBe(geometry);
  });
  it("retains zero/boolean value labels when the SDK has no text label", () => {
    const result = vector();
    result.data.rules = [
      { color: "red", value: 0 },
      { color: "blue", value: false },
    ];
    expect(resolveParsedMapXLegend(result, result.idView).legend.entries.map((e) => e.label)).toEqual([
      "0",
      "false",
    ]);
  });
  it.each([
    ["wrong view", (r) => (r.idView = "other")],
    ["missing support flag", (r) => delete r.supported],
    ["wrong provider", (r) => (r.provider = "geoserver")],
    ["unknown geometry", (r) => (r.data.geometry = "collection")],
    ["missing rules", (r) => (r.data.rules = null)],
    ["empty rules", (r) => (r.data.rules = [])],
    ["too many rules", (r) => (r.data.rules = Array(501).fill(r.data.rules[0]))],
    ["oversized envelope", (r) => (r.extra = "x".repeat(256 * 1024))],
    ["unsafe color", (r) => (r.data.rules[0].color = "url(evil)")],
    ["unsafe border", (r) => (r.data.rules[0].color_border = "url(evil)")],
    ["sprite", (r) => (r.data.rules[0].sprite = "airport")],
    ["invalid opacity", (r) => (r.data.rules[0].opacity = 2)],
    ["coerced opacity", (r) => (r.data.rules[0].opacity = false)],
    ["invalid size", (r) => (r.data.rules[0].size = -1)],
    ["unsafe title", (r) => (r.data.title = "x".repeat(201))],
    [
      "invalid label",
      (r) => {
        r.data.rules[0].labels = {};
        r.data.rules[0].label = {};
        r.data.rules[0].value = {};
      },
    ],
  ])("fails closed on %s", (_label, mutate) => {
    const result = vector();
    mutate(result);
    expect(resolveParsedMapXLegend(result, "MX-TEST").legend).toBeNull();
  });
  it.each([
    "no_legend",
    "unsupported_provider",
    "custom_style",
    "fetch_failed",
    "invalid_response",
    "unsupported_view_type",
  ])("propagates unsupported reason %s", (reason) => {
    expect(
      resolveParsedMapXLegend({ idView: "MX-TEST", type: "rt", supported: false, reason }, "MX-TEST"),
    ).toEqual({ legend: null, reason: reason.replaceAll("_", "-") });
  });
  it("rejects unknown reasons", () => {
    expect(
      resolveParsedMapXLegend(
        { idView: "MX-TEST", type: "rt", supported: false, reason: "surprise" },
        "MX-TEST",
      ).legend,
    ).toBeNull();
  });
  it("accepts all recorded discrete, ramp and grouped GeoServer schemas through the official envelope", () => {
    for (const [idView, data] of Object.entries(rasters)) {
      const result = resolveParsedMapXLegend(
        { idView, type: "rt", provider: "geoserver", supported: true, data },
        idView,
      );
      expect(result.legend, idView).toBeTruthy();
      expect(result.transport).toBe("mapx-sdk");
    }
  });
  it("rejects malformed raster data", () => {
    expect(
      resolveParsedMapXLegend(
        { idView: "MX-TEST", type: "rt", provider: "geoserver", supported: true, data: { Legend: [] } },
        "MX-TEST",
      ).legend,
    ).toBeNull();
  });
});

describe("SDK requests and manager lifecycle", () => {
  it("shares concurrent requests and caches success without reading the catalogue or fetching providers", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mocks.sdk.ask.mockResolvedValue(vector());
    await Promise.all([getMapXLegend("MX-TEST"), getMapXLegend("MX-TEST")]);
    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();
    expect(mocks.sdk.ask).toHaveBeenCalledExactlyOnceWith("get_view_legend_json", { idView: "MX-TEST" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not cache failures, allowing a view added later to recover", async () => {
    mocks.sdk.ask.mockRejectedValueOnce(new Error("missing view")).mockResolvedValue(vector());
    await expect(getMapXLegend("MX-TEST")).resolves.toBeNull();
    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();
    expect(mocks.sdk.ask).toHaveBeenCalledTimes(2);
  });
  it("does not cache unsupported or malformed responses", async () => {
    mocks.sdk.ask.mockResolvedValueOnce({}).mockResolvedValue(vector());
    await expect(getMapXLegend("MX-TEST")).resolves.toBeNull();
    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();
  });
  it("bounds hung requests and permits retry after timeout", async () => {
    vi.useFakeTimers();
    mocks.sdk.ask.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(vector());
    const pending = resolveMapXLegend("MX-TEST");
    await vi.advanceTimersByTimeAsync(LEGEND_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ legend: null, reason: "sdk-unavailable" });
    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();
  });
  it("does not let an old timed-out response overwrite a retry", async () => {
    vi.useFakeTimers();
    let release;
    mocks.sdk.ask
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(vector());
    const old = getMapXLegend("MX-TEST");
    await vi.advanceTimersByTimeAsync(LEGEND_TIMEOUT_MS);
    await old;
    await getMapXLegend("MX-TEST");
    release({});
    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();
    expect(mocks.sdk.ask).toHaveBeenCalledTimes(2);
  });
  it("limits restored-layer bursts to two SDK requests while sharing duplicate views", async () => {
    const releases = [];
    mocks.sdk.ask.mockImplementation(
      (_method, { idView }) =>
        new Promise((resolve) => {
          releases.push(() => resolve(vector(idView)));
        }),
    );
    const pending = ["MX-A", "MX-B", "MX-C", "MX-A"].map((id) => getMapXLegend(id));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(mocks.sdk.ask).toHaveBeenCalledTimes(2);
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[1]();
    releases[2]();
    expect((await Promise.all(pending)).every(Boolean)).toBe(true);
    expect(mocks.sdk.ask).toHaveBeenCalledTimes(3);
  });

  it("expires queued calls without sending them or releasing hung SDK slots", async () => {
    vi.useFakeTimers();
    mocks.sdk.ask.mockImplementation(() => new Promise(() => {}));
    const pending = ["MX-A", "MX-B", "MX-C"].map((id) => getMapXLegend(id));
    await vi.advanceTimersByTimeAsync(LEGEND_TIMEOUT_MS);
    expect(await Promise.all(pending)).toEqual([null, null, null]);
    expect(mocks.sdk.ask).toHaveBeenCalledTimes(2);
    const retry = getMapXLegend("MX-C");
    await vi.advanceTimersByTimeAsync(LEGEND_TIMEOUT_MS);
    expect(await retry).toBeNull();
    expect(mocks.sdk.ask).toHaveBeenCalledTimes(2);
  });

  it("scopes caching by language", async () => {
    mocks.sdk.ask.mockResolvedValue(vector());
    await getMapXLegend("MX-TEST", "en");
    await getMapXLegend("MX-TEST", "fr");
    expect(mocks.sdk.ask).toHaveBeenCalledTimes(2);
  });
  it.each(["manager", "reset"])("isolates late failures from a replacement %s cache", async (kind) => {
    let rejectOld;
    mocks.sdk.ask.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    );
    const old = getMapXLegend("MX-TEST");
    await Promise.resolve();
    const nextAsk = vi.fn().mockResolvedValue(vector());
    if (kind === "manager") mocks.sdk = { ask: nextAsk };
    else {
      resetMapXLegendCache();
      mocks.sdk.ask.mockImplementation(nextAsk);
    }
    await getMapXLegend("MX-TEST");
    rejectOld(new Error("retired"));
    await old;
    await expect(getMapXLegend("MX-TEST")).resolves.toBeTruthy();
    expect(nextAsk).toHaveBeenCalledTimes(1);
  });
  it("keeps custom definitions guarded by the recorded methods hash", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const view = views.find((v) => v.type === "cc");
    mocks.sdk.ask.mockResolvedValue([view]);
    expect((await resolveMapXLegend(view.id)).legend).toBeTruthy();
    expect(mocks.sdk.ask).toHaveBeenCalledExactlyOnceWith("get_views", undefined);
    resetMapXLegendCache();
    mocks.sdk.ask.mockResolvedValue([{ ...view, data: { methods: view.data.methods + "\n" } }]);
    expect((await resolveMapXLegend(view.id)).legend).toBeNull();
  });
});
