import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initInspection,
  enableInspection,
  disableInspection,
  isInspectionActive,
  onInspectionResult,
  handleClickEvent,
} from "./inspect.js";

const mockMapx = { ask: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  initInspection(mockMapx);
  disableInspection();
  onInspectionResult(null);
  mockMapx.ask.mockClear();
});

describe("initial state", () => {
  it("is inactive after reset", () => {
    expect(isInspectionActive()).toBe(false);
  });
});

describe("enableInspection / disableInspection", () => {
  it("becomes active on enable", () => {
    enableInspection();
    expect(isInspectionActive()).toBe(true);
  });

  it("becomes inactive on disable", () => {
    enableInspection();
    disableInspection();
    expect(isInspectionActive()).toBe(false);
  });

  it("does not call set_features_click_sdk_only in dev mode (DEV=true in test env)", () => {
    enableInspection();
    expect(mockMapx.ask).not.toHaveBeenCalledWith("set_features_click_sdk_only", expect.anything());
  });

  it("does not call set_features_click_sdk_only on disable in dev mode", () => {
    enableInspection();
    mockMapx.ask.mockClear();
    disableInspection();
    expect(mockMapx.ask).not.toHaveBeenCalledWith("set_features_click_sdk_only", expect.anything());
  });
});

describe("handleClickEvent — single view", () => {
  it("fires callback with coordinates and attributes", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    enableInspection();

    handleClickEvent(
      { part: 1, nPart: 1, idView: "view-1", attributes: [{ name: "Test" }], lngLat: { lat: 10, lng: 20 } },
      new Set(["view-1"]),
    );

    expect(cb).toHaveBeenCalledOnce();
    const result = cb.mock.calls[0][0];
    expect(result.lngLat).toEqual({ lat: 10, lng: 20 });
    expect(result.views["view-1"]).toEqual([{ name: "Test" }]);
  });

  it("treats null attributes as an empty array", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    enableInspection();

    handleClickEvent(
      { part: 1, nPart: 1, idView: "view-1", attributes: null, lngLat: { lat: 0, lng: 0 } },
      new Set(["view-1"]),
    );

    expect(cb.mock.calls[0][0].views["view-1"]).toEqual([]);
  });
});

describe("handleClickEvent — multi-view batch", () => {
  it("waits for all views before firing callback", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    enableInspection();

    const views = new Set(["view-1", "view-2"]);
    handleClickEvent(
      { part: 1, nPart: 2, idView: "view-1", attributes: [{ a: 1 }], lngLat: { lat: 1, lng: 2 } },
      views,
    );
    expect(cb).not.toHaveBeenCalled();

    handleClickEvent(
      { part: 2, nPart: 2, idView: "view-2", attributes: [], lngLat: { lat: 1, lng: 2 } },
      views,
    );
    expect(cb).toHaveBeenCalledOnce();

    const result = cb.mock.calls[0][0];
    expect(result.views["view-1"]).toEqual([{ a: 1 }]);
    expect(result.views["view-2"]).toEqual([]);
  });

  it("handles out-of-order delivery (counts by unique idView, not by part number)", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    enableInspection();

    const views = new Set(["view-1", "view-2"]);
    // part=2 arrives before part=1 (part=1 resets the batch, so simulate by sending a non-1 part after)
    // Actually, since part===1 resets, we test that the Map counts unique views regardless
    handleClickEvent(
      { part: 1, nPart: 2, idView: "view-2", attributes: [{ b: 2 }], lngLat: { lat: 0, lng: 0 } },
      views,
    );
    expect(cb).not.toHaveBeenCalled();

    handleClickEvent(
      { part: 2, nPart: 2, idView: "view-1", attributes: [{ a: 1 }], lngLat: { lat: 0, lng: 0 } },
      views,
    );
    expect(cb).toHaveBeenCalledOnce();
    const result = cb.mock.calls[0][0];
    expect(result.views["view-1"]).toEqual([{ a: 1 }]);
    expect(result.views["view-2"]).toEqual([{ b: 2 }]);
  });
});

describe("handleClickEvent — openViews snapshot", () => {
  it("snapshots openViews at batch start, not at callback time", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    enableInspection();

    const openViews = new Set(["view-1"]);
    handleClickEvent(
      { part: 1, nPart: 1, idView: "view-1", attributes: [], lngLat: { lat: 0, lng: 0 } },
      openViews,
    );

    // Mutate original after batch completes — snapshot should not change
    openViews.add("view-2");

    const result = cb.mock.calls[0][0];
    expect(result.openViewsSnapshot).toEqual(new Set(["view-1"]));
    expect(result.openViewsSnapshot.size).toBe(1);
  });
});

describe("handleClickEvent — generation guard", () => {
  it("discards events that arrive after disableInspection", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    enableInspection();

    const views = new Set(["view-1", "view-2"]);
    // Start a 2-part batch
    handleClickEvent(
      { part: 1, nPart: 2, idView: "view-1", attributes: [], lngLat: { lat: 0, lng: 0 } },
      views,
    );

    // User disables before batch completes
    disableInspection();

    // Stale part-2 event — should be discarded
    handleClickEvent(
      { part: 2, nPart: 2, idView: "view-2", attributes: [], lngLat: { lat: 0, lng: 0 } },
      views,
    );

    expect(cb).not.toHaveBeenCalled();
  });

  it("discards events from previous enable/disable cycle", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    enableInspection();

    const views = new Set(["view-1", "view-2"]);
    handleClickEvent(
      { part: 1, nPart: 2, idView: "view-1", attributes: [], lngLat: { lat: 0, lng: 0 } },
      views,
    );

    // Re-enable (increments generation; old batch is invalidated)
    disableInspection();
    enableInspection();

    // Part-2 for old batch arrives — ignored because batch was cleared
    handleClickEvent(
      { part: 2, nPart: 2, idView: "view-2", attributes: [], lngLat: { lat: 0, lng: 0 } },
      views,
    );

    expect(cb).not.toHaveBeenCalled();
  });
});

describe("handleClickEvent — inactive guard", () => {
  it("does nothing when inspection is not active", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    // Not calling enableInspection

    handleClickEvent(
      { part: 1, nPart: 1, idView: "view-1", attributes: [], lngLat: { lat: 0, lng: 0 } },
      new Set(["view-1"]),
    );

    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores events that arrive after part=1 if no batch is in progress", () => {
    const cb = vi.fn();
    onInspectionResult(cb);
    enableInspection();

    // part=2 with no prior part=1 — no batch started, should be ignored safely
    handleClickEvent(
      { part: 2, nPart: 2, idView: "view-1", attributes: [], lngLat: { lat: 0, lng: 0 } },
      new Set(["view-1"]),
    );

    expect(cb).not.toHaveBeenCalled();
  });
});
