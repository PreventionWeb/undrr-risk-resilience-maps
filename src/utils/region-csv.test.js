import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RegionCsvError,
  buildRegionCsv,
  csvFilename,
  csvMetadata,
  hasRegionNames,
  isStandardIso3,
  regionNamesFrom,
  stripJoinPrefix,
  viewLabel,
} from "./region-csv.js";

/** The CSV's lines without the BOM, split on CRLF (trailing empty line dropped). */
function linesOf(csv) {
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).split("\r\n");
  expect(lines.pop()).toBe("");
  return lines;
}

/** Data lines only: no metadata, no header. */
const dataOf = (csv) =>
  linesOf(csv)
    .filter((line) => !line.startsWith("#,"))
    .slice(1);

/**
 * Real `get_view_table_attribute` payloads from the #64 spike (MapX 1.14.2),
 * sanitised: names are synthetic and placeholder codes remapped to `xQ…`.
 */
const fixture = (id) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__/mapx-tables", `${id}.json`), "utf8"));

// Shaped like a real payload (synthetic values and codes).
const TABLE = [
  { j0_aal_wheat: 3.48, iso3cd: "CCB", maplab: "Region B", gid: 2 },
  { j0_aal_wheat: null, iso3cd: "CCC", maplab: "Region C", gid: 3 },
  { j0_aal_wheat: 1.25, iso3cd: "CCA", maplab: "Region A", gid: 1 },
  { j0_aal_wheat: 7, iso3cd: "xQZ", maplab: "Placeholder area", gid: 4 },
  { j0_aal_wheat: 2, iso3cd: "xZZ", maplab: "Placeholder area", gid: 5 },
  { j0_aal_wheat: 0, iso3cd: "CCD", maplab: "Region D", gid: 6 },
  { j0_aal_wheat: "$NULL", iso3cd: "CCE", maplab: "Region E", gid: 7 },
];

describe("isStandardIso3", () => {
  it("accepts three uppercase letters outside the user-assigned ranges", () => {
    for (const code of ["CCA", "QAT", "YXZ", "ZYZ"]) {
      expect(isStandardIso3(code)).toBe(true);
    }
  });

  it("rejects placeholders, malformed values and ISO's user-assigned ranges", () => {
    for (const code of ["xQZ", "xZZ", "AB", "ABCD", "abc", "A1C", "", null, undefined, 123]) {
      expect(isStandardIso3(code)).toBe(false);
    }
    // Uppercase placeholder codes in AAA–AAZ, QMA–QZZ, XAA–XZZ and ZZA–ZZZ.
    for (const code of ["AAA", "AAZ", "QMA", "QZZ", "XAA", "XAB", "XZZ", "ZZA", "ZZZ"]) {
      expect(isStandardIso3(code), code).toBe(false);
    }
    // Just outside those ranges.
    for (const code of ["ABA", "QLZ", "WZZ", "ZYZ"]) expect(isStandardIso3(code), code).toBe(true);
  });
});

describe("stripJoinPrefix", () => {
  it("removes a jN_ join prefix only at the start", () => {
    expect(stripJoinPrefix("j0_crop_all_aal_wheat")).toBe("crop_all_aal_wheat");
    expect(stripJoinPrefix("j12_value")).toBe("value");
    expect(stripJoinPrefix("value_j0_x")).toBe("value_j0_x");
    expect(stripJoinPrefix("jx_value")).toBe("jx_value");
  });
});

describe("csvFilename", () => {
  it("is <layer-key>_<view-id>.csv", () => {
    expect(csvFilename("aal-crops", "MX-UN9Z8-4M5QH-PMDNX")).toBe("aal-crops_MX-UN9Z8-4M5QH-PMDNX.csv");
  });

  it("replaces characters a file system might refuse", () => {
    expect(csvFilename("a/b c", "MX:1")).toBe("a-b-c_MX-1.csv");
  });
});

