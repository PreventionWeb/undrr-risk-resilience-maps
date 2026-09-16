import { describe, it, expect } from "vitest";
import { initMangroveTabs, TABS_MODULE_URL } from "./mangrove-tabs.js";

describe("TABS_MODULE_URL", () => {
  it("points at the same Mangrove release as the stylesheet", () => {
    expect(TABS_MODULE_URL).toBe("https://assets.undrr.org/mangrove/2.0.0-rc.1/js/tabs.js");
  });
});

describe("initMangroveTabs", () => {
  it("applies the behaviour to the given scope", async () => {
    const scopes = [];
    const importImpl = async () => ({ mgTabs: (scope) => scopes.push(scope) });
    const scope = document.createElement("div");

    expect(await initMangroveTabs(scope, { importImpl })).toBe(true);
    expect(scopes).toEqual([scope]);
  });

  it("reports failure when the module cannot be loaded", async () => {
    const importImpl = async () => {
      throw new Error("network");
    };
    expect(await initMangroveTabs(document, { importImpl })).toBe(false);
  });

  it("reports failure when the module has no mgTabs export", async () => {
    const importImpl = async () => ({});
    expect(await initMangroveTabs(document, { importImpl })).toBe(false);
  });
});
