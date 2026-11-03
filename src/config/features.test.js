import { describe, expect, it } from "vitest";
import { inspectionEnabledFromSearch } from "./features.js";

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
