#!/usr/bin/env node
/**
 * Check that a deployed viewer survives a release (PreventionWeb/undrr-risk-resilience-maps#89).
 *
 * An iframe opened before a release can hold the old `embed.html` (in a
 * browser, a proxy or a CDN) after the new build replaces it. That HTML names
 * the old release's hashed bundles, and its JavaScript later imports more
 * of them on demand. If the host has already deleted them, the embed stays blank: what
 * happened in the v0.0.15 → v0.0.16 rollout. See docs/deployment.md
 * "Caching across releases" for the contract this checks.
 *
 * Usage:
 *   node scripts/check-release-assets.mjs <base-url>                      # check the live build
 *   node scripts/check-release-assets.mjs <base-url> --record before.json # also save its bundle URLs
 *   node scripts/check-release-assets.mjs <base-url> --expect before.json # and require saved ones still load
 *
 * <base-url> is the app's directory, e.g. https://www.undrr.org/m/risk-and-resilience-maps/
 *
 * Release routine: run with --record before the tag deploys, then with
 * --expect (same file) after it has. Exit status is non-zero on any failure.
 *
 * www.undrr.org answers scripted requests with a Cloudflare bot challenge
 * (403). Pass a header the zone allowlists with `--header "Name: value"`
 * (repeatable); the script never tries to get past a challenge itself. The
 * GitHub Pages preview fails the HTML check by design: Pages sends
 * `max-age=600` and replaces the whole site on each deploy.
 *
 * It checks:
 *   - each HTML entry (with and without layer parameters) is served with a
 *     Cache-Control that makes caches revalidate it;
 *   - every bundle the HTML references, and every chunk those bundles import,
 *     loads as JavaScript or CSS (not an HTML error page);
 *   - the HTML for a URL with layer parameters names the same bundles as the
 *     bare URL (a query-keyed cache serving an older copy shows up here);
 *   - with --expect, every bundle recorded earlier still loads.
 *
 * Hashed bundles should be long-lived (`immutable`); a short lifetime is
 * reported as a warning, not a failure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** HTML entry URLs to check, relative to the base. Layer parameters are part of the cache key. */
export const ENTRY_PATHS = [
  "",
  "index.html",
  "embed.html",
  "embed.html?tab=gar&layers=major-crop-area-exposed",
  "embed.html?tab=hazard&panel=collapsed",
];

/** A Vite-hashed file name: `name-<8+ char hash>.js|css`. */
const HASHED = /[\w.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/;

/**
 * Hashed bundle URLs an HTML document references (`src`/`href`), absolute.
 * @param {string} html
 * @param {string} documentUrl
 * @returns {string[]}
 */
export function htmlAssetRefs(html, documentUrl) {
  const refs = new Set();
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const url = new URL(match[1], documentUrl);
    if (url.origin === new URL(documentUrl).origin && HASHED.test(url.pathname)) refs.add(stripQuery(url));
  }
  return [...refs].sort();
}

/**
 * Sibling chunk URLs a bundle imports (`from"./x-HASH.js"`, `import("./x-HASH.js")`,
 * Vite's preload lists), absolute.
 * @param {string} source
 * @param {string} bundleUrl
 * @returns {string[]}
 */
export function bundleAssetRefs(source, bundleUrl) {
  const refs = new Set();
  for (const match of source.matchAll(
    /["'`]((?:\.{1,2}\/|assets\/|\/)[\w./-]+?-[A-Za-z0-9_-]{8,}\.(?:js|css))["'`]/g,
  )) {
    // Vite writes preload paths relative to the app (`assets/x.js`) and imports
    // relative to the bundle (`./x.js`); both resolve under the bundle's directory here.
    const path = match[1].startsWith("assets/") ? `../${match[1]}` : match[1];
    refs.add(stripQuery(new URL(path, bundleUrl)));
  }
  return [...refs].sort();
}

function stripQuery(url) {
  return `${url.origin}${url.pathname}`;
}

/**
 * Whether a Cache-Control header makes every cache revalidate the response
 * before reusing it.
 * @param {string|null} header
 */
export function revalidates(header) {
  if (!header) return false;
  const directives = header
    .toLowerCase()
    .split(",")
    .map((part) => part.trim());
  if (directives.includes("no-cache") || directives.includes("no-store")) return true;
  const age = (name) => {
    const directive = directives.find((part) => part.startsWith(`${name}=`));
    return directive ? Number(directive.slice(name.length + 1)) : null;
  };
  // s-maxage governs shared caches (the CDN), max-age everyone else.
  const shared = age("s-maxage") ?? age("max-age");
  return age("max-age") === 0 && shared === 0;
}

/** Whether a Cache-Control header lets a hashed bundle be kept for at least a day. */
export function longLived(header) {
  const match = /max-age=(\d+)/i.exec(header ?? "");
  return Boolean(match && Number(match[1]) >= 86_400);
}

/** Extra request headers (`--header "Name: value"`), e.g. a Cloudflare allowlist token. */
const extraHeaders = {};

async function get(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "release-asset-check", ...extraHeaders },
  });
  return { response, body: await response.text() };
}

