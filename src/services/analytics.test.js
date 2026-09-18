import { describe, expect, it, vi } from "vitest";
import { createAnalytics, EMBED_LOADED, embedLoadedProps, hostOrigin } from "./analytics.js";

describe("hostOrigin", () => {
  it("keeps the origin of an http(s) referrer", () => {
    expect(hostOrigin("https://www.preventionweb.net/news/story?x=1")).toBe("https://www.preventionweb.net");
  });

  it("is null when the browser sent no usable referrer", () => {
    for (const value of ["", null, undefined, "about:blank", "not a url", 7]) {
      expect(hostOrigin(value)).toBeNull();
    }
  });
});

describe("embedLoadedProps", () => {
  it("records the host, whether it is framed, the tab and the layers", () => {
    expect(
      embedLoadedProps({
        referrer: "https://www.undrr.org/page",
        tab: "hazard",
        layers: ["landslides"],
        framed: true,
      }),
    ).toEqual({
      host: "https://www.undrr.org",
      framed: true,
      tab: "hazard",
      layers: ["landslides"],
      locked: false,
    });
  });

  it("records whether the embed loaded behind the preview gate", () => {
    const props = embedLoadedProps({ referrer: "", tab: "hazard", layers: [], framed: true, locked: true });
    expect(props.locked).toBe(true);
  });

  it("reports an unknown host rather than guessing one", () => {
    expect(embedLoadedProps({ referrer: "", tab: "hazard", layers: [], framed: false }).host).toBeNull();
  });

  it("copies the layer list", () => {
    const layers = ["landslides"];
    const props = embedLoadedProps({ referrer: "", tab: "hazard", layers, framed: true });
    layers.push("population");
    expect(props.layers).toEqual(["landslides"]);
  });
});

describe("createAnalytics", () => {
  it("sends events to the injected sink", () => {
    const sink = vi.fn();
    createAnalytics({ sink }).track(EMBED_LOADED, { host: null });
    expect(sink).toHaveBeenCalledWith({ name: EMBED_LOADED, props: { host: null } });
  });

  it("writes to the console by default, because the repo has no tracker yet", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    createAnalytics().track(EMBED_LOADED, { host: "https://x.example" });
    expect(debug).toHaveBeenCalledWith("[analytics]", EMBED_LOADED, { host: "https://x.example" });
    debug.mockRestore();
  });

  it("never lets a broken sink break the caller", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const analytics = createAnalytics({
      sink: () => {
        throw new Error("tracker down");
      },
    });

    expect(() => analytics.track(EMBED_LOADED)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
