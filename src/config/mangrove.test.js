import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MANGROVE_BASE_URL } from "./mangrove.js";
import { TABS_MODULE_URL } from "../ui/mangrove-tabs.js";
import { COPY_BUTTON_MODULE_URL } from "../ui/mangrove-copy-button.js";
import { ON_THIS_PAGE_NAV_MODULE_URL } from "../ui/mangrove-on-this-page-nav.js";
import { CITE_THIS_MODULE_URL } from "../ui/mangrove-cite-this.js";

describe("Mangrove release alignment", () => {
  it.each(["index.html", "embed.html"])("keeps %s CSS and preview gate on the module release", (file) => {
    const html = readFileSync(resolve(import.meta.dirname, "../..", file), "utf8");
    const urls = [...html.matchAll(/https:\/\/assets\.undrr\.org\/mangrove\/[^"\s]+/g)].map(([url]) => url);
    expect(urls).toEqual([`${MANGROVE_BASE_URL}/css/style.css`, `${MANGROVE_BASE_URL}/js/preview-access.js`]);
  });

  it("uses that release for every dynamic enhancement", () => {
    expect([
      TABS_MODULE_URL,
      COPY_BUTTON_MODULE_URL,
      ON_THIS_PAGE_NAV_MODULE_URL,
      CITE_THIS_MODULE_URL,
    ]).toEqual([
      `${MANGROVE_BASE_URL}/js/tabs.js`,
      `${MANGROVE_BASE_URL}/js/copy-button.js`,
      `${MANGROVE_BASE_URL}/js/on-this-page-nav.js`,
      `${MANGROVE_BASE_URL}/js/cite-this.js`,
    ]);
  });
});