describe("buildRegionCsv", () => {
  it("writes iso3, region_name and the labelled value, sorted by code", () => {
    const result = buildRegionCsv(TABLE, { valueLabel: "Wheat AAL (%)" });
    expect(linesOf(result.csv)).toEqual([
      "iso3,region_name,Wheat AAL (%)",
      "CCA,Region A,1.25",
      "CCB,Region B,3.48",
      "CCD,Region D,0",
    ]);
    expect(result.rowCount).toBe(3);
    expect(result.droppedNoValue).toBe(2);
    expect(result.droppedNonStandard).toBe(2);
    expect(result.valueAttributes).toEqual(["j0_aal_wheat"]);
  });

  it("drops gid, keeps zero values, and drops rows without a standard code", () => {
    const { csv } = buildRegionCsv(TABLE);
    expect(csv).not.toContain("gid");
    expect(csv).not.toMatch(/xQZ|xZZ|Placeholder/);
    expect(csv).toContain("CCD,Region D,0");
  });

  it("drops uppercase codes in the user-assigned ranges", () => {
    const rows = [
      { j0_v: 1, iso3cd: "CCA", maplab: "Region A", gid: 1 },
      { j0_v: 2, iso3cd: "XAB", maplab: "Placeholder", gid: 2 },
      { j0_v: 3, iso3cd: "AAA", maplab: "Placeholder", gid: 3 },
      { j0_v: 4, iso3cd: "QMZ", maplab: "Placeholder", gid: 4 },
      { j0_v: 5, iso3cd: "ZZZ", maplab: "Placeholder", gid: 5 },
    ];
    const result = buildRegionCsv(rows);
    expect(dataOf(result.csv)).toEqual(["CCA,Region A,1"]);
    expect(result.droppedNonStandard).toBe(4);
  });

  it("exports only joined value attributes, never geometry-like or hidden columns", () => {
    const rows = [
      {
        j0_v: 1,
        iso3cd: "CCA",
        maplab: "Region A",
        gid: 1,
        geom: "0101000020E6100000",
        geometry: { type: "Point" },
        wkt: "POINT(1 2)",
        lat: 2,
        lon: 1,
        mx_t0: 0,
        mx_t1: 0,
        name_en: "Local#Name",
        j0_geom: "hidden too",
      },
    ];
    const lines = linesOf(buildRegionCsv(rows).csv);
    expect(lines).toEqual(["iso3,region_name,v", "CCA,Region A,1"]);
  });

  it("refuses a table whose only columns are not joined values", () => {
    expect(() => buildRegionCsv([{ iso3cd: "CCA", maplab: "A", geom: "x", lat: 1, gid: 1 }])).toThrow(
      /no value column/,
    );
  });

  it("names the value column from the attribute without its join prefix when no label is given", () => {
    expect(linesOf(buildRegionCsv(TABLE).csv)[0]).toBe("iso3,region_name,aal_wheat");
  });

  it("keeps the full attribute name where the short one would repeat a header", () => {
    const rows = [{ j0_iso3: 1, j1_region_name: 2, j0_x: 3, j1_x: 4, iso3cd: "CCA", maplab: "A", gid: 1 }];
    expect(linesOf(buildRegionCsv(rows).csv)[0]).toBe("iso3,region_name,j0_iso3,j1_region_name,j0_x,j1_x");
  });

  it("keeps several value columns, keeping a row while any has a value", () => {
    const rows = [
      { j0_low: 1, j1_high: null, iso3cd: "CCA", maplab: "Region A", gid: 1 },
      { j0_low: null, j1_high: null, iso3cd: "CCB", maplab: "Region B", gid: 2 },
      { j0_low: Number.NaN, j1_high: Infinity, iso3cd: "CCC", maplab: "Region C", gid: 3 },
      { j0_low: 5, j1_high: Number.NaN, iso3cd: "CCD", gid: 4 },
    ];
    const result = buildRegionCsv(rows, { valueLabel: "ignored with several columns" });
    const lines = linesOf(result.csv);
    expect(lines[0]).toBe("iso3,region_name,low,high");
    expect(lines.slice(1)).toEqual(["CCA,Region A,1,", "CCD,,5,"]);
    expect(result.droppedNoValue).toBe(2);
  });

  it("keeps the first row of a repeated code", () => {
    const rows = [
      { j0_v: 1, iso3cd: "CCA", maplab: "Region A", gid: 1 },
      { j0_v: 2, iso3cd: "CCA", maplab: "Region A", gid: 2 },
    ];
    const result = buildRegionCsv(rows);
    expect(dataOf(result.csv)).toEqual(["CCA,Region A,1"]);
    expect(result.droppedDuplicate).toBe(1);
  });

  it("never uses name_en and leaves region_name blank without maplab", () => {
    const rows = [{ j0_speed: 12, iso3cd: "CCA", name_en: "Local#Name#Other", gid: 1 }];
    expect(linesOf(buildRegionCsv(rows).csv)).toEqual(["iso3,region_name,speed", "CCA,,12"]);
  });

  it("fills names from regionNames for a table without maplab, or with a blank one", () => {
    const rows = [
      { j0_speed: 12, iso3cd: "CCA", name_en: "Local#Name", gid: 1 },
      { j0_speed: 7, iso3cd: "CCB", name_en: "Other#Name", gid: 2 },
      { j0_speed: 3, iso3cd: "CCC", maplab: "", gid: 3 },
    ];
    const regionNames = new Map([
      ["CCA", "Region A"],
      ["CCC", "Region C"],
    ]);
    expect(linesOf(buildRegionCsv(rows, { regionNames }).csv)).toEqual([
      "iso3,region_name,speed",
      "CCA,Region A,12",
      "CCB,,7",
      "CCC,Region C,3",
    ]);
  });

  it("prefers the table's own maplab over regionNames", () => {
    const rows = [{ j0_v: 1, iso3cd: "CCA", maplab: "Own label", gid: 1 }];
    const regionNames = new Map([["CCA", "Other label"]]);
    expect(linesOf(buildRegionCsv(rows, { regionNames }).csv)[1]).toBe("CCA,Own label,1");
  });

  it("escapes names and labels that need quoting, and defuses formulas", () => {
    const rows = [
      { j0_v: 1, iso3cd: "CCA", maplab: 'Region "A", North', gid: 1 },
      { j0_v: -2, iso3cd: "CCB", maplab: "=cmd", gid: 2 },
    ];
    const lines = linesOf(buildRegionCsv(rows, { valueLabel: "Losses, housing" }).csv);
    expect(lines).toEqual([
      'iso3,region_name,"Losses, housing"',
      'CCA,"Region ""A"", North",1',
      "CCB,'=cmd,-2",
    ]);
  });

  it("writes the metadata block first: #, then one quoted, defused cell per field", () => {
    const metadata = [
      ["Title", "Layer – Source"],
      ["Citation", "Author, A., Other, B. (2026). Title, Journal.\nSecond line"],
      ["Source URL", ""],
      ["MapX view ID", "MX-1"],
      ["Note", "=not a formula"],
    ];
    const lines = linesOf(buildRegionCsv(TABLE, { metadata }).csv);
    expect(lines.slice(0, 5)).toEqual([
      "#,Title: Layer – Source",
      '#,"Citation: Author, A., Other, B. (2026). Title, Journal. Second line"',
      "#,MapX view ID: MX-1",
      "#,Note: =not a formula",
      "iso3,region_name,aal_wheat",
    ]);
  });

  it("refuses a table without region codes, values or rows", () => {
    const codeless = () => buildRegionCsv([{ j0_v: 1, gid: 1 }]);
    expect(codeless).toThrow(RegionCsvError);
    expect(codeless).toThrow(/no region codes/);
    try {
      codeless();
    } catch (error) {
      expect(error.code).toBe("no-region-code");
    }
    expect(() => buildRegionCsv([{ iso3cd: "CCA", maplab: "A", gid: 1 }])).toThrow(/no value column/);
    expect(() => buildRegionCsv([])).toThrow(/no data/);
    expect(() => buildRegionCsv(null)).toThrow(RegionCsvError);
  });
});

