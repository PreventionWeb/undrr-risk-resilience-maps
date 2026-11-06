/**
 * The CSV download flow (#64); visibility is governed by features.js.
 *
 * `createDownloads(...)` runs behind the "Download CSV" buttons that
 * src/ui/download-links.js draws: one progress dialog per instance, the MapX
 * table read (src/sdk/table.js), the CSV (src/utils/region-csv.js) and the
 * browser download.
 *
 * - Every MapX call of a run checks whether the dialog was closed first, so a
 *   cancelled download stops (only removing a view it already added).
 * - A temporary view is bracketed by `onTemporaryView(true/false)`; the
 *   sidebar hides the map frame meanwhile, because MapX paints a view before
 *   it can be made transparent (see src/sdk/table.js).
 * - A view without region codes takes them from a sibling view on the same
 *   source (REGION_CODE_SOURCES), matched row by row.
 * - Region names for views without `maplab` are read from
 *   REGION_NAME_REFERENCE_VIEW and kept in memory and in localStorage (30
 *   days), so the extra read happens rarely. If it fails, the CSV still
 *   downloads with a blank name column and the dialog says so.
 * - If MapX has not started and cannot start where it is (the map does not
 *   warm up behind information pages on this device), the dialog says so at
 *   once and offers to open the map, rather than waiting.
 *
 * - A link to a hosted file over 1 GB (`data-large`) asks for confirmation in
 *   the same dialog before the browser starts the download.
 *
 * With the flag off none of this is created, so the UI is unchanged.
 */
import {
  REGION_CODE_SOURCES,
  REGION_NAME_REFERENCE_VIEW,
  formatBytes,
  getViewDownloads,
} from "../config/downloads.js";
import { getLayerRegistry } from "../config/registry.js";
import {
  REGION_CODE_ATTRIBUTE,
  attachRegionCodes,
  buildRegionCsv,
  csvFilename,
  csvMetadata,
  hasRegionNames,
  regionNamesFrom,
  viewLabel,
} from "../utils/region-csv.js";
import { saveTextFile } from "../utils/csv.js";
import { fetchViewTable } from "../sdk/table.js";
import { createDownloadDialog } from "./download-dialog.js";

/** How long the CSV dialog waits for MapX to finish starting (while it can) before giving up. */
export const SDK_READY_WAIT_MS = 30_000;
/** How long cached region names are used before they are read again. */
export const REGION_NAMES_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// v2: names now include the map service's own codes (f8d03c0); v1 caches lack them.
const REGION_NAMES_STORAGE_PREFIX = "undrr-risk-maps:region-names:v2:";

/** A failure the dialog shows with a message and, optionally, an action button. */
class DownloadError extends Error {
  constructor(message, action = null) {
    super(message);
    this.name = "DownloadError";
    this.action = action;
  }
}

/**
 * Resolve once `isReady()` is true. Rejects at once when the map cannot load
 * where it is, after `timeoutMs` otherwise, and when the run is cancelled.
 */
function whenReady({ isReady, onReadyChange, canLoadMap, timeoutMs, notStarted, isCancelled }) {
  if (isReady()) return Promise.resolve();
  if (!canLoadMap()) return Promise.reject(notStarted());
  return new Promise((resolve, reject) => {
    let off = () => {};
    const finish = (fn) => {
      clearTimeout(timer);
      clearInterval(poll);
      off();
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new DownloadError("The map service did not finish loading in time. Please try again.")),
        ),
      timeoutMs,
    );
    // The map can stop being loadable (the tab hidden) or the dialog close.
    const poll = setInterval(() => {
      if (isCancelled()) finish(() => reject(new DownloadError("Cancelled.")));
      else if (!canLoadMap()) finish(() => reject(notStarted()));
    }, 500);
    off = onReadyChange((ready) => {
      if (ready) finish(resolve);
    });
  });
}

