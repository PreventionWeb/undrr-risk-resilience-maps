/**
 * The map camera, over the MapX SDK.
 *
 * Wraps the camera resolvers (`map_fly_to`, `map_jump_to`,
 * `map_set_bounds_array`, `common_loc_fit_bbox`, `map_get_*`) and the view
 * extent lookup (`get_view_source_summary`) behind a small API that takes
 * already-validated values (see src/utils/camera.js) and fails in a way a
 * caller can report: every rejection is a `CameraError` with a `code`.
 *
 * ## Every call has a deadline
 *
 * Up to MapX 1.14.0 a resolver that fails never settles its `ask()` promise
 * (LEARNINGS.md, "set_features_click_sdk_only"; MapX upstream
 * https://github.com/unep-grid/mapx/issues/1132). Camera calls are awaited by
 * the embed's command queue, so one hung call would stall every command behind
 * it. `askWithTimeout()` races each call against a timer, and the camera's
 * own animations stay well inside the resolver's fixed 10 s limit
 * (`FLY_DURATION_MS`), past which `map_fly_to` would hang rather than reject.
 *
 * Nothing runs on import.
 */
import { extentToBounds, parseCenter } from "../utils/camera.js";

/** How long an animated move takes. MapX's resolvers give up at 10 s. */
export const FLY_DURATION_MS = 1500;

/** The deadline for one camera call: the longest animation, plus headroom. */
export const CAMERA_TIMEOUT_MS = 12_000;

/**
 * The deadline for a view's extent. `get_view_source_summary` is computed
 * server-side, and for raster (`rt`) views MapX goes through a WMS request
 * that can throw or hang.
 */
export const EXTENT_TIMEOUT_MS = 8_000;

/** A camera failure a host can be told about, with a stable `code`. */
export class CameraError extends Error {
  /**
   * @param {string} code - e.g. `timeout`, `out-of-bounds`, `no-extent`
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "CameraError";
    this.code = code;
  }
}

/**
 * `sdk.ask(method, params)`, rejected with a `timeout` CameraError if it has not
 * settled within `timeoutMs`. The timer is always cleared.
 *
 * @param {{ ask: (method: string, params?: object) => Promise<unknown> }} sdk
 * @param {string} method
 * @param {object} [params]
 * @param {number} [timeoutMs]
 */
export function askWithTimeout(sdk, method, params, timeoutMs = CAMERA_TIMEOUT_MS) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new CameraError("timeout", `The map did not answer "${method}" within ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  // `Promise.resolve().then` so a synchronous throw from `ask` is a rejection too.
  const call = Promise.resolve().then(() => sdk.ask(method, params));
  return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Create a camera over whatever SDK manager `getSdk()` returns at call time.
 *
 * @param {() => ({ ask: Function }|null)} getSdk - null while the map is not up
 * @param {{ timeoutMs?: number, extentTimeoutMs?: number }} [options]
 */
export function createCamera(
  getSdk,
  { timeoutMs = CAMERA_TIMEOUT_MS, extentTimeoutMs = EXTENT_TIMEOUT_MS } = {},
) {
  // idView → Promise of its bounds. A view's source does not change during a
  // session and the summary is a server round trip, so it is asked for once;
  // a failure is forgotten so a later fit can retry.
  const extents = new Map();

  async function call(method, params, ms = timeoutMs) {
    const sdk = getSdk();
    if (!sdk) throw new CameraError("not-ready", "The map is not ready");
    try {
      return await askWithTimeout(sdk, method, params, ms);
    } catch (error) {
      if (error instanceof CameraError) throw error;
      throw new CameraError("camera-failed", `The map could not run "${method}"`, { cause: error });
    }
  }

  return {
    /**
     * The camera as it is now.
     * @returns {Promise<{ center: { lng: number, lat: number }, zoom: number, bounds: number[]|null }>}
     */
    async getView() {
      const [center, zoom, bounds] = await Promise.all([
        call("map_get_center"),
        call("map_get_zoom"),
        call("map_get_bounds_array"),
      ]);
      const parsedCenter = parseCenter(center);
      if (!parsedCenter || typeof zoom !== "number") {
        throw new CameraError("camera-failed", "The map reported a camera it could not describe");
      }
      return {
        center: parsedCenter,
        zoom,
        bounds: Array.isArray(bounds) && bounds.length === 4 ? bounds.map(Number) : null,
      };
    },

    /**
     * Move to a centre and/or zoom: `map_fly_to` when animated, `map_jump_to`
     * otherwise. Either may be omitted to keep the current one.
     * @param {{ center?: { lng: number, lat: number }|null, zoom?: number|null, animate?: boolean }} view
     */
    async setView({ center = null, zoom = null, animate = false }) {
      const options = {};
      if (center) options.center = center;
      if (zoom !== null && zoom !== undefined) options.zoom = zoom;
      if (animate) options.duration = FLY_DURATION_MS;
      await call(animate ? "map_fly_to" : "map_jump_to", options);
    },

    /**
     * Fit the camera to `[w, s, e, n]`. MapX answers `false`, and does not move,
     * when the box is outside the map's max bounds.
     * @param {number[]} bounds
     */
    async fitBounds(bounds) {
      const ok = await call("map_set_bounds_array", { bounds });
      if (ok === false) {
        throw new CameraError("out-of-bounds", "The map cannot show that area (outside its limits)");
      }
    },

    /**
     * Fit the camera to a country or region (`common_loc_fit_bbox`).
     * @param {string} code - an ISO3 or `m49_` code (see parseAreaCode)
     * @param {{ animate?: boolean }} [options]
     */
    async fitArea(code, { animate = false } = {}) {
      try {
        await call("common_loc_fit_bbox", { code, param: { duration: animate ? FLY_DURATION_MS : 0 } });
      } catch (error) {
        // MapX rejects (or, before 1.14.1, never answers) a code it does not
        // know; the timeout is how an unknown code shows up on prod.
        if (error.code === "camera-failed" || error.code === "timeout") {
          throw new CameraError("unknown-area", `The map could not find the area "${code}"`, {
            cause: error,
          });
        }
        throw error;
      }
    },

    /**
     * The bounds of a MapX view's source, from `get_view_source_summary`'s
     * `extent_sp`. Rejects with `no-extent` when MapX has none to give, or
     * takes longer than `extentTimeoutMs` to say so. The message names no view
     * id: it reaches the embed's host, which addresses layers by key only.
     * @param {string} idView
     * @returns {Promise<number[]>}
     */
    viewExtent(idView) {
      if (!extents.has(idView)) {
        const request = call("get_view_source_summary", { idView }, extentTimeoutMs)
          .catch((error) => {
            throw new CameraError("no-extent", "The map could not report where this layer is", {
              cause: error,
            });
          })
          .then((summary) => {
            const bounds = extentToBounds(summary?.extent_sp);
            if (!bounds)
              throw new CameraError("no-extent", "The map reports no usable extent for this layer");
            return bounds;
          });
        request.catch(() => {
          if (extents.get(idView) === request) extents.delete(idView);
        });
        extents.set(idView, request);
      }
      return extents.get(idView);
    },
  };
}
