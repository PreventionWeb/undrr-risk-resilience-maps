import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableError, fetchViewTable } from "./table.js";

const ROWS = [{ j0_v: 1, iso3cd: "AAA", maplab: "Region A", gid: 1 }];

/**
 * A fake SDK whose methods are per-test handlers; every call is logged as
 * `method` (and its params) in order.
 */
function fakeSdk(handlers = {}) {
  const calls = [];
  const sdk = {
    calls,
    ask: vi.fn((method, params) => {
      calls.push([method, params]);
      const handler = handlers[method];
      return handler ? handler(params) : Promise.resolve(true);
    }),
  };
  return sdk;
}

describe("fetchViewTable", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads a loaded view directly, without adding or removing it", async () => {
    const sdk = fakeSdk({ get_view_table_attribute: async () => ROWS });
    const rows = await fetchViewTable(sdk, "MX-1", { isLoaded: () => true, isWanted: () => true });
    expect(rows).toBe(ROWS);
    expect(sdk.calls.map(([method]) => method)).toEqual(["get_view_table_attribute"]);
  });

  it("adds an unloaded view without moving the camera, reads it, then removes it", async () => {
    const sdk = fakeSdk({ get_view_table_attribute: async () => ROWS });
    const onLoaded = vi.fn();
    const rows = await fetchViewTable(sdk, "MX-1", { onLoaded });
    expect(rows).toBe(ROWS);
    expect(sdk.calls).toEqual([
      ["view_add", { idView: "MX-1", zoomToView: false }],
      ["get_view_table_attribute", { idView: "MX-1" }],
      ["view_remove", { idView: "MX-1" }],
    ]);
    expect(onLoaded).toHaveBeenCalledWith("MX-1");
  });

  it("leaves the view on the map when a layer wanted it during the read", async () => {
    let wanted = false;
    const sdk = fakeSdk({
      get_view_table_attribute: async () => {
        wanted = true; // the user turned the layer on meanwhile
        return ROWS;
      },
    });
    await fetchViewTable(sdk, "MX-1", { isWanted: () => wanted });
    expect(sdk.calls.map(([method]) => method)).not.toContain("view_remove");
  });

  it("still removes the temporary view when the read fails", async () => {
    const sdk = fakeSdk({ get_view_table_attribute: async () => Promise.reject(new Error("boom")) });
    const error = await fetchViewTable(sdk, "MX-1").catch((e) => e);
    expect(error).toBeInstanceOf(TableError);
    expect(error.code).toBe("failed");
    expect(error.message).not.toMatch(/MX-1|get_view/);
    expect(sdk.calls.at(-1)).toEqual(["view_remove", { idView: "MX-1" }]);
  });

  it("falls back to a temporary add when a previously loaded view no longer answers", async () => {
    let reads = 0;
    const sdk = fakeSdk({
      get_view_table_attribute: async () => {
        reads++;
        if (reads === 1) throw new Error("Cannot read properties of undefined (reading 'type')");
        return ROWS;
      },
    });
    const rows = await fetchViewTable(sdk, "MX-1", { isLoaded: () => true, isWanted: () => false });
    expect(rows).toBe(ROWS);
    expect(sdk.calls.map(([method]) => method)).toEqual([
      "get_view_table_attribute",
      "view_add",
      "get_view_table_attribute",
      "view_remove",
    ]);
  });

  it("does not add a view that is on the map when its read fails", async () => {
    const sdk = fakeSdk({ get_view_table_attribute: async () => Promise.reject(new Error("boom")) });
    await expect(fetchViewTable(sdk, "MX-1", { isLoaded: () => true, isWanted: () => true })).rejects.toThrow(
      TableError,
    );
    expect(sdk.calls.map(([method]) => method)).toEqual(["get_view_table_attribute"]);
  });

  it("rejects a response that is not a list of rows", async () => {
    const sdk = fakeSdk({ get_view_table_attribute: async () => ({ rows: [] }) });
    const error = await fetchViewTable(sdk, "MX-1").catch((e) => e);
    expect(error.code).toBe("bad-response");
  });

  it("times out a read that never answers", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk({ get_view_table_attribute: () => new Promise(() => {}) });
    const pending = fetchViewTable(sdk, "MX-1", { isLoaded: () => true, timeouts: { table: 1000 } }).catch(
      (e) => e,
    );
    await vi.advanceTimersByTimeAsync(1000);
    // Not wanted: the loaded view is retried through an add, which also hangs on its read.
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;
    expect(error).toBeInstanceOf(TableError);
    expect(error.code).toBe("timeout");
  });

  it("removes a view whose add lands after the deadline", async () => {
    vi.useFakeTimers();
    let land;
    const sdk = fakeSdk({ view_add: () => new Promise((resolve) => (land = resolve)) });
    const pending = fetchViewTable(sdk, "MX-1", { timeouts: { add: 1000 } }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).code).toBe("timeout");
    expect(sdk.calls.map(([method]) => method)).toEqual(["view_add"]);
    land(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.calls.map(([method]) => method)).toEqual(["view_add", "view_remove"]);
  });

  it("treats view_add answering false as a failure", async () => {
    const sdk = fakeSdk({ view_add: async () => false });
    const error = await fetchViewTable(sdk, "MX-1").catch((e) => e);
    expect(error.code).toBe("failed");
    expect(sdk.calls.map(([method]) => method)).toEqual(["view_add"]);
  });
});
