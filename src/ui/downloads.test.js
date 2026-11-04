import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayerRegistry } from "../config/registry.js";
import { createDownloads } from "./downloads.js";

const layer = { id: "MX-VEC", key: "vec", label: "Vector", type: "vt", geometry: "point" };
const registry = createLayerRegistry([{ id: "t", label: "T", layers: [layer] }]);

const REFERENCE = "MX-NAMES";
const REFERENCE_ROWS = [
  { j0_x: null, iso3cd: "AAA", maplab: "Region A", gid: 1 },
  { j0_x: null, iso3cd: "BBB", maplab: "Region B", gid: 2 },
];

function setup({
  ready = true,
  rows = [{ j0_v: 1, iso3cd: "AAA", maplab: "Region A", gid: 1 }],
  reference = async () => REFERENCE_ROWS,
} = {}) {
  let isReady = ready;
  const listeners = new Set();
  const save = vi.fn();
  const sdk = {
    ask: vi.fn(async (method, params) => {
      if (method !== "get_view_table_attribute") return true;
      return params.idView === REFERENCE ? reference() : rows;
    }),
  };
  const downloads = createDownloads({
    registry,
    isViewWanted: () => false,
    isViewLoaded: () => false,
    isReady: () => isReady,
    onReadyChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSdk: () => sdk,
    save,
    now: () => new Date("2026-11-04T00:00:00Z"),
    readyTimeoutMs: 1000,
    regionNameView: REFERENCE,
  });
  const becomeReady = () => {
    isReady = true;
    for (const fn of [...listeners]) fn(true);
  };
  return { downloads, save, sdk, becomeReady, listeners };
}

const dialogState = () => document.querySelector("dialog.download-dialog")?.dataset.state;
const statusText = () => document.querySelector('dialog [data-part="status"]').textContent;

describe("createDownloads", () => {
  let current;
  afterEach(() => {
    current?.downloads.destroy();
    vi.useRealTimers();
  });

  it("ignores views it cannot make a CSV for", () => {
    current = setup();
    expect(current.downloads.requestCsv("MX-UNKNOWN")).toBe(false);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("waits for the map to be ready, then downloads <layer-key>_<view-id>.csv", async () => {
    vi.useFakeTimers();
    current = setup({ ready: false });
    expect(current.downloads.requestCsv("MX-VEC")).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(dialogState()).toBe("fetching");
    expect(current.sdk.ask).not.toHaveBeenCalled();
    current.becomeReady();
    await vi.advanceTimersByTimeAsync(10);
    expect(dialogState()).toBe("done");
    const [, csv, filename] = current.save.mock.calls[0];
    expect(filename).toBe("vec_MX-VEC.csv");
    expect(csv).toContain("# Downloaded: 2026-11-04\r\n");
    expect(csv).toContain("iso3,region_name,Vector\r\nAAA,Region A,1\r\n");
    expect(current.listeners.size).toBe(0);
  });

  it("explains a map that never became ready, and retries", async () => {
    vi.useFakeTimers();
    current = setup({ ready: false });
    current.downloads.requestCsv("MX-VEC");
    await vi.advanceTimersByTimeAsync(1000);
    expect(dialogState()).toBe("error");
    expect(statusText()).toMatch(/map service has not finished loading/);
    current.becomeReady();
    document.querySelector('dialog [data-action="retry"]').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(dialogState()).toBe("done");
  });

  it("shows why a table without region codes cannot be exported", async () => {
    current = setup({ rows: [{ j0_v: 1, gid: 1 }] });
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(dialogState()).toBe("error"));
    expect(statusText()).toBe(
      "This layer's data has no region codes, so it cannot be exported as a values-only CSV.",
    );
    expect(current.save).not.toHaveBeenCalled();
  });

  it("takes region names from the reference view once, for tables without maplab", async () => {
    current = setup({
      rows: [
        { j0_v: 3, iso3cd: "BBB", name_en: "Local#Name", gid: 2 },
        { j0_v: 1, iso3cd: "AAA", name_en: "Local#Name", gid: 1 },
        { j0_v: 2, iso3cd: "DDD", name_en: "Local#Name", gid: 3 },
      ],
    });
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(dialogState()).toBe("done"));
    expect(current.save.mock.calls[0][1]).toContain(
      "iso3,region_name,Vector\r\nAAA,Region A,1\r\nBBB,Region B,3\r\nDDD,,2\r\n",
    );
    current.downloads.dialog.close();
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(current.save).toHaveBeenCalledTimes(2));
    const referenceReads = current.sdk.ask.mock.calls.filter(
      ([method, params]) => method === "get_view_table_attribute" && params.idView === REFERENCE,
    );
    expect(referenceReads).toHaveLength(1);
  });

  it("still downloads, with blank names, when the reference view cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    current = setup({
      rows: [{ j0_v: 1, iso3cd: "AAA", name_en: "Local#Name", gid: 1 }],
      reference: async () => Promise.reject(new Error("down")),
    });
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(dialogState()).toBe("done"));
    expect(current.save.mock.calls[0][1]).toContain("iso3,region_name,Vector\r\nAAA,,1\r\n");
    vi.restoreAllMocks();
  });

  it("does not read names for a table that has none to name", async () => {
    current = setup({ rows: [{ j0_v: 1, gid: 1 }] });
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(dialogState()).toBe("error"));
    expect(current.sdk.ask.mock.calls.some(([, params]) => params?.idView === REFERENCE)).toBe(false);
  });

  it("starts from a delegated click on a Download CSV button", async () => {
    current = setup();
    document.body.innerHTML =
      '<button data-action="download-csv" data-view-id="MX-VEC"><span>CSV</span></button>';
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("span").dispatchEvent(event);
    current.downloads.handleClick(event);
    await vi.waitFor(() => expect(dialogState()).toBe("done"));
    expect(event.defaultPrevented).toBe(true);
  });
});