describe("buildRegionCsv with real MapX tables (sanitised spike fixtures)", () => {
  it("a maplab view: 24 regions with values, names from maplab", () => {
    const { rows } = fixture("MX-UN9Z8-4M5QH-PMDNX");
    const result = buildRegionCsv(rows, { valueLabel: "Wheat" });
    expect(result.rowCount).toBe(24);
    expect(result.droppedNonStandard).toBe(0);
    const data = dataOf(result.csv);
    for (const line of data) expect(line).toMatch(/^([A-Z]{3}),Region \1,\d+(\.\d+)?(e-?\d+)?$/);
  });

  it("a name_en view: 132 regions, names only from regionNames", () => {
    const { rows } = fixture("MX-VCP83-3E2TG-PJWFJ");
    const names = regionNamesFrom(fixture("MX-UN9Z8-4M5QH-PMDNX").rows);
    expect(hasRegionNames(rows)).toBe(false);
    const bare = buildRegionCsv(rows);
    expect(bare.rowCount).toBe(132);
    expect(bare.csv).not.toContain("Local");
    expect(dataOf(bare.csv).every((line) => line.split(",")[1] === "")).toBe(true);
    const named = dataOf(buildRegionCsv(rows, { regionNames: names }).csv);
    expect(named.filter((line) => line.split(",")[1] !== "").length).toBeGreaterThan(120);
  });

  it("a view with values on placeholder-coded areas: they are left out", () => {
    const { rows } = fixture("MX-2V1JX-EV4WL-AQKZV");
    const result = buildRegionCsv(rows);
    expect(result.droppedNonStandard).toBe(9);
    expect(result.rowCount).toBe(224);
    expect(result.csv).not.toMatch(/xQ/);
  });
});

