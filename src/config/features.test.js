import { describe, expect, it } from "vitest";
import {
  downloadsEnabledFromSearch,
  inspectionEnabledFromSearch,
  resolveDownloadsEnabled,
} from "./features.js";

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

describe("map downloads policy", () => {
  it("is on without the parameter", () => {
    expect(downloadsEnabledFromSearch("")).toBe(true);
    expect(downloadsEnabledFromSearch("?inspect=1")).toBe(true);
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

  it("cannot bypass the repository kill switch with URL parameters or options", () => {
    for (const search of ["", "?downloads=1", "?downloads=true", "?downloads=0"]) {
      expect(downloadsEnabledFromSearch(search, false)).toBe(false);
    }
    expect(resolveDownloadsEnabled(true, false)).toBe(false);
    expect(resolveDownloadsEnabled(false, true)).toBe(false);
    expect(resolveDownloadsEnabled()).toBe(true);
    for (const value of [null, "true", 1]) expect(resolveDownloadsEnabled(value)).toBe(false);
  });

  it("lets an instance opt out", () => {
    expect(downloadsEnabledFromSearch("", true)).toBe(true);
    expect(downloadsEnabledFromSearch("?downloads=0", true)).toBe(false);
  });
});
