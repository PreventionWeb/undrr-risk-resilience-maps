/**
 * A MapX vector view's attribute table, for the values-only CSV (#64).
 *
 * `get_view_table_attribute` returns the view's configured attributes for
 * every row of its source, without geometry. It only works for a view MapX has
 * loaded in this session (`view_add`): otherwise its resolver throws at once.
 * Once a view has been added, the table stays readable after `view_remove`.
 * See LEARNINGS.md, "MapX SDK: attribute tables for downloads".
 *
 * So a view the session has not loaded is added for the read and removed
 * again. The layer controller is the only code that adds or removes views for
 * the UI (src/services/layer-controller.js), so this temporary add stays out of
 * its way:
 *
 * - it never touches the layers store: the layer's record, switch, URL state
 *   and `openViews` do not see the temporary view;
 * - it is added with `zoomToView: false`, so the camera does not move;
 * - before removing the view it asks `isWanted(idView)`, and leaves the view on
 *   the map if the user turned that layer on in the meantime (the controller's
 *   own `view_add` of an open view is harmless, and its later `view_remove`
 *   then owns the view);
 * - an add that misses its deadline is still cleaned up if it lands later, so
 *   a slow MapX cannot leave a view on the map that no record knows about.
 *
 * Every call has a deadline (askWithTimeout, as the camera uses).
 */
import { askWithTimeout } from "./camera.js";

/** Region-level tables answer in ~0.5 s (p95 ~1 s); the largest (2.9 MB) in under 2 s. */
export const TABLE_TIMEOUT_MS = 20_000;
/** Adding a view the session has not loaded yet: fetches its definition and renders it. */
export const VIEW_ADD_TIMEOUT_MS = 20_000;
export const VIEW_REMOVE_TIMEOUT_MS = 10_000;

/** A table could not be read, with a stable `code` and a message for people. */
export class TableError extends Error {
  /**
   * @param {"timeout"|"failed"|"bad-response"} code
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TableError";
    this.code = code;
  }
}

function toTableError(error) {
  if (error instanceof TableError) return error;
  if (error?.code === "timeout") {
    return new TableError("timeout", "The map service took too long to answer.", { cause: error });
  }
  return new TableError("failed", "The map service could not provide this layer's data.", { cause: error });
}

/**
 * Read a view's attribute table.
 *
 * @param {{ ask: (method: string, params?: object) => Promise<unknown> }} sdk
 * @param {string} idView
 * @param {object} [options]
 * @param {(idView: string) => boolean} [options.isLoaded] - the session has
 *   loaded this view (it is, or was, on the map)
 * @param {(idView: string) => boolean} [options.isWanted] - a layer record
 *   wants this view on the map now (checked again before a temporary removal)
 * @param {(idView: string) => void} [options.onLoaded] - a temporary add
 *   succeeded, so later reads can skip it
 * @param {{ table?: number, add?: number, remove?: number }} [options.timeouts]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function fetchViewTable(
  sdk,
  idView,
  { isLoaded = () => false, isWanted = () => false, onLoaded = () => {}, timeouts = {} } = {},
) {
  const {
    table: tableMs = TABLE_TIMEOUT_MS,
    add: addMs = VIEW_ADD_TIMEOUT_MS,
    remove: removeMs = VIEW_REMOVE_TIMEOUT_MS,
  } = timeouts;

  const readTable = async () => {
    const rows = await askWithTimeout(sdk, "get_view_table_attribute", { idView }, tableMs);
    if (!Array.isArray(rows)) {
      throw new TableError("bad-response", "The map service returned data in an unexpected form.");
    }
    return rows;
  };

  if (isLoaded(idView)) {
    try {
      return await readTable();
    } catch (error) {
      // A view on the map should answer; one only loaded earlier might have
      // been dropped by MapX, so that case gets one more try through an add.
      if (isWanted(idView) || error instanceof TableError) throw toTableError(error);
    }
  }

  let settled = false;
  let abandoned = false;
  const removeIfUnwanted = () => {
    if (isWanted(idView)) return Promise.resolve();
    return askWithTimeout(sdk, "view_remove", { idView }, removeMs).catch((error) =>
      console.warn(`Could not remove temporary view ${idView} after reading its table:`, error),
    );
  };

  const add = Promise.resolve().then(() => sdk.ask("view_add", { idView, zoomToView: false }));
  // If the deadline passes first, the add may still land: take the view off
  // again then, unless a layer wants it by that time.
  add.then(
    () => {
      settled = true;
      if (abandoned) void removeIfUnwanted();
    },
    () => {
      settled = true;
    },
  );

  try {
    const ok = await askWithTimeout({ ask: () => add }, "view_add", undefined, addMs);
    if (ok === false) throw new TableError("failed", "The map service could not load this layer.");
  } catch (error) {
    if (!settled) abandoned = true;
    throw toTableError(error);
  }
  onLoaded(idView);

  try {
    return await readTable();
  } catch (error) {
    throw toTableError(error);
  } finally {
    await removeIfUnwanted();
  }
}
