import { describe, expect, it } from "vitest";
import { dataRequestUrl, explainerUrl, layerLinksHtml } from "./layer-links.js";

describe("map metadata links", () => {
  it("preserves the exact methodology fragment and rejects non-web or missing targets", () => {
    expect(explainerUrl({ explainerUrl: "https://www.undrr.org/methodology#crop-losses" })).toBe(
      "https://www.undrr.org/methodology#crop-losses",
    );
    for (const value of ["", undefined, "javascript:alert(1)", "metric name to resolve"]) {
      expect(explainerUrl({ explainerUrl: value })).toBeNull();
    }
  });

  it("encodes a selected map and requester fields without breaking query parameters", () => {
    const href = dataRequestUrl(
      { label: "Rice +2°C & drought", id: "MX-RICE" },
      {
        recipient: "team@example.org",
        subject: "Data & access",
        placeholder: false,
      },
    );
    const url = new URL(href);
    expect(decodeURIComponent(url.pathname)).toBe("team@example.org");
    expect(url.searchParams.get("subject")).toBe("Data & access");
    expect(url.searchParams.get("body")).toContain("Map: Rice +2°C & drought (MX-RICE)");
    expect(url.searchParams.get("body")).toContain("Intended use:");
    expect(url.searchParams.get("body")).toContain("Required resolution / format:");
    expect(dataRequestUrl({}, { recipient: "" })).toBeNull();
  });

  it("labels the configured placeholder and does not invent absent methodology URLs", () => {
    const html = layerLinksHtml({ r2rCategory: "GAR2026", label: "Rice", id: "MX-RICE" });
    expect(html).toContain("Request data (placeholder)");
    expect(html).not.toContain("Learn more");
  });
});
