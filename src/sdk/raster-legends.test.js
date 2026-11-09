import { describe, expect, it } from "vitest";
import { parseGeoServerRasterLegend } from "./raster-legends.js";

const earthquakePayload = {
  Legend: [
    {
      layerName: "PGA_250y",
      title: "Peak Ground Acceleration PGA - 250 Years",
      rules: [
        {
          symbolizers: [
            {
              Raster: {
                colormap: {
                  entries: [
                    {
                      label: "0",
                      quantity: "0.1",
                      color: "#808080",
                      opacity: "0.0",
                    },
                    { label: "< 100", quantity: "100", color: "#FFF195" },
                    { label: "100 - 250", quantity: "250", color: "#FFD93D" },
                    { label: "250 - 500", quantity: "500", color: "#FDAE61" },
                    { label: "500 - 1000", quantity: "1000", color: "#D7191C" },
                    { label: "> 1000", quantity: "5000", color: "#5F021F" },
                  ],
                  type: "intervals",
                },
                opacity: "1.0",
              },
            },
          ],
        },
      ],
    },
  ],
};

describe("parseGeoServerRasterLegend", () => {
  it("normalises the live Earthquake PGA interval schema", () => {
    const legend = parseGeoServerRasterLegend(earthquakePayload, "cm/s2");

    expect(legend.title).toBe("cm/s2");
    expect(legend.entries).toHaveLength(6);
    expect(legend.entries[0]).toEqual({
      color: "#808080",
      label: "0",
      opacity: 0,
      size: null,
      geometry: "polygon",
      borderColor: null,
    });
    expect(legend.entries.at(-1)).toMatchObject({
      color: "#5F021F",
      label: "> 1000",
      opacity: 1,
    });
  });

  it("uses the provider title and quantity labels when MapX labels are absent", () => {
    const payload = structuredClone(earthquakePayload);
    delete payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries[1].label;

    const legend = parseGeoServerRasterLegend(payload);

    expect(legend.title).toBe("Peak Ground Acceleration PGA - 250 Years");
    expect(legend.entries[1].label).toBe("100");
  });

  it("composes raster and entry opacity", () => {
    const payload = structuredClone(earthquakePayload);
    const raster = payload.Legend[0].rules[0].symbolizers[0].Raster;
    raster.opacity = "0.5";
    raster.colormap.entries[1].opacity = "0.4";

    expect(parseGeoServerRasterLegend(payload).entries[1].opacity).toBe(0.2);
  });

  it("rejects object quantities instead of rendering an object coercion", () => {
    const payload = structuredClone(earthquakePayload);
    const entry = payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries[1];
    delete entry.label;
    entry.quantity = { value: 100 };

    expect(parseGeoServerRasterLegend(payload)).toBeNull();
  });

  it.each([
    [
      "ramps without increasing quantities",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.type = "ramp";
        payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries[1].quantity = "0";
      },
    ],
    [
      "unsafe colours",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries[0].color =
          "url(javascript:alert(1))";
      },
    ],
    [
      "invalid opacity",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers[0].Raster.opacity = "2";
      },
    ],
    [
      "multiple symbolizers",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers.push({ Raster: {} });
      },
    ],
    [
      "excessive entry counts",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries = Array.from(
          { length: 501 },
          () => ({ color: "#fff", label: "value" }),
        );
      },
    ],
  ])("rejects %s so MapX's image remains authoritative", (_name, change) => {
    const payload = structuredClone(earthquakePayload);
    change(payload);
    expect(parseGeoServerRasterLegend(payload)).toBeNull();
  });
});

describe("continuous and grouped raster legends", () => {
  it("retains unequal numeric stop positions for continuous interpolation", () => {
    const payload = structuredClone(earthquakePayload);
    payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.type = "ramp";
    expect(parseGeoServerRasterLegend(payload).ramp).toEqual([0.1, 100, 250, 500, 1000, 5000]);
  });
  it.each(["", "NaN", Infinity, [], true, null])("rejects invalid ramp quantity %j", (quantity) => {
    const payload = structuredClone(earthquakePayload);
    const map = payload.Legend[0].rules[0].symbolizers[0].Raster.colormap;
    map.type = "ramp";
    map.entries[1].quantity = quantity;
    expect(parseGeoServerRasterLegend(payload)).toBeNull();
  });
  it("keeps grouped titles and fails the entire group if a sublayer is unsupported", () => {
    const payload = structuredClone(earthquakePayload);
    payload.Legend.push(structuredClone(payload.Legend[0]));
    payload.Legend[1].title = "Second sublayer";
    expect(parseGeoServerRasterLegend(payload).groups.map((group) => group.title)).toEqual([
      payload.Legend[0].title,
      "Second sublayer",
    ]);
    payload.Legend[1].rules[0].symbolizers[0].Raster.colormap.type = "unknown";
    expect(parseGeoServerRasterLegend(payload)).toBeNull();
  });
});
