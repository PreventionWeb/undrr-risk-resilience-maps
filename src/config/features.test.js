import { describe, expect, it } from "vitest";
import { downloadsEnabledFromSearch, inspectionEnabledFromSearch } from "./features.js";

describe("temporary map inspection policy", () => {
  it("is off globally and accepts an explicit runtime opt-in", () => {
    expect(inspectionEnabledFromSearch("")).toBe(false);
    for (const value of ["1", "true"]) expect(inspectionEnabledFromSearch(`?inspect=${value}`)).toBe(true);
  });

  it("allows explicit opt-out even if the global default is restored later", () => {
    expect(inspectionEnabledFromSearch("", true)).toBe(true);
    for (const value of ["0", "false", "", "yes", "FALSE"]) {
      expect(inspectionEnabledFromSearch(`?inspect=${value}`, true)).toBe(false);
    }
    expect(inspectionEnabledFromSearch("?inspect=1&inspect=0")).toBe(false);
  });
});

describe("prototype downloads flag", () => {
  it("is off without the parameter", () => {
    expect(downloadsEnabledFromSearch("")).toBe(false);
    expect(downloadsEnabledFromSearch("?inspect=1")).toBe(false);
  });

  it("turns on only for downloads=1 or downloads=true", () => {
    expect(downloadsEnabledFromSearch("?downloads=1")).toBe(true);
    expect(downloadsEnabledFromSearch("?downloads=true")).toBe(true);
    expect(downloadsEnabledFromSearch("?inspect=1&downloads=1")).toBe(true);
  });

  it("fails closed for blank, unknown, differently cased or repeated values", () => {
    for (const value of ["", "0", "false", "yes", "TRUE", "on", "2"]) {
      expect(downloadsEnabledFromSearch(`?downloads=${value}`)).toBe(false);
    }
    expect(downloadsEnabledFromSearch("?downloads")).toBe(false);
    expect(downloadsEnabledFromSearch("?downloads=1&downloads=1")).toBe(false);
    expect(downloadsEnabledFromSearch("?downloads=1&downloads=0")).toBe(false);
  });

  it("lets an explicit value override a future default", () => {
    expect(downloadsEnabledFromSearch("", true)).toBe(true);
    expect(downloadsEnabledFromSearch("?downloads=0", true)).toBe(false);
  });
});
