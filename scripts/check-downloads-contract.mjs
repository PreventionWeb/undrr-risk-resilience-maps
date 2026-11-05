/**
 * Live contract check for the prototype data downloads (#64).
 *
 *   yarn test:downloads-contract                 # everything configured
 *   yarn test:downloads-contract --skip-files    # MapX checks only (no HEAD requests)
 *   yarn test:downloads-contract --view MX-…     # also vet a view not yet marked "yes"
 *
 * Like the EDRA and raster-legend contract checks, this does not run in
 * `yarn test` or CI: it depends on live services. Run it before marking a view
 * `CSV download: yes` in data/inventory.csv, after GRID adds or replaces a
 * hosted file, and when a MapX view id changes (see docs/downloads.md,
 * "Maintenance").
 *
 * Checks (each failure names its view or file):
 *
 * - Hosted files: every `downloads` URL answers a HEAD request with 200, and
 *   its content-length equals the configured size in bytes.
 * - CSV views (published vector views marked yes, plus any `--view`): the view
 *   exists in MapX, is `vt`, its attribute is a joined value (`jN_…`), and its
 *   attribute list includes `iso3cd` — or REGION_CODE_SOURCES names a sibling
 *   view that reads the same MapX source and has `iso3cd`.
 * - REGION_NAME_REFERENCE_VIEW exists, is `vt` and lists `maplab`.
 *
 * Warnings (not failures): published vector views nobody has reviewed yet
 * (blank "CSV download"), and how many CSV views carry no `maplab` of their own
 * (their names come from the reference view at download time).
 *
 * The view JSON comes from MapX's public `get/view/item` API, the same source
 * check-mapx-raster-legends.mjs reads. Nothing here reads attribute tables.
 */
import { TABS } from "../src/config/layers.js";
import { isLayerAvailable } from "../src/config/layers/status.js";
import {
  REGION_CODE_SOURCES,
  REGION_NAME_REFERENCE_VIEW,
  getViewDownloads,
} from "../src/config/downloads.js";

const args = process.argv.slice(2);
const SKIP_FILES = args.includes("--skip-files");
const EXTRA_VIEWS = args.flatMap((arg, i) => (args[i - 1] === "--view" ? [arg] : []));
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

const failures = [];
const warnings = [];
const fail = (subject, message) => failures.push({ subject, message });
const warn = (subject, message) => warnings.push({ subject, message });

