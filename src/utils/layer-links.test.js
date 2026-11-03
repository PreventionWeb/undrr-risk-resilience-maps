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
      },
    );
    const url = new URL(href);
    expect(decodeURIComponent(url.pathname)).toBe("team@example.org");
    expect(url.searchParams.get("subject")).toBe("Data & access");
    expect(url.searchParams.get("body")).toContain("Map title: Rice +2°C & drought");
    expect(url.searchParams.get("body")).toContain("Intended use:");
    expect(url.searchParams.get("body")).toContain("Country or region: [insert location]");
    expect(url.searchParams.get("cc")).toBeNull();
    expect(dataRequestUrl({}, { recipient: "" })).toBeNull();
  });

  it("uses the supplied recipients and wording with a public link to the exact selected scenario", () => {
    const url = new URL(
      dataRequestUrl({
        id: "MX-KU5ID-GHTH8-C2WG3",
        label: "Rice AAL (%) – Warming level +2°C",
      }),
    );
    expect(url.pathname).toBe("katsanakis@un.org");
    expect(url.searchParams.get("cc")).toBe("kenneth.hawkins@un.org,jenty.kirsch-wood@un.org");
    expect(url.searchParams.get("subject")).toBe("Request for underlying map data");
    const body = url.searchParams.get("body");
    expect(body).toContain(
      "Dear UNDRR team,\r\n\r\nI would like to request the underlying data needed to reproduce the following map from the Map Viewer:",
    );
    expect(body).toContain("Map title: Rice AAL (%) – Warming level +2°C");
    expect(body).toContain(
      "Map link: https://www.undrr.org/m/risk-and-resilience-maps/#gar?layers=gar26-aal-crops:7",
    );
    expect(body).toContain("Intended use: [briefly describe how you plan to use the data]");
    expect(body).toMatch(/Intended use: \[briefly describe how you plan to use the data\]\r\n$/);
    expect(body.replaceAll("\r\n", "")).not.toContain("\n");
    expect(body).not.toContain("PREVIEW");
    expect(url.href).not.toContain(";");
  });

  it("offers requests without placeholder labels or invented methodology URLs", () => {
    const html = layerLinksHtml({ r2rCategory: "GAR2026", label: "Rice", id: "MX-RICE" });
    expect(html).toContain(">Request data</a>");
    expect(html).not.toContain("placeholder");
    expect(html).not.toContain("Learn more");
  });
});
