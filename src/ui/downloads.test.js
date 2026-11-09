import { afterEach, describe, expect, it, vi } from "vitest";
import { REGION_CODE_SOURCES } from "../config/downloads.js";
import { createLayerRegistry } from "../config/registry.js";
import { createDownloads } from "./downloads.js";

const layer = {
  id: "MX-VEC",
  key: "vec",
  label: "Vector",
  type: "vt",
  geometry: "point",
  csvDownload: "yes",
};
const registry = createLayerRegistry([{ id: "t", label: "T", layers: [layer] }]);

const REFERENCE = "MX-NAMES";
const REFERENCE_ROWS = [
  { j0_x: null, iso3cd: "CCA", maplab: "Region A", gid: 1 },
  { j0_x: null, iso3cd: "CCB", maplab: "Region B", gid: 2 },
];

/** A Storage stand-in. */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
}

function setup({
  ready = true,
  canLoad = true,
  rows = [{ j0_v: 1, iso3cd: "CCA", maplab: "Region A", gid: 1 }],
  reference = async () => REFERENCE_ROWS,
  storage = memoryStorage(),
  read = null,
} = {}) {
  let isReady = ready;
  let canLoadMap = canLoad;
  const listeners = new Set();
  const save = vi.fn();
  const openMap = vi.fn();
  const temporary = [];
  const sdk = {
    ask: vi.fn(async (method, params) => {
      if (method !== "get_view_table_attribute") return true;
      if (read) return read(params);
      return params.idView === REFERENCE ? reference() : rows;
    }),
  };
  const downloads = createDownloads({
    registry,
    isViewWanted: () => false,
    isViewLoaded: () => false,
    onTemporaryView: (active) => temporary.push(active),
    isReady: () => isReady,
    canLoadMap: () => canLoadMap,
    openMap,
    onReadyChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSdk: () => sdk,
    viewerUrl: () => "https://viewer.example/",
    save,
    storage,
    now: () => new Date("2026-11-04T00:00:00Z"),
    readyTimeoutMs: 1000,
    regionNameView: REFERENCE,
  });
  const becomeReady = () => {
    isReady = true;
    canLoadMap = true;
    for (const fn of [...listeners]) fn(true);
  };
  return { downloads, save, sdk, becomeReady, listeners, openMap, temporary, storage };
}

const dialogEl = () => document.querySelector("dialog.download-dialog");
const dialogState = () => dialogEl()?.dataset.state;
const statusText = () => dialogEl().querySelector('[data-part="status"]').textContent;
const noticeEl = () => dialogEl().querySelector('[data-part="notice"]');
const methods = (sdk) => sdk.ask.mock.calls.map(([method, params]) => `${method}:${params?.idView}`);

