/**
 * The CSV download flow (prototype, behind `?downloads=1`; #64).
 *
 * `createDownloads(...)` runs behind the "Download CSV" buttons that
 * src/ui/download-links.js draws: one progress dialog per instance, the MapX
 * table read (src/sdk/table.js), the CSV (src/utils/region-csv.js) and the
 * browser download.
 *
 * With the flag off none of this is created, so the UI is unchanged.
 */
import { REGION_NAME_REFERENCE_VIEW, getViewDownloads } from "../config/downloads.js";
import { DATA_REQUESTS } from "../config/data-requests.js";
import { getLayerRegistry } from "../config/registry.js";
import {
  buildRegionCsv,
  csvFilename,
  csvMetadata,
  REGION_CODE_ATTRIBUTE,
  hasRegionNames,
  regionNamesFrom,
  viewLabel,
} from "../utils/region-csv.js";
import { fetchViewTable } from "../sdk/table.js";
import { createDownloadDialog } from "./download-dialog.js";

/** How long the CSV dialog waits for MapX to finish starting before giving up. */
export const SDK_READY_WAIT_MS = 30_000;

/** Save text as a file through a temporary link (as the inventory export does). */
export function saveTextFile(doc, text, filename, type = "text/csv;charset=utf-8") {
  const win = doc.defaultView ?? window;
  const blob = new win.Blob([text], { type });
  const url = win.URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a moment later: some browsers start reading the blob after click().
  win.setTimeout(() => win.URL.revokeObjectURL(url), 10_000);
}

/** Resolve once `isReady()` is true, or reject after `timeoutMs`. */
function whenReady(isReady, onReadyChange, timeoutMs) {
  if (isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      reject(
        new Error(
          "The map service has not finished loading. Open a map category so the map can start, then try again.",
        ),
      );
    }, timeoutMs);
    off = onReadyChange((ready) => {
      if (!ready) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
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
 * @param {() => boolean} options.isReady - MapX is ready
 * @param {(fn: (ready: boolean) => void) => () => void} options.onReadyChange
 * @param {() => { ask: Function }} options.getSdk
 * @param {() => Date} [options.now]
 * @param {(doc: Document, text: string, filename: string) => void} [options.save]
 * @param {number} [options.readyTimeoutMs]
 */
export function createDownloads({
  doc = document,
  registry = getLayerRegistry(),
  isViewWanted,
  isViewLoaded,
  onViewLoaded = () => {},
  isReady,
  onReadyChange,
  getSdk,
  now = () => new Date(),
  save = saveTextFile,
  readyTimeoutMs = SDK_READY_WAIT_MS,
  regionNameView = REGION_NAME_REFERENCE_VIEW,
}) {
  const dialog = createDownloadDialog({ doc });
  /** Promise of the reference names (see REGION_NAME_REFERENCE_VIEW), read once per instance. */
  let regionNames = null;

  const tableOptions = { isLoaded: isViewLoaded, isWanted: isViewWanted, onLoaded: onViewLoaded };

  /**
   * Names for a table without `maplab`, from the reference view. A failure
   * leaves the names blank rather than failing the download, and is forgotten
   * so the next download tries again.
   */
  function referenceNames() {
    if (!regionNames) {
      regionNames = fetchViewTable(getSdk(), regionNameView, tableOptions)
        .then(regionNamesFrom)
        .catch((error) => {
          console.warn("Could not read region names for the CSV; leaving them blank:", error);
          regionNames = null;
          return new Map();
        });
    }
    return regionNames;
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
    const { layer, source } = entry;
    if (!getViewDownloads(layer, source ?? null).csv) return false;
    const label = viewLabel(layer, source);
    const filename = csvFilename(layer.key, viewId);

    dialog.open({
      title: `Download CSV: ${label}`,
      opener,
      // The dialog shows "fetching" before calling this.
      async run(stepper) {
        await whenReady(isReady, onReadyChange, readyTimeoutMs);
        const rows = await fetchViewTable(getSdk(), viewId, tableOptions);
        const needsNames =
          !hasRegionNames(rows) &&
          viewId !== regionNameView &&
          rows.some((row) => row && REGION_CODE_ATTRIBUTE in row);
        const names = needsNames ? await referenceNames() : new Map();
        if (stepper.isCancelled()) return "";
        stepper.step("processing");
        const result = buildRegionCsv(rows, {
          valueLabel: label,
          regionNames: names,
          metadata: csvMetadata({
            layer,
            source,
            viewId,
            date: now(),
            viewerUrl: DATA_REQUESTS.viewerUrl,
          }),
        });
        stepper.step("downloading");
        save(doc, result.csv, filename);
        const regions = `${result.rowCount} region${result.rowCount === 1 ? "" : "s"}`;
        return `Download started: ${filename} (${regions}).`;
      },
    });
    return true;
  }

  /**
   * A delegated click handler for a container of download lists: a click on a
   * "Download CSV" button starts its flow.
   */
  function handleClick(event) {
    const button = event.target.closest?.('[data-action="download-csv"]');
    if (!button) return;
    event.preventDefault();
    requestCsv(button.dataset.viewId, { opener: button });
  }

  return {
    requestCsv,
    handleClick,
    dialog,
    destroy() {
      dialog.destroy();
    },
  };
}
