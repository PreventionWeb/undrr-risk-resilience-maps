import { describe, expect, it } from "vitest";
import { createMemoryAdapter } from "./memory-adapter.js";

describe("createMemoryAdapter", () => {
  it("reads the state it was seeded with, normalised", () => {
    const adapter = createMemoryAdapter({
      initial: { tab: "hazard", layers: [{ key: "landslides" }, { key: "river-flooding", sourceIdx: 2 }] },
    });

    expect(adapter.read()).toEqual({
      tab: "hazard",
      layers: [
        { key: "landslides", sourceIdx: 0 },
        { key: "river-flooding", sourceIdx: 2 },
      ],
    });
  });

  it("starts empty with no seed", () => {
    expect(createMemoryAdapter().read()).toEqual({ tab: null, layers: [] });
  });

  it("reads back what was written, and keeps provider settings", () => {
    const adapter = createMemoryAdapter();
    adapter.write({
      tab: "exposure",
      layers: [{ key: "population", sourceIdx: 1, settings: { crop: "maize" } }],
    });

    expect(adapter.read()).toEqual({
      tab: "exposure",
      layers: [{ key: "population", sourceIdx: 1, settings: { crop: "maize" } }],
    });
  });

  it("copies state in and out, so a caller cannot mutate it in place", () => {
    const layers = [{ key: "landslides", sourceIdx: 0 }];
    const adapter = createMemoryAdapter({ initial: { tab: "hazard", layers } });

    layers.push({ key: "population", sourceIdx: 0 });
    const read = adapter.read();
    read.layers.length = 0;
    read.tab = "tampered";

    expect(adapter.read()).toEqual({ tab: "hazard", layers: [{ key: "landslides", sourceIdx: 0 }] });
  });

  it("touches neither location nor history: writing changes nothing outside itself", () => {
    const before = { hash: location.hash, length: history.length };
    const adapter = createMemoryAdapter();

    adapter.write({ tab: "hazard", layers: [{ key: "landslides", sourceIdx: 0 }] });
    adapter.write({ tab: "exposure", layers: [] }, { replace: true });

    expect(location.hash).toBe(before.hash);
    expect(history.length).toBe(before.length);
  });

  it("never calls a subscriber: nothing outside the instance can change an in-memory URL", () => {
    const adapter = createMemoryAdapter();
    let calls = 0;
    const off = adapter.subscribe(() => calls++);

    adapter.write({ tab: "hazard", layers: [] });
    off();

    expect(calls).toBe(0);
  });

  it("ignores writes after destroy but still answers reads", () => {
    const adapter = createMemoryAdapter({ initial: { tab: "hazard", layers: [] } });
    adapter.destroy();

    adapter.write({ tab: "exposure", layers: [] });

    expect(adapter.read()).toEqual({ tab: "hazard", layers: [] });
  });
});