describe("regionNamesFrom / hasRegionNames", () => {
  it("maps standard codes to their maplab, ignoring placeholders and blanks", () => {
    const rows = [
      { iso3cd: "CCA", maplab: "Region A" },
      { iso3cd: "xQZ", maplab: "Placeholder" },
      { iso3cd: "XAB", maplab: "Placeholder" },
      { iso3cd: "CCB", maplab: "" },
      { iso3cd: "CCC", maplab: null },
    ];
    expect([...regionNamesFrom(rows)]).toEqual([["CCA", "Region A"]]);
    expect(hasRegionNames(rows)).toBe(true);
    expect(hasRegionNames([{ iso3cd: "CCA", name_en: "x" }])).toBe(false);
    expect(regionNamesFrom(null).size).toBe(0);
  });
});

describe("csvMetadata", () => {
  const layer = {
    key: "aal-crops",
    label: "AAL for crops",
    desc: "Layer description.",
    source: "Provider",
    sourceUrl: "https://example.org/data",
    citation: "Provider (2026).",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  };

  it("takes title, citation, license, source, view and UTC date from our config", () => {
    const source = { id: "MX-2", label: "Wheat", desc: "Wheat description." };
    const pairs = Object.fromEntries(
      csvMetadata({
        layer,
        source,
        viewId: "MX-2",
        date: new Date("2026-11-04T23:30:00-05:00"),
        viewerUrl: "https://viewer.example/",
      }),
    );
    expect(pairs).toMatchObject({
      Title: "AAL for crops – Wheat",
      Description: "Wheat description.",
      Source: "Provider",
      "Source URL": "https://example.org/data",
      Citation: "Provider (2026).",
      License: "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/",
      "MapX view ID": "MX-2",
      "Layer key": "aal-crops",
      "Downloaded (UTC)": "2026-11-05",
      "Downloaded from": "https://viewer.example/",
    });
    expect(pairs.Note).toMatch(/boundaries are not included/);
    expect(pairs["Region names"]).toMatch(/UN map labels/);
  });

  it("says when region names could not be read", () => {
    const pairs = Object.fromEntries(csvMetadata({ layer, viewId: "MX-1", namesMissing: true }));
    expect(pairs["Region names"]).toMatch(/Not available/);
  });

  it("uses the layer label alone for a simple layer", () => {
    expect(viewLabel(layer)).toBe("AAL for crops");
  });

  it("keeps its wording to regions", () => {
    const text = csvMetadata({ layer, viewId: "MX-1" })
      .map(([, value]) => value)
      .join(" ");
    expect(text).not.toMatch(/countr/i);
  });
});