/** Run `fn` over `items`, `CONCURRENCY` at a time. */
async function mapLimited(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

/** Every published, non-external view: `{ layer, source, view }`. */
const views = TABS.flatMap((tab) => tab.layers)
  .filter((layer) => isLayerAvailable(layer) && !layer.external)
  .flatMap((layer) =>
    layer.sources?.length
      ? layer.sources.map((source) => ({ layer, source, view: source }))
      : [{ layer, source: null, view: layer }],
  );
const labelOf = ({ layer, source }) => (source ? `${layer.key} [${source.label}]` : layer.key);

// ── Hosted files ─────────────────────────────────────────────────────────────

const files = views.flatMap((entry) =>
  getViewDownloads(entry.layer, entry.source).files.map((file) => ({ ...file, entry })),
);
if (!SKIP_FILES) {
  await mapLimited(files, async (file) => {
    const subject = `${labelOf(file.entry)} ${file.url}`;
    try {
      const response = await fetch(file.url, { method: "HEAD", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status !== 200) return fail(subject, `HEAD answered ${response.status}, expected 200`);
      const length = Number(response.headers.get("content-length"));
      if (length !== file.bytes) {
        fail(
          subject,
          `content-length ${length} ≠ configured ${file.bytes} bytes (update "Download size (bytes)")`,
        );
      }
    } catch (error) {
      fail(subject, `HEAD failed: ${error.message}`);
    }
  });
}

// ── MapX views ───────────────────────────────────────────────────────────────

const csvEntries = views.filter((entry) => getViewDownloads(entry.layer, entry.source).csv);
const toCheck = new Map(csvEntries.map((entry) => [entry.view.id, labelOf(entry)]));
for (const id of EXTRA_VIEWS) {
  const configured = views.find((entry) => entry.view.id === id);
  if (!toCheck.has(id)) toCheck.set(id, configured ? `${labelOf(configured)} (--view)` : "--view");
}
const needed = new Set([...toCheck.keys(), REGION_NAME_REFERENCE_VIEW]);
for (const [view, sibling] of REGION_CODE_SOURCES) if (toCheck.has(view)) needed.add(sibling);

const items = new Map();
await mapLimited([...needed], async (id) => {
  try {
    const response = await fetch(`https://api.mapx.org/get/view/item/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return items.set(id, { error: `MapX answered HTTP ${response.status}` });
    const item = await response.json();
    if (item?.id !== id) return items.set(id, { error: "MapX has no view with this id" });
    const attribute = item.data?.attribute ?? {};
    const names = [attribute.names ?? []].flat();
    items.set(id, {
      type: item.type,
      value: attribute.name,
      names,
      sourceId: item.data?.source?.layerInfo?.name,
    });
  } catch (error) {
    items.set(id, { error: `MapX request failed: ${error.message}` });
  }
});

let withoutMaplab = 0;
for (const [id, label] of toCheck) {
  const subject = `${label} ${id}`;
  const item = items.get(id);
  if (item.error) {
    fail(subject, item.error);
    continue;
  }
  if (item.type !== "vt") fail(subject, `type is "${item.type}", a CSV needs a vector (vt) view`);
  if (!/^j\d+_./.test(item.value ?? "")) {
    fail(subject, `value attribute "${item.value ?? "(none)"}" is not a joined value (jN_…)`);
  }
  if (!item.names.includes("maplab") && !EXTRA_VIEWS.includes(id)) withoutMaplab++;
  if (item.names.includes("iso3cd")) continue;
  const siblingId = REGION_CODE_SOURCES.get(id);
  if (!siblingId) {
    fail(subject, "no iso3cd in its attribute list, and no REGION_CODE_SOURCES sibling to borrow codes from");
    continue;
  }
  const sibling = items.get(siblingId);
  if (sibling.error) fail(subject, `region-code sibling ${siblingId}: ${sibling.error}`);
  else if (!sibling.names.includes("iso3cd")) fail(subject, `region-code sibling ${siblingId} has no iso3cd`);
  else if (sibling.sourceId !== item.sourceId) {
    fail(
      subject,
      `region-code sibling ${siblingId} reads another MapX source (${sibling.sourceId} ≠ ${item.sourceId})`,
    );
  }
}

const reference = items.get(REGION_NAME_REFERENCE_VIEW);
const referenceSubject = `REGION_NAME_REFERENCE_VIEW ${REGION_NAME_REFERENCE_VIEW}`;
if (reference.error) fail(referenceSubject, reference.error);
else if (reference.type !== "vt" || !reference.names.includes("maplab")) {
  fail(referenceSubject, "must be a vector view whose attribute list includes maplab (region names)");
}

for (const entry of views) {
  if (entry.layer.type === "vt" && !entry.view.csvDownload) {
    warn(
      `${labelOf(entry)} ${entry.view.id}`,
      'not reviewed for CSV ("CSV download" is blank): no CSV is offered',
    );
  }
}
if (withoutMaplab) {
  warn(
    `${withoutMaplab} CSV view(s)`,
    `carry no maplab of their own; names come from ${REGION_NAME_REFERENCE_VIEW} at download time`,
  );
}

// ── Report ───────────────────────────────────────────────────────────────────

console.log(
  `Hosted files: ${SKIP_FILES ? "skipped" : `${files.length} checked`}. CSV views: ${toCheck.size} checked` +
    `${EXTRA_VIEWS.length ? ` (${EXTRA_VIEWS.length} from --view)` : ""}. Region-name reference: ${REGION_NAME_REFERENCE_VIEW}.`,
);
if (warnings.length) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const { subject, message } of warnings) console.log(`  ⚠  ${subject}: ${message}`);
}
if (failures.length) {
  console.error(`\nFailures (${failures.length}):`);
  for (const { subject, message } of failures) console.error(`  ✗  ${subject}: ${message}`);
  console.error("\nDownloads contract check FAILED.");
  process.exit(1);
}
console.log("\nDownloads contract check passed.");
