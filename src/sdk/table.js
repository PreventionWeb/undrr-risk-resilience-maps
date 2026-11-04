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
 * - MapX paints a view before `view_add` answers, so no transparency or
 *   filter set afterwards can stop it showing (measured: one frame of the
 *   whole layer). `onTemporary(true)` is called before the add and
 *   `onTemporary(false)` once the view is gone, so the caller can hide the
 *   map frame for exactly that long (src/ui/sidebar.js);
 * - `isCancelled()` is checked before every MapX call: a cancelled read
 *   makes no further call except removing a view it already added;
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
/** How often an in-flight read checks whether its run was cancelled. */
export const CANCEL_POLL_MS = 100;

/** A table could not be read, with a stable `code` and a message for people. */
export class TableError extends Error {
  /**
   * @param {"timeout"|"failed"|"bad-response"|"cancelled"} code
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

const cancelled = () => new TableError("cancelled", "The download was cancelled.");

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
 * @param {(active: boolean) => void} [options.onTemporary] - a temporary view
 *   is about to be added (true) / is gone again (false); always paired
 * @param {() => boolean} [options.isCancelled] - stop before the next MapX call
 * @param {{ table?: number, add?: number, remove?: number }} [options.timeouts]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function fetchViewTable(
  sdk,
  idView,
  {
    isLoaded = () => false,
    isWanted = () => false,
    onLoaded = () => {},
    onTemporary = () => {},
    isCancelled = () => false,
    timeouts = {},
  } = {},
) {
  const {
    table: tableMs = TABLE_TIMEOUT_MS,
    add: addMs = VIEW_ADD_TIMEOUT_MS,
    remove: removeMs = VIEW_REMOVE_TIMEOUT_MS,
  } = timeouts;

  // A read cannot be aborted inside MapX, but a cancelled run need not wait
  // for it: stop waiting so a temporary view is removed (and the map shown)
  // at once rather than when the read lands.
  const unlessCancelled = (promise) => {
    let poll;
    const watch = new Promise((_resolve, reject) => {
      poll = setInterval(() => {
        if (isCancelled()) reject(cancelled());
      }, CANCEL_POLL_MS);
    });
    return Promise.race([promise, watch]).finally(() => clearInterval(poll));
  };

  const readTable = async () => {
    if (isCancelled()) throw cancelled();
    const rows = await unlessCancelled(askWithTimeout(sdk, "get_view_table_attribute", { idView }, tableMs));
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
  if (isCancelled()) throw cancelled();

  let temporaryEnded = false;
  const endTemporary = () => {
    if (temporaryEnded) return;
    temporaryEnded = true;
    onTemporary(false);
  };
  const removeIfUnwanted = async () => {
    try {
      if (!isWanted(idView)) {
        await askWithTimeout(sdk, "view_remove", { idView }, removeMs).catch((error) =>
          console.warn(`Could not remove temporary view ${idView} after reading its table:`, error),
        );
      }
    } finally {
      endTemporary();
    }
  };

  onTemporary(true);
  let settled = false;
  let abandoned = false;
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
      if (abandoned) endTemporary();
    },
  );

  try {
    const ok = await askWithTimeout({ ask: () => add }, "view_add", undefined, addMs);
    if (ok === false) throw new TableError("failed", "The map service could not load this layer.");
  } catch (error) {
    if (settled) endTemporary();
    else {
      abandoned = true;
      // An add that never answers must not keep the map hidden for ever.
      setTimeout(endTemporary, addMs);
    }
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
