import { describe, expect, it } from "vitest";
import {
  RegionCsvError,
  buildRegionCsv,
  csvCell,
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

// Shaped like a real `get_view_table_attribute` payload (synthetic values).
const TABLE = [
  { j0_aal_wheat: 3.48, iso3cd: "BBB", maplab: "Region B", gid: 2 },
  { j0_aal_wheat: null, iso3cd: "CCC", maplab: "Region C", gid: 3 },
  { j0_aal_wheat: 1.25, iso3cd: "AAA", maplab: "Region A", gid: 1 },
  { j0_aal_wheat: 7, iso3cd: "xQZ", maplab: "Placeholder area", gid: 4 },
  { j0_aal_wheat: 2, iso3cd: "xZZ", maplab: "Placeholder area", gid: 5 },
  { j0_aal_wheat: 0, iso3cd: "DDD", maplab: "Region D", gid: 6 },
  { j0_aal_wheat: "$NULL", iso3cd: "EEE", maplab: "Region E", gid: 7 },
];

describe("isStandardIso3", () => {
  it("accepts exactly three uppercase letters", () => {
    expect(isStandardIso3("ABC")).toBe(true);
    for (const code of ["xQZ", "xZZ", "AB", "ABCD", "abc", "A1C", "", null, undefined, 123]) {
      expect(isStandardIso3(code)).toBe(false);
    }
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

describe("csvCell (RFC 4180)", () => {
  it("leaves plain text and numbers bare", () => {
    expect(csvCell("Region A")).toBe("Region A");
    expect(csvCell(3.14)).toBe("3.14");
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell(0)).toBe("0");
  });

  it("quotes commas, quotes and line breaks, doubling quotes", () => {
    expect(csvCell("A, B")).toBe('"A, B"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell("one\r\ntwo")).toBe('"one\r\ntwo"');
  });

  it("writes empty values as empty cells", () => {
    for (const value of [null, undefined, "", "$NULL"]) expect(csvCell(value)).toBe("");
  });

  it("defuses text a spreadsheet would run as a formula, but not numeric text", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("+1+1 ok")).toBe("'+1+1 ok");
    expect(csvCell("-3.5")).toBe("-3.5");
    expect(csvCell("=a,b")).toBe('"\'=a,b"');
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
      "AAA,Region A,1.25",
      "BBB,Region B,3.48",
      "DDD,Region D,0",
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
    expect(csv).toContain("DDD,Region D,0");
  });

  it("names the value column from the attribute without its join prefix when no label is given", () => {
    expect(linesOf(buildRegionCsv(TABLE).csv)[0]).toBe("iso3,region_name,aal_wheat");
  });

  it("keeps several value columns, keeping a row while any has a value", () => {
    const rows = [
      { j0_low: 1, j1_high: null, iso3cd: "AAA", maplab: "Region A", gid: 1 },
      { j0_low: null, j1_high: null, iso3cd: "BBB", maplab: "Region B", gid: 2 },
      { j0_value: 5, j1_value: 6, iso3cd: "CCC", gid: 3 },
    ];
    const lines = linesOf(buildRegionCsv(rows, { valueLabel: "ignored with several columns" }).csv);
    expect(lines[0]).toBe("iso3,region_name,low,high,j0_value,j1_value");
    expect(lines.slice(1)).toEqual(["AAA,Region A,1,,,", "CCC,,,,5,6"]);
  });

  it("never uses name_en and leaves region_name blank without maplab", () => {
    const rows = [{ j0_speed: 12, iso3cd: "AAA", name_en: "Local#Name#Other", gid: 1 }];
    const lines = linesOf(buildRegionCsv(rows).csv);
    expect(lines).toEqual(["iso3,region_name,speed", "AAA,,12"]);
  });

  it("fills names from regionNames for a table without maplab, blank where a code has none", () => {
    const rows = [
      { j0_speed: 12, iso3cd: "AAA", name_en: "Local#Name", gid: 1 },
      { j0_speed: 7, iso3cd: "BBB", name_en: "Other#Name", gid: 2 },
    ];
    const regionNames = new Map([["AAA", "Region A"]]);
    expect(linesOf(buildRegionCsv(rows, { regionNames }).csv)).toEqual([
      "iso3,region_name,speed",
      "AAA,Region A,12",
      "BBB,,7",
    ]);
  });

  it("prefers the table's own maplab over regionNames", () => {
    const rows = [{ j0_v: 1, iso3cd: "AAA", maplab: "Own label", gid: 1 }];
    const regionNames = new Map([["AAA", "Other label"]]);
    expect(linesOf(buildRegionCsv(rows, { regionNames }).csv)[1]).toBe("AAA,Own label,1");
  });

  it("escapes names and labels that need quoting", () => {
    const rows = [{ j0_v: 1, iso3cd: "AAA", maplab: 'Region "A", North', gid: 1 }];
    const lines = linesOf(buildRegionCsv(rows, { valueLabel: "Losses, housing" }).csv);
    expect(lines).toEqual(['iso3,region_name,"Losses, housing"', 'AAA,"Region ""A"", North",1']);
  });

  it("writes the metadata block first, one # line per non-empty field", () => {
    const metadata = [
      ["Title", "Layer – Source"],
      ["Citation", "Author, A. (2026).\nSecond line"],
      ["Source URL", ""],
      ["MapX view ID", "MX-1"],
    ];
    const lines = linesOf(buildRegionCsv(TABLE, { metadata }).csv);
    expect(lines.slice(0, 4)).toEqual([
      "# Title: Layer – Source",
      "# Citation: Author, A. (2026). Second line",
      "# MapX view ID: MX-1",
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
    expect(() => buildRegionCsv([{ iso3cd: "AAA", maplab: "A", gid: 1 }])).toThrow(/no value column/);
    expect(() => buildRegionCsv([])).toThrow(/no data/);
    expect(() => buildRegionCsv(null)).toThrow(RegionCsvError);
  });
});

describe("regionNamesFrom / hasRegionNames", () => {
  it("maps standard codes to their maplab, ignoring placeholders and blanks", () => {
    const rows = [
      { iso3cd: "AAA", maplab: "Region A" },
      { iso3cd: "xQZ", maplab: "Placeholder" },
      { iso3cd: "BBB", maplab: "" },
      { iso3cd: "CCC", maplab: null },
    ];
    expect([...regionNamesFrom(rows)]).toEqual([["AAA", "Region A"]]);
    expect(hasRegionNames(rows)).toBe(true);
    expect(hasRegionNames([{ iso3cd: "AAA", name_en: "x" }])).toBe(false);
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

  it("takes title, citation, license, source, view and date from our config", () => {
    const source = { id: "MX-2", label: "Wheat", desc: "Wheat description." };
    const pairs = Object.fromEntries(
      csvMetadata({
        layer,
        source,
        viewId: "MX-2",
        date: new Date("2026-11-04T10:00:00Z"),
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
      Downloaded: "2026-11-04",
      "Downloaded from": "https://viewer.example/",
    });
    expect(pairs.Note).toMatch(/boundaries are not included/);
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
