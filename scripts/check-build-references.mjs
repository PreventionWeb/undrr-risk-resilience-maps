#!/usr/bin/env node
/**
 * Check that a build's files reference each other under one cache buster.
 *
 * Output file names are fixed, so the `?v=<build id>` query that
 * `buildQuery()` in vite.config.js appends is what stops a cache pairing
 * chunks from two builds. Two builds' chunks do not link together: their
 * internal export names differ (PreventionWeb/undrr-risk-resilience-maps#91).
 * This fails if a reference between the build's own files lacks the query,
 * if two references carry different build ids, or if a file in `assets/` is
 * referenced by nothing (a sign the reference forms changed).
 *
 * Usage: node scripts/check-build-references.mjs [dist-dir]   (default: dist)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Every quoted reference to one of `names` in `text`, with its query.
 * @param {string} text
 * @param {string[]} names - output file base names (`shared.js`)
 * @returns {Array<{ path: string, name: string, query: string|null }>}
 */
export function findReferences(text, names) {
  if (names.length === 0) return [];
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(["'\`])((?:\\./|(?:[^"'\`\\s]*/)?assets/)(${escaped.join("|")}))(\\?[^"'\`\\s]*)?\\1`,
    "g",
  );
  return [...text.matchAll(pattern)].map((m) => ({ path: m[2], name: m[3], query: m[4] ?? null }));
}

/**
 * Problems with a build's internal references.
 * @param {Array<{ file: string, text: string }>} files - the build's HTML, JS and CSS
 * @param {string[]} assetNames - base names of the files in `assets/`
 * @returns {string[]}
 */
export function checkReferences(files, assetNames) {
  const problems = [];
  const queries = new Set();
  let count = 0;
  for (const { file, text } of files) {
    for (const reference of findReferences(text, assetNames)) {
      count += 1;
      if (!reference.query || !/^\?v=[0-9a-f]+$/.test(reference.query)) {
        problems.push(`${file}: "${reference.path}" has no ?v= build id`);
      } else queries.add(reference.query);
    }
  }
  if (count === 0) problems.push("No references between the build's files were found");
  if (queries.size > 1)
    problems.push(`References carry ${queries.size} different build ids: ${[...queries].join(", ")}`);
  return problems;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function main(distArg = "dist") {
  const dist = resolve(distArg);
  const paths = walk(dist).filter((path) => /\.(?:html|js|css)$/.test(path));
  const assetNames = paths
    .filter((path) => relative(dist, path).startsWith("assets/") && /\.(?:js|css)$/.test(path))
    .map((path) => path.split("/").pop());
  const files = paths.map((path) => ({ file: relative(dist, path), text: readFileSync(path, "utf8") }));
  const problems = checkReferences(files, assetNames);
  for (const name of assetNames) {
    const referenced = files.some(({ text }) => findReferences(text, [name]).length > 0);
    if (!referenced) problems.push(`assets/${name} is not referenced by any file in the build`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL: ${problem}`);
    return 1;
  }
  console.log(`${relative(process.cwd(), dist) || "."}: ${assetNames.length} files, one build id.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2]);
}
