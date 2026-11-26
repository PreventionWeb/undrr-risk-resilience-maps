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

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });

function main(baseRef = "origin/main") {
  // A base that doesn't resolve is an error, never "nothing to compare":
  // otherwise a mistyped ref or a missing remote passes silently.
  try {
    git("rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`);
  } catch {
    console.error(`Cannot resolve base revision "${baseRef}".`);
    return 2;
  }
  let before;
  try {
    before = git("show", `${baseRef}:${LEDGER}`);
  } catch (error) {
    // Only a base without the file (the PR that adds it) has nothing to compare.
    if (/does not exist|exists on disk, but not in/.test(String(error.stderr))) {
      console.log(`${baseRef} has no ${LEDGER}; nothing to compare.`);
      return 0;
    }
    console.error(`Cannot read ${LEDGER} at ${baseRef}: ${String(error.stderr).trim()}`);
    return 2;
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
