import { describe, expect, it } from "vitest";
import { createLayerAnnouncer } from "./announcer.js";

// The region and the rule for writing to it. `announce` returns whether it wrote,
// which is what "one announcement" means: a live region only speaks when its
// content changes.

const record = (fields = {}) => ({ key: "pop", desired: true, applied: false, ...fields });

describe("createLayerAnnouncer", () => {
  it("builds a visually hidden polite region with no id", () => {
    const { element } = createLayerAnnouncer();
    expect(element.tagName).toBe("P");
    expect(element.getAttribute("role")).toBe("status");
    expect(element.getAttribute("aria-live")).toBe("polite");
    expect(element.classList.contains("mg-u-sr-only")).toBe(true);
    expect(element.id).toBe("");
    expect(element.textContent).toBe("");
  });

  it("writes the first message and drops the same message for the same record", () => {
    const announcer = createLayerAnnouncer();
    const loading = record();

    expect(announcer.announce("pop", "Loading Population…", loading)).toBe(true);
    expect(announcer.element.textContent).toBe("Loading Population…");
    // Two more rows of the same layer render the same record.
    expect(announcer.announce("pop", "Loading Population…", loading)).toBe(false);
    expect(announcer.announce("pop", "Loading Population…", loading)).toBe(false);
  });

  it("announces the same message again when it comes from a new record", () => {
    const announcer = createLayerAnnouncer();
    const message = "Could not load Population. It is off.";

    expect(announcer.announce("pop", message, record({ status: "error" }))).toBe(true);
    // The same failure happening again is a new event, not a repeat.
    expect(announcer.announce("pop", message, record({ status: "error" }))).toBe(true);
  });

  it("announces a message with no record every time, instead of deduping on undefined", () => {
    const announcer = createLayerAnnouncer();

    // Two unrelated events both pass `undefined`; they are not the same event,
    // so the second must not be dropped as a repeat of the first.
    expect(announcer.announce("pop", "Loading Population…")).toBe(true);
    expect(announcer.announce("pop", "Loading Population…")).toBe(true);
  });

  it("lets one record carry a clear and then a failure, once each", () => {
    const announcer = createLayerAnnouncer();
    const settled = record({ status: "error" });
    // The clear has something of this layer's to drop.
    announcer.announce("pop", "Loading Population…", record());

    expect(announcer.announce("pop", "", settled)).toBe(true);
    expect(announcer.announce("pop", "Could not load Population. It is off.", settled)).toBe(true);
    // The layer's other two rows repeat both calls and neither is written again.
    expect(announcer.announce("pop", "", settled)).toBe(false);
    expect(announcer.announce("pop", "Could not load Population. It is off.", settled)).toBe(false);
    expect(announcer.element.textContent).toBe("Could not load Population. It is off.");
  });

  it("does not let a layer that said nothing wipe another layer's message", () => {
    const announcer = createLayerAnnouncer();
    announcer.announce("quake", "Loading Earthquake…", record({ key: "quake" }));

    expect(announcer.announce("pop", "", record())).toBe(false);
    expect(announcer.element.textContent).toBe("Loading Earthquake…");

    // Its own clear does empty it.
    expect(announcer.announce("quake", "", record({ key: "quake" }))).toBe(true);
    expect(announcer.element.textContent).toBe("");
  });

  it("carries both layers' messages when two speak at once, losing neither", () => {
    const announcer = createLayerAnnouncer();
    const failedPop = "Could not load Population. It is off.";
    const failedQuake = "Could not load Earthquake. It is off.";

    expect(announcer.announce("pop", failedPop, record({ status: "error" }))).toBe(true);
    expect(announcer.announce("quake", failedQuake, record({ key: "quake", status: "error" }))).toBe(true);

    // The second write must not leave the region holding Earthquake alone:
    // Population's sentence would then very likely never be spoken.
    expect(announcer.element.textContent).toBe(`${failedPop} ${failedQuake}`);
  });

  it("writes a standing message back when the other layer settles, in either order", () => {
    // Both layers are loading, so both sentences are in the region.
    const start = () => {
      const announcer = createLayerAnnouncer();
      announcer.announce("pop", "Loading Population…", record());
      announcer.announce("quake", "Loading Earthquake…", record({ key: "quake" }));
      expect(announcer.element.textContent).toBe("Loading Population… Loading Earthquake…");
      return announcer;
    };

    // The layer that spoke last settles first: the older message stays.
    const quakeFirst = start();
    expect(quakeFirst.announce("quake", "", record({ key: "quake", applied: true }))).toBe(true);
    expect(quakeFirst.element.textContent).toBe("Loading Population…");

    // And the other way round.
    const popFirst = start();
    expect(popFirst.announce("pop", "", record({ applied: true }))).toBe(true);
    expect(popFirst.element.textContent).toBe("Loading Earthquake…");
  });

  it("forgets what it said and leaves the page on destroy", () => {
    const announcer = createLayerAnnouncer();
    document.body.appendChild(announcer.element);
    const said = record();
    announcer.announce("pop", "Loading Population…", said);

    announcer.destroy();

    expect(document.querySelector(".layer-announcer")).toBeNull();
    expect(announcer.announce("pop", "Loading Population…", said)).toBe(true);
  });
});
