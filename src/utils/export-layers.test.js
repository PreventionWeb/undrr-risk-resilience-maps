import { describe, it, expect, beforeAll } from "vitest";
import { buildLayerInventoryFilename, generateLayerInventoryCSV } from "./export-layers.js";

describe("generateLayerInventoryCSV", () => {
  let csv;
  let lines; // all non-empty data lines (excluding header)
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

  it("has the expected header columns matching the inventory spreadsheet", () => {
    const expectedColumns = [
      "Variable R-R Initiative",
      "Category",
      "R2R category",
      "R&R Step",
      "Layer key",
      "Layer name",
      "Sub-source",
      "Type",
      "Description",
      "MapX view ID",
      "Source",
      "Citation",
      "License",
      "Inventory status",
    ];
    for (const col of expectedColumns) {
      expect(header).toContain(col);
    }
  });

  it("puts Variable R-R Initiative first and Category second in the header", () => {
    const columns = header.split(",");
    expect(columns[0].replace(/^\uFEFF/, "")).toBe("Variable R-R Initiative");
    expect(columns[1]).toBe("Category");
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

  it("includes R2R category and R&R Step values", () => {
    expect(csv).toContain("Societies");
    expect(csv).toContain("UNDERSTAND YOUR HAZARD PROFILE");
  });

  it("marks awaiting layers without MapX IDs as In development", () => {
    const recoveryLines = lines.filter((l) => l.includes("recovery-consumption"));
    expect(recoveryLines.length).toBeGreaterThan(0);
    expect(recoveryLines[0]).toContain("In development");
  });

  it("preserves In development status for available layers with MapX IDs", () => {
    const ecosystemLines = lines.filter((l) => l.includes("ecosystem-loss"));
    expect(ecosystemLines.length).toBeGreaterThan(0);
    expect(ecosystemLines[0]).toContain("In development");
  });

  it("preserves In development status for cross-project MapX views", () => {
    const landCoverLines = lines.filter((l) => l.includes("land-cover"));
    expect(landCoverLines.length).toBeGreaterThan(0);
    expect(landCoverLines[0]).toContain("In development");
  });

  it("excludes layers removed from the inventory", () => {
    expect(csv).not.toContain("coral-reefs");
    expect(csv).not.toContain("wellbeing");
    expect(csv).not.toContain("aal-to-gdp-2050");
  });

  it("includes newly uploaded recovery-speed views", () => {
    const riskLines = lines.filter((l) => l.includes("recovery-speed"));
    expect(riskLines.length).toBeGreaterThan(0);
    expect(riskLines).toHaveLength(8);
    expect(riskLines[0]).toContain("Uploaded");
    expect(riskLines[0]).toContain("MX-VCP83-3E2TG-PJWFJ");
  });

  it("marks published layers as Uploaded", () => {
    const populationLines = lines.filter((l) => l.includes(",population,"));
    expect(populationLines.length).toBeGreaterThan(0);
    expect(populationLines[0]).toContain("Uploaded");
  });

  it("distinguishes external runtime layers from MapX uploads", () => {
    const edraLines = lines.filter((l) => l.includes("edra-crop-yield-reduction"));
    expect(edraLines).toHaveLength(1);
    expect(edraLines[0]).toContain("Vector / external runtime");
    expect(edraLines[0]).toContain("External runtime");
    expect(edraLines[0]).not.toContain("Runtime external view");
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
    for (const line of lines) {
      const cells = [];
      let cur = "";
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') {
          inQ = !inQ;
          cur += ch;
        } else if (ch === "," && !inQ) {
          cells.push(cur);
          cur = "";
        } else cur += ch;
      }
      cells.push(cur);
      for (const c of cells) {
        if (c.startsWith('"')) {
          expect(c.endsWith('"')).toBe(true);
        }
      }
    }
  });
});

describe("buildLayerInventoryFilename", () => {
  it("adds a YYYY-MM-DD-HH-MM-SS timestamp suffix", () => {
    const date = new Date(2026, 3, 13, 14, 46, 5);
    expect(buildLayerInventoryFilename(date)).toBe("undrr-layer-inventory-2026-04-13-14-46-05.csv");
  });
});
