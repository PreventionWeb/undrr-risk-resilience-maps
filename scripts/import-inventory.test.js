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
    expect(report).toContain("Matched:     103");
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

    expect(report).toContain("Matched:     103");
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
      .replace(/(^[^\n]*,drought,[^\n]*),In development$/m, "$1,Pending removal");
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
