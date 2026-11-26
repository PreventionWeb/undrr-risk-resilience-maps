/**
 * Public layer keys stay valid across releases (PreventionWeb/undrr-risk-resilience-maps#89).
 *
 * Shared links (`#gar?layers=major-crop-area-exposed`), citations and embed URLs
 * name layers by key, never by MapX view id, so replacing a view only changes
 * a layer's `id`. What breaks those links is a key disappearing. The list in
 * data/public-layer-keys.txt records every key a release has published; this
 * suite fails if one no longer names a layer and has not been retired on
 * purpose, and asks for new keys to be recorded. scripts/check-public-keys-ledger.mjs
 * (a CI step) stops lines being deleted from the list.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getLayerRegistry } from "./registry.js";

const ROOT = resolve(import.meta.dirname, "../..");

function readList(path) {
  return readFileSync(resolve(ROOT, path), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const publicKeys = readList("data/public-layer-keys.txt");
const removedKeys = new Set(readList("data/removed-layer-keys.txt"));

describe("public layer keys", () => {
  const registry = getLayerRegistry();

  it("lists each key once", () => {
    expect(publicKeys.length).toBe(new Set(publicKeys).size);
  });

  it("keeps every published key naming a layer, unless it was retired on purpose", () => {
    const broken = publicKeys.filter((key) => !removedKeys.has(key) && !registry.byKey(key));
    expect(
      broken,
      "These public keys no longer name a layer, so links that use them lose the layer. Restore the key, " +
        "or retire it in data/removed-layer-keys.txt and update the pages that link to it (docs/inventory.md).",
    ).toEqual([]);
  });

  it("retires a key only once its layer has left the config", () => {
    // The importer ignores every inventory row under a retired key, so a layer
    // still configured under one would stop receiving its MapX id and copy updates.
    const stillConfigured = [...removedKeys].filter((key) => registry.byKey(key));
    expect(
      stillConfigured,
      "These keys are retired in data/removed-layer-keys.txt but still name a layer. " +
        "Remove the layer from the config, or un-retire the key.",
    ).toEqual([]);
  });

  it("records every key the app currently publishes", () => {
    const listed = new Set(publicKeys);
    const missing = registry.urlKeyOrder().filter((key) => !listed.has(key));
    expect(missing, "Add these newly published keys to data/public-layer-keys.txt.").toEqual([]);
  });
});
