#!/usr/bin/env node
/**
 * Fail if data/public-layer-keys.txt lost a key relative to a base revision.
 *
 * src/config/public-keys.test.js checks that every key in the ledger still
 * names a layer or is retired, but it reads the ledger as it is now: deleting a key (or editing it
 * into a new spelling) would pass it. This compares against the base branch.
 *
 * Usage: node scripts/check-public-keys-ledger.mjs [base-ref]   (default: origin/main)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LEDGER = "data/public-layer-keys.txt";

/** The keys in a ledger file's text, ignoring comments and blank lines. */
export function ledgerKeys(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** Keys in `before` that `after` no longer lists. */
export function removedKeys(before, after) {
  const kept = new Set(ledgerKeys(after));
  return ledgerKeys(before).filter((key) => !kept.has(key));
}

function main(baseRef = "origin/main") {
  let before;
  try {
    before = execFileSync("git", ["show", `${baseRef}:${LEDGER}`], { encoding: "utf8", stdio: "pipe" });
  } catch {
    // The base has no ledger yet (the PR that adds it): nothing to compare.
    console.log(`${baseRef} has no ${LEDGER}; nothing to compare.`);
    return 0;
  }
  const removed = removedKeys(before, readFileSync(resolve(LEDGER), "utf8"));
  if (removed.length === 0) {
    console.log(`${LEDGER}: no public key removed relative to ${baseRef}.`);
    return 0;
  }
  console.error(
    `${LEDGER} no longer lists ${removed.map((key) => `"${key}"`).join(", ")}.\n` +
      "Public keys are never removed from the list: restore the line. To drop a key, retire it in " +
      "data/removed-layer-keys.txt instead. See docs/inventory.md.",
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2]);
}
