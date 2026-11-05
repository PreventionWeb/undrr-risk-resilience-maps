import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const tempRoots = [];

function makeFixture() {
  const fixture = mkdtempSync(join(tmpdir(), "undrr-inventory-import-"));
  tempRoots.push(fixture);
  mkdirSync(join(fixture, "scripts"), { recursive: true });
  mkdirSync(join(fixture, "src/config/layers"), { recursive: true });
  mkdirSync(join(fixture, "data"), { recursive: true });
  cpSync(join(ROOT, "scripts/import-inventory.mjs"), join(fixture, "scripts/import-inventory.mjs"));
  cpSync(join(ROOT, "src/config/layers"), join(fixture, "src/config/layers"), { recursive: true });
  cpSync(join(ROOT, "data/inventory.csv"), join(fixture, "data/inventory.csv"));
  cpSync(join(ROOT, "data/removed-layer-keys.txt"), join(fixture, "data/removed-layer-keys.txt"));
  return fixture;
}

afterEach(() => {
  for (const fixture of tempRoots.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("import-inventory --apply", () => {
  it("preserves configured metadata when an older CSV omits optional columns", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    // Optional columns are trailing, so dropping their headers leaves the rest aligned.
    writeFileSync(
      csvPath,
      readFileSync(csvPath, "utf8").replace(
        ",Note,Explainer link,Download URL,Download size (bytes),CSV download",
        "",
      ),
    );
    const configPath = join(fixture, "src/config/layers/gar.js");
    const before = readFileSync(configPath, "utf8").replace(
      'explainerUrl: ""',
      'explainerUrl: "https://example.org/methodology#rice"',
    );
    writeFileSync(configPath, before);
    execFileSync(process.execPath, [join(fixture, "scripts/import-inventory.mjs"), "--apply"], {
      cwd: fixture,
    });
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("round-trips a multiline scenario note and explainer without touching another scenario", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    const lines = readFileSync(csvPath, "utf8").split(/\r?\n/);
    const index = lines.findIndex((line) => line.includes("MX-KU5ID-GHTH8-C2WG3"));
    // Replace only the two optional columns. The preceding text ends at Uploaded.
    lines[index] = lines[index].replace(
      /Uploaded,.*$/,
      // The row's trailing cells (no hosted files, CSV download yes) are kept.
      () => 'Uploaded,"First line, with a comma\nSecond line: $&",https://example.org/methodology#rice,,,yes',
    );
    writeFileSync(csvPath, lines.join("\n"));
    execFileSync(process.execPath, [join(fixture, "scripts/import-inventory.mjs"), "--apply"], {
      cwd: fixture,
    });
    const config = readFileSync(join(fixture, "src/config/layers/gar.js"), "utf8");
    expect(config).toContain('note: "First line, with a comma\\nSecond line: $&"');
    expect(config).toContain('explainerUrl: "https://example.org/methodology#rice"');
    expect(config.match(/https:\/\/example.org\/methodology#rice/g)).toHaveLength(1);
    const second = execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--apply"],
      { cwd: fixture, encoding: "utf8" },
    );
    expect(second).toContain("nothing to change");
  });

  it("leaves the canonical inventory unchanged on apply", () => {
    const fixture = makeFixture();
    const configPath = join(fixture, "src/config/layers/gar.js");
    const before = readFileSync(configPath, "utf8");
    const report = execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--apply"],
      { cwd: fixture, encoding: "utf8" },
    );
    expect(report).toContain("nothing to change");
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });
  it("applies spreadsheet layer names and descriptions", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    const csv = readFileSync(csvPath, "utf8")
      .replace(",population,Population,", ",population,People,")
      .replace(
        "Direct Probable Maximum Losses to public infrastructure - Earthquake",
        "PML to public infrastructure - Earthquake",
      );
    writeFileSync(csvPath, csv);

    execFileSync(process.execPath, [join(fixture, "scripts/import-inventory.mjs"), "--apply"], {
      cwd: fixture,
    });

    const exposure = readFileSync(join(fixture, "src/config/layers/exposure.js"), "utf8");
    expect(exposure).toMatch(/key: "population",\n\s+label: "People"/);
    const risk = readFileSync(join(fixture, "src/config/layers/risk.js"), "utf8");
    expect(risk).toContain('desc: "PML to public infrastructure - Earthquake"');
  });

  it("fails fast when required CSV headers are missing", () => {
    const fixture = makeFixture();
    const source = join(fixture, "data/inventory.csv");
    const malformed = join(fixture, "malformed.csv");
    writeFileSync(malformed, readFileSync(source, "utf8").replace("R&R Step", "state"));

    const result = spawnSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--input", malformed],
      { cwd: fixture, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Inventory CSV missing required header(s): R&R Step");
  });

  it("accepts an explicit CSV input path", () => {
    const fixture = makeFixture();
    const source = join(fixture, "data/inventory.csv");
    const alternate = join(fixture, "alternate.csv");
    cpSync(source, alternate);

    const report = execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--input", alternate],
      { cwd: fixture, encoding: "utf8" },
    );

    expect(report).toContain(`Input:       ${alternate}`);
    expect(report).toContain("Matched:     138");
  });

  it("matches a simple layer with one newly labelled sub-source", () => {
    const fixture = makeFixture();
    const source = join(fixture, "data/inventory.csv");
    const alternate = join(fixture, "alternate.csv");
    const csv = readFileSync(source, "utf8").replace(
      /,ecosystem-loss,Ecosystem Loss,,Vector,/,
      ",ecosystem-loss,Ecosystem Loss,Agriculture,Vector,",
    );
    writeFileSync(alternate, csv);

    const report = execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--input", alternate],
      { cwd: fixture, encoding: "utf8" },
    );

    expect(report).toContain("Matched:     138");
    expect(report).not.toContain("In CSV but NOT in JS config");
  });

  it("ignores rows whose layer keys are explicitly retired", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    const csv = readFileSync(csvPath, "utf8");
    writeFileSync(
      csvPath,
      `${csv.trimEnd()}\nRetired initiative,Exposure,Environment,other,coral-reefs,Coral Reefs,,Raster,Retired layer,MX-RETIRED-VIEW,Source,Citation,License,Uploaded\n`,
    );

    const report = execFileSync(process.execPath, [join(fixture, "scripts/import-inventory.mjs")], {
      cwd: fixture,
      encoding: "utf8",
    });

    expect(report).toContain("Ignored:     1 retired row(s)");
    expect(report).not.toContain("In CSV but NOT in JS config");
  });

  it("targets one repeated sub-source and the requested layer status only", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    const csv = readFileSync(csvPath, "utf8")
      .replace("MX-HHA9G-4VUF9-CREXQ", "MX-REDTEAM-SECOND-EARTHQUAKE")
      .replace(/(^[^\n]*,drought,[^\n]*),In development,/m, "$1,Pending removal,");
    writeFileSync(csvPath, csv);

    execFileSync(process.execPath, [join(fixture, "scripts/import-inventory.mjs"), "--apply"], {
      cwd: fixture,
    });

    const risk = readFileSync(join(fixture, "src/config/layers/risk.js"), "utf8");
    expect(risk.match(/MX-REDTEAM-SECOND-EARTHQUAKE/g)).toHaveLength(1);
    expect(risk).toContain('id: "MX-VCP83-3E2TG-PJWFJ"');

    const hazard = readFileSync(join(fixture, "src/config/layers/hazard.js"), "utf8");
    const droughtBlock = hazard.slice(
      hazard.indexOf('key: "drought"'),
      hazard.indexOf('key: "edra-crop-yield-reduction"'),
    );
    expect(droughtBlock).toContain('status: "disabled-pending-removal"');
    expect(hazard.match(/status: "disabled-pending-removal"/g)).toHaveLength(1);
  });

  it("round-trips hosted download files, including a corrected URL and several files per view", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    const csv = readFileSync(csvPath, "utf8")
      .replace(
        "https://gar-data.unepgrid.ch/2026/PGA_475y.tif,1392370312",
        "https://gar-data.unepgrid.ch/2026/PGA_475y_v2.tif,1400000000",
      )
      .replace(
        "https://gar-data.unepgrid.ch/2026/cs_phex.tif,10780516",
        "https://gar-data.unepgrid.ch/2026/cs_phex.tif; https://gar-data.unepgrid.ch/2026/cs_extra.tif,10780516; 42",
      );
    writeFileSync(csvPath, csv);

    const report = execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--apply"],
      {
        cwd: fixture,
        encoding: "utf8",
      },
    );
    expect(report).toContain("Download file updates (2)");

    const hazard = readFileSync(join(fixture, "src/config/layers/hazard.js"), "utf8");
    // The 475-year source is the second of five: only it changes.
    const pga = hazard.slice(hazard.indexOf('key: "earthquake-pga"'), hazard.indexOf('key: "cyclone-surge"'));
    expect(pga).toContain('downloads: [["https://gar-data.unepgrid.ch/2026/PGA_475y_v2.tif", 1400000000]]');
    expect(pga.match(/downloads:/g)).toHaveLength(5);
    expect(hazard).toContain(
      'downloads: [["https://gar-data.unepgrid.ch/2026/cs_phex.tif", 10780516], ["https://gar-data.unepgrid.ch/2026/cs_extra.tif", 42]]',
    );

    const second = execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--apply"],
      {
        cwd: fixture,
        encoding: "utf8",
      },
    );
    expect(second).toContain("nothing to change");
  });

  it("adds downloads to a first compound source without touching the layer", () => {
    const fixture = makeFixture();
    const configPath = join(fixture, "src/config/layers/hazard.js");
    const config = readFileSync(configPath, "utf8").replace(
      /(id: "MX-V07LO-829XA-4BIZ8",\n\s+label: "Depth",\n)\s+downloads: [^\n]+\n/,
      "$1",
    );
    writeFileSync(configPath, config);
    execFileSync(process.execPath, [join(fixture, "scripts/import-inventory.mjs"), "--apply"], {
      cwd: fixture,
    });
    const after = readFileSync(configPath, "utf8");
    const flooding = after.slice(after.indexOf('key: "river-flooding"'), after.indexOf("sources: ["));
    expect(flooding).not.toContain("downloads:");
    expect(after).toMatch(
      /id: "MX-V07LO-829XA-4BIZ8",\n\s+label: "Depth",\n\s+downloads: \[\["https:\/\/gar-data\.unepgrid\.ch\/2026\/global_pc_h25glob\.tif", 3601777774\]\],/,
    );
  });

  it("refuses to remove downloads without --allow-removals, and removes them with it", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    const original = readFileSync(csvPath, "utf8");
    writeFileSync(
      csvPath,
      original.replace(",https://gar-data.unepgrid.ch/2026/mangrokm2a.tif,11480843,", ",,,"),
    );
    const exposurePath = join(fixture, "src/config/layers/exposure.js");
    const before = readFileSync(exposurePath, "utf8");

    const refused = spawnSync(process.execPath, [join(fixture, "scripts/import-inventory.mjs"), "--apply"], {
      cwd: fixture,
      encoding: "utf8",
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stdout).toContain("Removals (1)");
    expect(refused.stdout).toContain("mangroves: hosted files 1 → 0");
    expect(refused.stderr).toContain("--apply refused");
    expect(readFileSync(exposurePath, "utf8")).toBe(before);

    execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--apply", "--allow-removals"],
      {
        cwd: fixture,
      },
    );
    const exposure = readFileSync(exposurePath, "utf8");
    expect(exposure).not.toContain("mangrokm2a");
    expect(exposure).toContain("forestkm2a.tif");
  });

  it("refuses a spreadsheet whose download and CSV columns are present but blank", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    // Every row keeps the three trailing columns but loses their values.
    const lines = readFileSync(csvPath, "utf8").split("\n");
    const blanked = lines.map((line, i) =>
      i === 0 || !line ? line : line.replace(/,[^,]*,[^,]*,[^,]*$/, ",,,"),
    );
    writeFileSync(csvPath, blanked.join("\n"));
    const result = spawnSync(process.execPath, [join(fixture, "scripts/import-inventory.mjs"), "--apply"], {
      cwd: fixture,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--apply refused");
    const removals = /Removals \((\d+)\)/.exec(result.stdout);
    expect(Number(removals[1])).toBeGreaterThan(50);
  });

  it("keeps downloads and CSV decisions when their columns are omitted", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    const lines = readFileSync(csvPath, "utf8")
      .split("\n")
      .map((line) => line.replace(/,[^,]*,[^,]*,[^,]*$/, ""));
    writeFileSync(csvPath, lines.join("\n"));
    const report = execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--apply"],
      {
        cwd: fixture,
        encoding: "utf8",
      },
    );
    expect(report).toContain("nothing to change");
  });

  it("imports a CSV download decision per compound source and round-trips it", () => {
    const fixture = makeFixture();
    const csvPath = join(fixture, "data/inventory.csv");
    const lines = readFileSync(csvPath, "utf8").split("\n");
    const index = lines.findIndex((line) => line.includes("MX-YBWIB-YLHIV-WKG2H"));
    lines[index] = lines[index].replace(/,yes$/, ",no: Reviewed and refused for this test.");
    writeFileSync(csvPath, lines.join("\n"));
    execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--apply", "--allow-removals"],
      {
        cwd: fixture,
      },
    );
    const risk = readFileSync(join(fixture, "src/config/layers/risk.js"), "utf8");
    const block = risk.slice(
      risk.indexOf('id: "MX-YBWIB-YLHIV-WKG2H"'),
      risk.indexOf("}", risk.indexOf('id: "MX-YBWIB-YLHIV-WKG2H"')),
    );
    expect(block).toContain('csvDownload: "no: Reviewed and refused for this test."');
    // Its neighbours keep yes.
    const first = risk.slice(
      risk.indexOf('id: "MX-VCP83-3E2TG-PJWFJ"'),
      risk.indexOf("}", risk.indexOf('id: "MX-VCP83-3E2TG-PJWFJ"')),
    );
    expect(first).toContain('csvDownload: "yes"');
    const second = execFileSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--apply"],
      {
        cwd: fixture,
        encoding: "utf8",
      },
    );
    expect(second).toContain("nothing to change");
  });

  it("rejects a CSV download value that is not yes, no: <reason> or blank", () => {
    const fixture = makeFixture();
    const source = join(fixture, "data/inventory.csv");
    const malformed = join(fixture, "malformed.csv");
    writeFileSync(malformed, readFileSync(source, "utf8").replace(/,yes\n/, ",maybe\n"));
    const result = spawnSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--input", malformed],
      {
        cwd: fixture,
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('"CSV download" must be yes, "no: <reason>" or blank (got "maybe")');
  });

  it("rejects malformed download cells", () => {
    const cases = [
      [
        "https://gar-data.unepgrid.ch/2026/cs_phex.tif,10780516",
        "https://gar-data.unepgrid.ch/2026/cs_phex.tif,",
        "1 download URL(s) but 0 size(s)",
      ],
      [
        "https://gar-data.unepgrid.ch/2026/cs_phex.tif,10780516",
        "http://gar-data.unepgrid.ch/2026/cs_phex.tif,10780516",
        "must use https",
      ],
      [
        "https://gar-data.unepgrid.ch/2026/cs_phex.tif,10780516",
        "https://gar-data.unepgrid.ch/2026/cs_phex.tif,10 MB",
        "whole number of bytes",
      ],
    ];
    for (const [from, to, message] of cases) {
      const fixture = makeFixture();
      const source = join(fixture, "data/inventory.csv");
      const malformed = join(fixture, "malformed.csv");
      writeFileSync(malformed, readFileSync(source, "utf8").replace(from, to));
      const result = spawnSync(
        process.execPath,
        [join(fixture, "scripts/import-inventory.mjs"), "--input", malformed],
        {
          cwd: fixture,
          encoding: "utf8",
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(message);
    }
  });

  it("requires the two download columns together", () => {
    const fixture = makeFixture();
    const source = join(fixture, "data/inventory.csv");
    const malformed = join(fixture, "malformed.csv");
    writeFileSync(malformed, readFileSync(source, "utf8").replace(",Download size (bytes)", ",Size"));
    const result = spawnSync(
      process.execPath,
      [join(fixture, "scripts/import-inventory.mjs"), "--input", malformed],
      {
        cwd: fixture,
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must supply "Download URL" and "Download size (bytes)" together');
  });
});
