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
    writeFileSync(csvPath, readFileSync(csvPath, "utf8").replace(",Note,Explainer link", ""));
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
      () => 'Uploaded,"First line, with a comma\nSecond line: $&",https://example.org/methodology#rice',
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
});
