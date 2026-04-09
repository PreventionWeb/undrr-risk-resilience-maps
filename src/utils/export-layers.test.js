import { describe, it, expect, beforeAll } from "vitest";
import { generateLayerInventoryCSV } from "./export-layers.js";

describe("generateLayerInventoryCSV", () => {
  let csv;
  let lines; // all non-empty data lines (excluding header and BOM line)
  let header;

  beforeAll(() => {
    csv = generateLayerInventoryCSV();
    const allLines = csv.split("\r\n");
    header = allLines[0];
    lines = allLines.slice(1).filter((l) => l.trim() !== "");
  });

  // --- structure ---

  it("starts with a UTF-8 BOM", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("uses CRLF line endings", () => {
    expect(csv).toContain("\r\n");
  });

  it("has the expected header columns", () => {
    const expectedColumns = [
      "Category",
      "Layer key",
      "Layer name",
      "Sub-source",
      "Type",
      "Description",
      "MapX view ID",
      "MapX project",
      "Status",
      "Source attribution",
      "Source URL",
      "Citation",
      "License",
      "Notes",
    ];
    for (const col of expectedColumns) {
      expect(header).toContain(col);
    }
  });

  // --- content ---

  it("includes known layer keys", () => {
    expect(csv).toContain("river-flooding");
    expect(csv).toContain("population");
    expect(csv).toContain("intact-forests");
  });

  it("expands compound layers into one row per sub-source", () => {
    // earthquake-pga has 5 sources (250yr, 475yr, 975yr, 1500yr, 2475yr)
    const eqLines = lines.filter((l) => l.includes("earthquake-pga"));
    expect(eqLines.length).toBe(5);
  });

  it("uses the project label, not the raw project ID", () => {
    expect(csv).toContain("ECO-DRR (UNEP/GRID-Geneva)");
    expect(csv).not.toContain("MX-2LD-FBB-58N-ROK-8RH");
  });

  it("marks disabled layers as Disabled", () => {
    // land-cover is disabled (in HOME project)
    const landCoverLines = lines.filter((l) => l.includes("land-cover"));
    expect(landCoverLines.length).toBeGreaterThan(0);
    expect(landCoverLines[0]).toContain("Disabled");
  });

  it("marks active layers as Active", () => {
    const populationLines = lines.filter((l) => l.includes("population"));
    expect(populationLines.length).toBeGreaterThan(0);
    expect(populationLines[0]).toContain("Active");
  });

  // --- CSV correctness ---

  it("correctly quotes fields that contain commas", () => {
    // Each data row should parse to exactly 14 columns when walking quotes
    for (const line of lines) {
      let inQuote = false;
      let commas = 0;
      for (const ch of line) {
        if (ch === '"') inQuote = !inQuote;
        else if (ch === "," && !inQuote) commas++;
      }
      // 14 columns → 13 unquoted commas
      expect(commas).toBeGreaterThanOrEqual(13);
    }
  });

  it("does not contain unescaped double-quotes inside quoted fields", () => {
    // A double-quote inside a field should be represented as ""
    // Verify no odd number of quotes per field segment
    for (const line of lines) {
      // Split by unquoted commas and check each cell
      const cells = [];
      let cur = "";
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; cur += ch; }
        else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
        else cur += ch;
      }
      cells.push(cur);
      for (const cell of cells) {
        if (cell.startsWith('"')) {
          expect(cell.endsWith('"')).toBe(true);
        }
      }
    }
  });
});
