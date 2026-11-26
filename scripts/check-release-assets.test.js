import { describe, expect, it } from "vitest";
import { bundleAssetRefs, htmlAssetRefs, longLived, revalidates } from "./check-release-assets.mjs";

const base = "https://example.org/m/maps/";

describe("htmlAssetRefs", () => {
  it("lists the hashed same-origin bundles an entry references, and nothing else", () => {
    const html = `
      <link rel="stylesheet" href="https://assets.undrr.org/mangrove/2.5.0/css/style.css" />
      <script type="module" crossorigin src="./assets/embed-BiCrkA-t.js"></script>
      <link rel="modulepreload" crossorigin href="./assets/shared-D7Qa7H7m.js">
      <link rel="stylesheet" href="./assets/shared-DTYfEFNk.css?v=1">
      <link rel="icon" href="./logo-grar.svg">`;
    expect(htmlAssetRefs(html, `${base}embed.html?layers=x`)).toEqual([
      `${base}assets/embed-BiCrkA-t.js`,
      `${base}assets/shared-D7Qa7H7m.js`,
      `${base}assets/shared-DTYfEFNk.css`,
    ]);
  });
});

describe("bundleAssetRefs", () => {
  it("follows static and lazy chunk imports, relative and root-relative", () => {
    const source =
      'import{a}from"./shared-BFTxsJGX.js";const l=()=>import(`./edra-agriculture-CDPGwZe4.js`);' +
      'const d=["assets/cite-this-DNReYujB.js","/other/x-ABCDEFGH.css"];const n=`${G}/js/on-this-page-nav.js`;';
    expect(bundleAssetRefs(source, `${base}assets/shared-BFTxsJGX.js`)).toEqual([
      `${base}assets/cite-this-DNReYujB.js`,
      `${base}assets/edra-agriculture-CDPGwZe4.js`,
      `${base}assets/shared-BFTxsJGX.js`,
      "https://example.org/other/x-ABCDEFGH.css",
    ]);
  });
});

describe("Cache-Control", () => {
  it("counts only headers that make every cache revalidate HTML", () => {
    for (const header of [
      "no-cache",
      "public, no-cache",
      "no-store",
      "max-age=0",
      "max-age=0, must-revalidate",
    ]) {
      expect(revalidates(header), header).toBe(true);
    }
    for (const header of [null, "", "max-age=600", "public, max-age=0, s-maxage=3600", "must-revalidate"]) {
      expect(revalidates(header), String(header)).toBe(false);
    }
  });

  it("treats a day or more as long-lived for hashed bundles", () => {
    expect(longLived("public, max-age=31536000, immutable")).toBe(true);
    expect(longLived("max-age=600")).toBe(false);
    expect(longLived(null)).toBe(false);
  });
});