/** Why a response is not the file: its status, and a Cloudflare challenge said plainly. */
function describeFailure(response) {
  const challenged = response.headers.get("cf-mitigated") === "challenge";
  const type = response.headers.get("content-type") ?? "(no type)";
  return challenged
    ? `${response.status}, a Cloudflare bot challenge (pass an allowlisted --header, or check from a browser)`
    : `${response.status} ${type}`;
}

function isAsset(response, url) {
  const type = response.headers.get("content-type") ?? "";
  const expected = url.endsWith(".css") ? /text\/css/ : /javascript|ecmascript/;
  return response.ok && expected.test(type);
}

/** Fetch every bundle reachable from `start`, following chunk imports. */
async function crawl(start, failures, warnings) {
  const seen = new Set();
  const queue = [...start];
  while (queue.length > 0) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const { response, body } = await get(url);
    if (!isAsset(response, url)) {
      failures.push(`${url}: ${describeFailure(response)}`);
      continue;
    }
    if (!longLived(response.headers.get("cache-control"))) {
      warnings.push(
        `${url}: Cache-Control "${response.headers.get("cache-control") ?? ""}" is short for a hashed file`,
      );
    }
    if (url.endsWith(".js")) queue.push(...bundleAssetRefs(body, url));
  }
  return [...seen].sort();
}

export async function main(argv = process.argv.slice(2)) {
  const [baseArg] = argv.filter((arg, i) => !arg.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  const option = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (!baseArg) {
    console.error(
      "Usage: node scripts/check-release-assets.mjs <base-url> [--record file] [--expect file] [--header 'Name: value']...",
    );
    return 2;
  }
  argv.forEach((arg, i) => {
    if (arg !== "--header") return;
    const [name, ...value] = (argv[i + 1] ?? "").split(":");
    if (name.trim() && value.length > 0) extraHeaders[name.trim()] = value.join(":").trim();
  });
  const base = new URL(baseArg.endsWith("/") ? baseArg : `${baseArg}/`);
  const failures = [];
  const warnings = [];

  const entryAssets = new Map();
  for (const path of ENTRY_PATHS) {
    const url = new URL(path, base).href;
    const { response, body } = await get(url);
    if (!response.ok) {
      failures.push(`${url}: ${describeFailure(response)}`);
      continue;
    }
    const cacheControl = response.headers.get("cache-control");
    if (!revalidates(cacheControl)) {
      failures.push(
        `${url}: Cache-Control "${cacheControl ?? "(none)"}" lets a cache serve this HTML without revalidating`,
      );
    }
    entryAssets.set(path, htmlAssetRefs(body, response.url));
  }

  // The same entry with and without parameters must name the same build.
  const bare = entryAssets.get("embed.html");
  for (const [path, assets] of entryAssets) {
    if (bare && path.startsWith("embed.html?") && assets.join() !== bare.join()) {
      failures.push(
        `${new URL(path, base).href}: names different bundles from embed.html (a stale cached copy?)`,
      );
    }
  }

  const assets = await crawl([...new Set([...entryAssets.values()].flat())], failures, warnings);

  let ref = null;
  try {
    const { response, body } = await get(new URL("maps-ref.txt", base).href);
    if (response.ok && !/^\s*</.test(body)) ref = body.trim();
  } catch {
    // maps-ref.txt is written by the UNDRR build only; the Pages preview has none.
  }

  const expectFile = option("--expect");
  if (expectFile) {
    const recorded = JSON.parse(readFileSync(expectFile, "utf8"));
    const retained = await crawl(recorded.assets ?? [], failures, warnings);
    console.log(`Previous build (${recorded.ref ?? "unknown ref"}): ${retained.length} bundle(s) checked`);
  }

  const recordFile = option("--record");
  if (recordFile) {
    writeFileSync(recordFile, `${JSON.stringify({ base: base.href, ref, assets }, null, 2)}\n`);
    console.log(`Recorded ${assets.length} bundle URL(s) to ${recordFile}`);
  }

  console.log(`Build: ${ref ?? "(no maps-ref.txt)"}`);
  console.log(`Entries: ${entryAssets.size}/${ENTRY_PATHS.length}, bundles: ${assets.length}`);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.log(failures.length === 0 ? "OK" : `${failures.length} failure(s)`);
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
