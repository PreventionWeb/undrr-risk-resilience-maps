import { describe, expect, it } from "vitest";
import { ledgerKeys, removedKeys } from "./check-public-keys-ledger.mjs";

describe("public key ledger diff", () => {
  it("reads keys, skipping comments and blank lines", () => {
    expect(ledgerKeys("# header\n\nflood\r\n  quake  \n")).toEqual(["flood", "quake"]);
  });

  it("reports a deleted key and a key edited into a new spelling", () => {
    expect(removedKeys("flood\nquake\n", "quake\n")).toEqual(["flood"]);
    expect(removedKeys("flood\n", "flood-100y\n")).toEqual(["flood"]);
    expect(removedKeys("flood\n", "# moved\nquake\nflood\n")).toEqual([]);
  });
});