/** localStorage, or null where it is blocked. */
function defaultStorage(doc) {
  try {
    return (doc.defaultView ?? window).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The CSV flow for one app instance.
 *
 * @param {object} options
 * @param {Document} [options.doc]
 * @param {ReturnType<typeof getLayerRegistry>} [options.registry] - the instance's layers
 * @param {(viewId: string) => boolean} options.isViewWanted - a layer record
 *   wants this view on the map (see src/sdk/table.js)
 * @param {(viewId: string) => boolean} options.isViewLoaded - the session has
 *   loaded this view
 * @param {(viewId: string) => void} [options.onViewLoaded] - a temporary add loaded it
 * @param {(active: boolean) => void} [options.onTemporaryView] - a temporary view
 *   is on the map (true) / gone (false)
 * @param {() => boolean} options.isReady - MapX is ready
 * @param {(fn: (ready: boolean) => void) => () => void} options.onReadyChange
 * @param {() => boolean} [options.canLoadMap] - MapX can make progress where the map is now
 * @param {(tabId: string) => void} [options.openMap] - show a map tab (the "Open the map" action)
 * @param {() => { ask: Function }} options.getSdk
 * @param {() => string} [options.viewerUrl] - the viewer this file comes from
 * @param {() => Date} [options.now]
 * @param {(doc: Document, text: string, filename: string) => void} [options.save]
 * @param {Storage|null} [options.storage] - where region names are cached
 * @param {number} [options.readyTimeoutMs]
 * @param {string} [options.regionNameView]
 */
export function createDownloads({
  doc = document,
  registry = getLayerRegistry(),
  isViewWanted,
  isViewLoaded,
  onViewLoaded = () => {},
  onTemporaryView = () => {},
  isReady,
  onReadyChange,
  canLoadMap = () => true,
  openMap = null,
  getSdk,
  viewerUrl = () => "",
  now = () => new Date(),
  save = saveTextFile,
  startFileDownload = (url, filename) => {
    // A fresh link outside the panel, so the click is not caught again here.
    // A new tab, like the file links: the viewer's own tab is never replaced.
    const link = doc.createElement("a");
    link.href = url;
    link.download = filename;
    link.target = "_blank";
    link.rel = "noopener";
    link.hidden = true;
    doc.body.appendChild(link);
    link.click();
    link.remove();
  },
  storage = defaultStorage(doc),
  readyTimeoutMs = SDK_READY_WAIT_MS,
  regionNameView = REGION_NAME_REFERENCE_VIEW,
}) {
  const dialog = createDownloadDialog({ doc });
  /** Region names read this session (see cachedNames). */
  let regionNames = null;
  /** Sibling tables region codes are borrowed from (REGION_CODE_SOURCES), read this session. */
  const codeTables = new Map();

  const storageKey = REGION_NAMES_STORAGE_PREFIX + regionNameView;

  function cachedNames() {
    if (regionNames) return regionNames;
    try {
      const saved = JSON.parse(storage?.getItem(storageKey) ?? "null");
      if (saved && Array.isArray(saved.names) && now() - new Date(saved.savedAt) < REGION_NAMES_MAX_AGE_MS) {
        regionNames = new Map(saved.names);
      }
    } catch {
      // Unreadable or blocked storage: read the names again.
    }
    return regionNames;
  }

  function rememberNames(names) {
    regionNames = names;
    try {
      storage?.setItem(storageKey, JSON.stringify({ savedAt: now().toISOString(), names: [...names] }));
    } catch {
      // Storage full or blocked: the session copy is enough.
    }
  }

  function tableOptions(stepper) {
    return {
      isLoaded: isViewLoaded,
      isWanted: isViewWanted,
      onLoaded: onViewLoaded,
      onTemporary: onTemporaryView,
      isCancelled: stepper.isCancelled,
    };
  }

  /**
   * Names for a table without `maplab`. `{ names, failed }`: a failure leaves
   * the names blank rather than failing the download (the caller says so).
   * A cancellation is passed on.
   */
  async function referenceNames(stepper) {
    const cached = cachedNames();
    if (cached) return { names: cached, failed: false };
    try {
      const rows = await fetchViewTable(getSdk(), regionNameView, tableOptions(stepper));
      const names = regionNamesFrom(rows);
      if (names.size === 0) throw new Error("The reference view returned no region names.");
      rememberNames(names);
      return { names, failed: false };
    } catch (error) {
      if (error?.code === "cancelled") throw error;
      console.warn("Could not read region names for the CSV; leaving them blank:", error);
      return { names: new Map(), failed: true };
    }
  }

  /** The layer and compound source a view belongs to, from the instance's registry or the whole config. */
  function lookup(viewId) {
    return registry.byViewId(viewId) ?? getLayerRegistry().byViewId(viewId);
  }

  /**
   * Generate and download the CSV for a view, through the progress dialog.
   * @param {string} viewId
   * @param {{ opener?: Element|null }} [options] - focus returns here on close
   * @returns {boolean} whether the dialog opened
   */
  function requestCsv(viewId, { opener } = {}) {
    const entry = lookup(viewId);
    if (!entry) return false;
    const { layer, source, tab } = entry;
    if (!getViewDownloads(layer, source ?? null).csv) return false;
    const label = viewLabel(layer, source);
    const filename = csvFilename(layer.key, viewId);

    const notStarted = () =>
      new DownloadError(
        "The map has not started yet, and it only starts once a map is shown on this device. Open the map, then try the download again.",
        openMap && tab ? { label: "Open the map", run: () => openMap(tab.id) } : null,
      );

    dialog.open({
      title: `Download CSV: ${label}`,
      opener,
      // The dialog shows "fetching" before calling this.
      async run(stepper) {
        await whenReady({
          isReady,
          onReadyChange,
          canLoadMap,
          timeoutMs: readyTimeoutMs,
          notStarted,
          isCancelled: stepper.isCancelled,
        });
        let rows = await fetchViewTable(getSdk(), viewId, tableOptions(stepper));
        // A view without region codes borrows them from a sibling on the same source.
        const codeSource = REGION_CODE_SOURCES.get(viewId);
        if (codeSource && !rows.some((row) => row && REGION_CODE_ATTRIBUTE in row)) {
          // A sibling's codes do not change during a session: kept once they
          // have matched, so a failed match is read again on Try again.
          const codeRows =
            codeTables.get(codeSource) ?? (await fetchViewTable(getSdk(), codeSource, tableOptions(stepper)));
          rows = attachRegionCodes(rows, codeRows);
          codeTables.set(codeSource, codeRows);
        }
        const needsNames =
          !hasRegionNames(rows) &&
          viewId !== regionNameView &&
          rows.some((row) => row && REGION_CODE_ATTRIBUTE in row);
        const { names, failed } = needsNames
          ? await referenceNames(stepper)
          : { names: new Map(), failed: false };
        if (stepper.isCancelled()) return null;
        stepper.step("processing");
        const result = buildRegionCsv(rows, {
          valueLabel: label,
          regionNames: names,
          metadata: csvMetadata({
            layer,
            source,
            viewId,
            date: now(),
            viewerUrl: viewerUrl(),
            namesMissing: failed,
          }),
        });
        if (stepper.isCancelled()) return null;
        stepper.step("downloading");
        save(doc, result.csv, filename);
        const regions = `${result.rowCount} region${result.rowCount === 1 ? "" : "s"}`;
        // A failed lookup can be retried; names the map service simply does
        // not have are reported quietly (no retry would change them).
        const notice = failed
          ? "Region names could not be loaded, so the region_name column is empty. Try again to download the file with names."
          : result.unnamedCount > 0
            ? `${result.unnamedCount} of ${result.rowCount} regions have no name in the map service, so their region_name is blank.`
            : "";
        return { message: `Download started: ${filename} (${regions}).`, notice, retry: failed };
      },
    });
    return true;
  }

  /** Ask before a very large file; download it only when confirmed. */
  async function confirmLargeFile(link) {
    const url = link.href;
    const filename = link.getAttribute("download") || url.split("/").pop();
    const size = formatBytes(Number(link.dataset.bytes));
    const ok = await dialog.confirm({
      title: "Download a large file?",
      message: `${filename} is ${size}. It may take a long time and use a lot of data; a fast, unmetered connection is recommended.`,
      confirmLabel: `Download (${size})`,
      opener: link,
    });
    if (ok) startFileDownload(url, filename);
    return ok;
  }

  /**
   * A delegated handler for `click` and `auxclick` on a container of download
   * lists: a "Download CSV" button starts its flow, and a link to a file over
   * 1 GB asks first, whichever way it is opened (a middle click arrives as
   * `auxclick`, not `click`).
   */
  function handleClick(event) {
    if (event.type === "auxclick" && event.button !== 1) return;
    const large = event.target.closest?.("a.layer-downloads__link[data-large]");
    if (event.type === "auxclick" && !large) return;
    if (large) {
      event.preventDefault();
      void confirmLargeFile(large);
      return;
    }
    const button = event.target.closest?.('[data-action="download-csv"]');
    if (!button) return;
    event.preventDefault();
    requestCsv(button.dataset.viewId, { opener: button });
  }

  return {
    requestCsv,
    confirmLargeFile,
    handleClick,
    dialog,
    destroy() {
      dialog.destroy();
    },
  };
}
