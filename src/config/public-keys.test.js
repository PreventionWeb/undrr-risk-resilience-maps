/**
 * Public layer keys stay resolvable across releases (PreventionWeb/undrr-risk-resilience-maps#89).
 *
 * A shared link (`#gar?layers=major-crop-area-exposed`) and an embed URL name
 * layers by key, never by MapX view id, so replacing a view only changes the
 * layer's `id`. What can break those links is a key disappearing. The ledger in
 * data/public-layer-keys.txt records every key that has been published; this
 * suite fails if one stops resolving, and asks for new ones to be recorded.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TABS } from "./layers.js";
import { createLayerRegistry, getLayerRegistry } from "./registry.js";
import { parseHash } from "../state/hash.js";
import { parseEmbedParams } from "../embed/params.js";

const ROOT = resolve(import.meta.dirname, "../..");

function readList(path) {
  return readFileSync(resolve(ROOT, path), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const publicKeys = readList("data/public-layer-keys.txt");
const removedKeys = new Set(readList("data/removed-layer-keys.txt"));
const aliases = TABS.flatMap((tab) => tab.layers).flatMap((layer) =>
  (layer.aliases ?? []).map((alias) => [alias, layer.key]),
);

describe("public layer keys", () => {
  const registry = getLayerRegistry();

  it("lists each key once", () => {
    expect(publicKeys.length).toBe(new Set(publicKeys).size);
  });

  it("keeps every published key resolving to a layer, or retires it explicitly", () => {
    const broken = publicKeys.filter(
      (key) => !removedKeys.has(key) && !registry.byKey(registry.canonicalKey(key)),
    );
    expect(
      broken,
      "These public keys no longer resolve. Add each one to its layer's `aliases` " +
        "(renamed) or to data/removed-layer-keys.txt (retired); see docs/inventory.md.",
    ).toEqual([]);
  });

  it("records every key the app currently publishes", () => {
    const listed = new Set(publicKeys);
    const missing = registry.urlKeyOrder().filter((key) => !listed.has(key));
    expect(missing, "Add these newly published keys to data/public-layer-keys.txt.").toEqual([]);
  });

  it("does not alias a key that has been retired", () => {
    expect(aliases.filter(([alias]) => removedKeys.has(alias))).toEqual([]);
  });
});

describe("a renamed layer key", () => {
  // A copy of the GAR layer from the issue, after a rename and a view
  // replacement: the old key and the old view id must both be history.
  const original = TABS.flatMap((tab) => tab.layers).find((layer) => layer.key === "major-crop-area-exposed");
  const renamed = {
    ...original,
    id: "MX-REPLACED-VIEW-00001",
    key: "major-crop-area-exposed-100y",
    aliases: ["major-crop-area-exposed"],
  };
  const tabs = TABS.map((tab) => ({
    ...tab,
    layers: tab.layers.map((layer) => (layer === original ? renamed : layer)),
  }));
  const registry = createLayerRegistry(tabs);

  it("is a GAR layer in the shipped config", () => {
    expect(original?.id).toMatch(/^MX-/);
  });

  it("still opens from a link shared before the rename", () => {
    const { layers } = parseHash({ location: { hash: "#gar?layers=major-crop-area-exposed" } });
    const entry = layers.map((layer) => ({ ...layer, key: registry.canonicalKey(layer.key) }))[0];
    expect(entry.key).toBe("major-crop-area-exposed-100y");
    expect(registry.byKey(entry.key).id).toBe("MX-REPLACED-VIEW-00001");
  });

  it("still opens from an embed URL written before the rename", () => {
    const params = parseEmbedParams("?tab=gar&layers=major-crop-area-exposed&allow=major-crop-area-exposed", {
      allTabs: tabs,
    });
    expect(params.empty).toBe(false);
    expect(params.layerKeys).toEqual(["major-crop-area-exposed-100y"]);
    expect(params.layers).toEqual([{ key: "major-crop-area-exposed-100y", sourceIdx: 0 }]);
  });
});