describe("createDownloads", () => {
  let current;
  afterEach(() => {
    current?.downloads.destroy();
    current = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ignores views it cannot make a CSV for", () => {
    current = setup();
    expect(current.downloads.requestCsv("MX-UNKNOWN")).toBe(false);
    expect(dialogEl()).toBeNull();
  });

  it("borrows region codes from a sibling view on the same source, matched by gid", async () => {
    REGION_CODE_SOURCES.set("MX-VEC", "MX-SIB");
    try {
      current = setup({
        read: ({ idView }) => {
          if (idView === "MX-VEC")
            return [
              { j0_q5: 4, gid: 2 },
              { j0_q5: 3, gid: 1 },
            ];
          if (idView === "MX-SIB")
            return [
              { j0_q1: 0, iso3cd: "CCA", maplab: "Region A", gid: 1 },
              { j0_q1: 0, iso3cd: "xQZ", maplab: "Area Q", gid: 2 },
            ];
          return REFERENCE_ROWS;
        },
      });
      current.downloads.requestCsv("MX-VEC");
      await vi.waitFor(() => expect(dialogState()).toBe("done"));
      expect(methods(current.sdk)).toContain("get_view_table_attribute:MX-SIB");
      const [, csv] = current.save.mock.calls[0];
      expect(csv).toContain("region_code,region_name,Vector\r\nCCA,Region A,3\r\nxQZ,,4\r\n");
    } finally {
      REGION_CODE_SOURCES.delete("MX-VEC");
    }
  });

  it("fails, and saves nothing, when the sibling has rows but no region codes", async () => {
    REGION_CODE_SOURCES.set("MX-VEC", "MX-SIB");
    try {
      current = setup({
        read: ({ idView }) => (idView === "MX-VEC" ? [{ j0_q5: 4, gid: 1 }] : [{ j0_q1: 0, gid: 1 }]),
      });
      current.downloads.requestCsv("MX-VEC");
      await vi.waitFor(() => expect(dialogState()).toBe("error"));
      expect(statusText()).toMatch(/no region codes/);
      expect(current.save).not.toHaveBeenCalled();
    } finally {
      REGION_CODE_SOURCES.delete("MX-VEC");
    }
  });

  it("reads a sibling's codes once per session", async () => {
    REGION_CODE_SOURCES.set("MX-VEC", "MX-SIB");
    try {
      current = setup({
        read: ({ idView }) =>
          idView === "MX-VEC"
            ? [{ j0_q5: 4, gid: 1 }]
            : idView === "MX-SIB"
              ? [{ j0_q1: 0, iso3cd: "CCA", maplab: "Region A", gid: 1 }]
              : REFERENCE_ROWS,
      });
      current.downloads.requestCsv("MX-VEC");
      await vi.waitFor(() => expect(dialogState()).toBe("done"));
      current.downloads.dialog.close();
      current.downloads.requestCsv("MX-VEC");
      await vi.waitFor(() => expect(current.save).toHaveBeenCalledTimes(2));
      const siblingReads = methods(current.sdk).filter((call) => call === "get_view_table_attribute:MX-SIB");
      expect(siblingReads).toHaveLength(1);
    } finally {
      REGION_CODE_SOURCES.delete("MX-VEC");
    }
  });

  it("fails rather than guess when the sibling's rows do not match", async () => {
    REGION_CODE_SOURCES.set("MX-VEC", "MX-SIB");
    try {
      current = setup({
        read: ({ idView }) =>
          idView === "MX-VEC" ? [{ j0_q5: 4, gid: 9 }] : [{ j0_q1: 0, iso3cd: "CCA", gid: 1 }],
      });
      current.downloads.requestCsv("MX-VEC");
      await vi.waitFor(() => expect(dialogState()).toBe("error"));
      expect(statusText()).toMatch(/could not be matched/);
      expect(current.save).not.toHaveBeenCalled();
    } finally {
      REGION_CODE_SOURCES.delete("MX-VEC");
    }
  });

  it("waits for a map that is loading, then downloads <layer-key>_<view-id>.csv", async () => {
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
    expect(csv).toContain("#,Downloaded (UTC): 2026-11-04\r\n");
    expect(csv).toContain("#,Downloaded from: https://viewer.example/\r\n");
    expect(csv).toContain("region_code,region_name,Vector\r\nCCA,Region A,1\r\n");
    expect(current.listeners.size).toBe(0);
    // The temporary add of the target view was bracketed for the map mask.
    expect(current.temporary).toEqual([true, false]);
  });

  it("fails at once, offering to open the map, where the map cannot start (narrow screens)", async () => {
    vi.useFakeTimers();
    current = setup({ ready: false, canLoad: false });
    current.downloads.requestCsv("MX-VEC");
    await vi.advanceTimersByTimeAsync(10);
    expect(dialogState()).toBe("error");
    expect(statusText()).toMatch(/map has not started yet/);
    expect(current.sdk.ask).not.toHaveBeenCalled();
    const open = dialogEl().querySelector('[data-action="extra"]');
    expect(open.hidden).toBe(false);
    expect(open.textContent).toBe("Open the map");
    open.click();
    expect(current.openMap).toHaveBeenCalledWith("t");
    expect(dialogEl().hasAttribute("open")).toBe(false);
  });

  it("explains a map that never became ready while loading, and retries", async () => {
    vi.useFakeTimers();
    current = setup({ ready: false });
    current.downloads.requestCsv("MX-VEC");
    await vi.advanceTimersByTimeAsync(1000);
    expect(dialogState()).toBe("error");
    expect(statusText()).toMatch(/did not finish loading/);
    current.becomeReady();
    dialogEl().querySelector('[data-action="retry"]').click();
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
    // No names are read for a table that has none to name.
    expect(methods(current.sdk).some((call) => call.endsWith(REFERENCE))).toBe(false);
  });

  it("reads reference names once and keeps them in storage for later sessions", async () => {
    const storage = memoryStorage();
    const rows = [
      { j0_v: 3, iso3cd: "CCB", name_en: "Local#Name", gid: 2 },
      { j0_v: 1, iso3cd: "CCA", name_en: "Local#Name", gid: 1 },
      { j0_v: 2, iso3cd: "CCD", name_en: "Local#Name", gid: 3 },
    ];
    current = setup({ rows, storage });
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(dialogState()).toBe("done"));
    expect(current.save.mock.calls[0][1]).toContain(
      "region_code,region_name,Vector\r\nCCA,Region A,1\r\nCCB,Region B,3\r\nCCD,,2\r\n",
    );
    // CCD has no name in the map service: reported quietly, in the file and the dialog.
    expect(current.save.mock.calls[0][1]).toContain(
      "#,Region names: UN map labels as published in MapX. 1 of 3 regions have no name in the map service; their region_name is blank.\r\n",
    );
    expect(noticeEl().hidden).toBe(false);
    expect(noticeEl().textContent).toBe(
      "1 of 3 regions have no name in the map service, so their region_name is blank.",
    );
    expect(dialogEl().querySelector('[data-action="retry"]').hidden).toBe(true);
    expect(methods(current.sdk).filter((call) => call.endsWith(REFERENCE))).toHaveLength(3); // add, read, remove

    // A new instance (a later page load) uses the stored names: no reference add.
    current.downloads.destroy();
    current = setup({ rows, storage });
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(dialogState()).toBe("done"));
    expect(methods(current.sdk).some((call) => call.endsWith(REFERENCE))).toBe(false);
    expect(current.save.mock.calls[0][1]).toContain("CCA,Region A,1");
  });

  it("downloads with blank names when the reference cannot be read, and says so", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    current = setup({
      rows: [{ j0_v: 1, iso3cd: "CCA", name_en: "Local#Name", gid: 1 }],
      reference: async () => Promise.reject(new Error("down")),
    });
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(dialogState()).toBe("done"));
    const csv = current.save.mock.calls[0][1];
    expect(csv).toContain("region_code,region_name,Vector\r\nCCA,,1\r\n");
    expect(csv).toMatch(/#,Region names: Not available/);
    expect(noticeEl().hidden).toBe(false);
    expect(noticeEl().textContent).toMatch(/Region names could not be loaded/);
    expect(dialogEl().querySelector('[data-action="retry"]').hidden).toBe(false);
  });

  it("stops making MapX calls once the dialog is closed mid-fetch", async () => {
    let releaseRead;
    const rows = [{ j0_v: 1, iso3cd: "CCA", name_en: "Local#Name", gid: 1 }];
    current = setup({
      read: (params) =>
        params.idView === "MX-VEC"
          ? new Promise((resolve) => (releaseRead = () => resolve(rows)))
          : REFERENCE_ROWS,
    });
    current.downloads.requestCsv("MX-VEC");
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf("function"));
    expect(methods(current.sdk)).toEqual(["view_add:MX-VEC", "get_view_table_attribute:MX-VEC"]);
    current.downloads.dialog.close();
    releaseRead();
    await vi.waitFor(() => expect(current.temporary).toEqual([true, false]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Only the removal of the view it had added; no reference names, no file.
    expect(methods(current.sdk)).toEqual([
      "view_add:MX-VEC",
      "get_view_table_attribute:MX-VEC",
      "view_remove:MX-VEC",
    ]);
    expect(current.save).not.toHaveBeenCalled();
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

describe("large-file confirmation", () => {
  let downloads;
  afterEach(() => {
    downloads?.destroy();
    downloads = null;
    document.body.innerHTML = "";
  });

  function build() {
    const startFileDownload = vi.fn();
    downloads = createDownloads({
      registry,
      isViewWanted: () => false,
      isViewLoaded: () => false,
      isReady: () => true,
      onReadyChange: () => () => {},
      getSdk: () => ({ ask: vi.fn() }),
      startFileDownload,
    });
    document.body.innerHTML = `
      <div id="panel">
        <a class="layer-downloads__link" id="big" href="https://files.example/big.tif" download="big.tif" data-bytes="3601777774" data-large="">Download big.tif</a>
        <a class="layer-downloads__link" id="small" href="https://files.example/small.tif" download="small.tif" data-bytes="1000">Download small.tif</a>
      </div>`;
    document.getElementById("panel").addEventListener("click", downloads.handleClick);
    document.getElementById("panel").addEventListener("auxclick", downloads.handleClick);
    return { startFileDownload };
  }

  const click = (el) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event;
  };
  const dialogEl = () => document.querySelector("dialog.download-dialog");

  it("asks before a file over 1 GB and downloads it only when confirmed", async () => {
    const { startFileDownload } = build();
    const event = click(document.getElementById("big"));
    expect(event.defaultPrevented).toBe(true);
    expect(dialogEl().dataset.state).toBe("confirm");
    expect(dialogEl().querySelector('[data-part="status"]').textContent).toContain("big.tif is 3.6 GB");
    expect(startFileDownload).not.toHaveBeenCalled();
    expect(dialogEl().querySelector(".download-dialog__url").value).toBe("https://files.example/big.tif");
    expect(dialogEl().querySelector(".download-dialog__file").hidden).toBe(false);
    dialogEl().querySelector('[data-action="extra"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(startFileDownload).toHaveBeenCalledWith("https://files.example/big.tif", "big.tif");
  });

  it("does not download when the confirmation is cancelled", async () => {
    const { startFileDownload } = build();
    click(document.getElementById("big"));
    dialogEl().querySelector('.download-dialog__actions [data-action="close"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(startFileDownload).not.toHaveBeenCalled();
  });

  it("asks on a middle click too (auxclick), and ignores other buttons", () => {
    const { startFileDownload } = build();
    const middle = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    document.getElementById("big").dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(dialogEl().dataset.state).toBe("confirm");
    expect(startFileDownload).not.toHaveBeenCalled();
    downloads.dialog.close();
    const right = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
    document.getElementById("big").dispatchEvent(right);
    expect(right.defaultPrevented).toBe(false);
    const smallMiddle = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    document.getElementById("small").dispatchEvent(smallMiddle);
    expect(smallMiddle.defaultPrevented).toBe(false);
  });

  it("starts a confirmed download in a new tab, so the viewer's tab is never replaced", async () => {
    downloads = createDownloads({
      registry,
      isViewWanted: () => false,
      isViewLoaded: () => false,
      isReady: () => true,
      onReadyChange: () => () => {},
      getSdk: () => ({ ask: vi.fn() }),
    });
    document.body.innerHTML = `<div id="panel"><a class="layer-downloads__link" id="big" href="https://files.example/big.tif" download="big.tif" data-bytes="3601777774" data-large="">Download big.tif</a></div>`;
    document.getElementById("panel").addEventListener("click", downloads.handleClick);
    const opened = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      opened.push([this.href, this.target, this.rel, this.download]);
    });
    click(document.getElementById("big"));
    dialogEl().querySelector('[data-action="extra"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    spy.mockRestore();
    expect(opened).toEqual([["https://files.example/big.tif", "_blank", "noopener", "big.tif"]]);
  });

  it("leaves smaller files to the browser, with no dialog", () => {
    const { startFileDownload } = build();
    const event = click(document.getElementById("small"));
    expect(event.defaultPrevented).toBe(false);
    expect(dialogEl()?.hasAttribute("open") ?? false).toBe(false);
    expect(startFileDownload).not.toHaveBeenCalled();
  });
});
