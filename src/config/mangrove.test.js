import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MANGROVE_BASE_URL, MANGROVE_VERSION } from "./mangrove.js";
import { TABS_MODULE_URL } from "../ui/mangrove-tabs.js";
import { COPY_BUTTON_MODULE_URL } from "../ui/mangrove-copy-button.js";
import { ON_THIS_PAGE_NAV_MODULE_URL } from "../ui/mangrove-on-this-page-nav.js";

describe("Mangrove release alignment", () => {
  it("keeps the patched citation module aligned with the stylesheet", async () => {
    const { MANGROVE_CITE_THIS_VERSION } = await import("../vendor/mangrove/cite-this.js");
    expect(MANGROVE_CITE_THIS_VERSION).toBe(MANGROVE_VERSION);
  });
  it.each(["index.html", "embed.html"])("keeps %s CSS on the module release", (file) => {
    const html = readFileSync(resolve(import.meta.dirname, "../..", file), "utf8");
    const urls = [...html.matchAll(/https:\/\/assets\.undrr\.org\/mangrove\/[^"\s]+/g)].map(([url]) => url);
    expect(urls).toEqual([`${MANGROVE_BASE_URL}/css/style.css`]);
  });

  it("uses that release for CDN enhancements", () => {
    expect([TABS_MODULE_URL, COPY_BUTTON_MODULE_URL, ON_THIS_PAGE_NAV_MODULE_URL]).toEqual([
      `${MANGROVE_BASE_URL}/js/tabs.js`,
      `${MANGROVE_BASE_URL}/js/copy-button.js`,
      `${MANGROVE_BASE_URL}/js/on-this-page-nav.js`,
    ]);
  });
});
