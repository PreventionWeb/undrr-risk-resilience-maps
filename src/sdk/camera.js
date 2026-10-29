/**
 * The map camera, over the MapX SDK.
 *
 * Wraps the camera resolvers (`map_fly_to`, `map_jump_to`, `map_get_*`,
 * `common_loc_get_bbox`, MapLibre's `cameraForBounds` through MapX's generic
 * `map` resolver) and the view extent lookup (`get_view_source_summary`) behind
 * a small API that takes already-validated values (see src/utils/camera.js)
 * and fails in a way a caller can report: every rejection is a `CameraError`
 * with a `code`, and no message names a MapX method or view id (they reach the
 * embed's host, which knows neither). The method is kept on `error.method` for
 * the console.
 *
 * ## One way to move: compute the camera, then jump or fly
 *
 * Every fit (a box, an area, a layer) is turned into a centre and zoom with
 * `cameraForBounds` and applied with `map_jump_to` or `map_fly_to`. Those two
 * register `once("moveend")` *before* moving, so they answer when the camera
 * has landed, animated or not. MapX's own fitting resolvers don't:
 *
 * - `map_set_bounds_array` starts an animated `fitBounds` and answers `true`
 *   at once, so a reply read after it describes the camera mid-flight, and the
 *   next queued move (`map.stop()`) cuts the flight short;
 * - `common_loc_fit_bbox` with `duration: 0` (or under reduced motion) never
 *   answers: MapLibre fires `moveend` synchronously, before the resolver's
 *   `once("moveend")` is registered. It also answers `null`, as a success, for
 *   a code it doesn't know.
 *
 * MapX's max-bounds check (`fitMaxBounds`) is redone here from
 * `map_get_max_bounds_array`, so a box outside the map's limits is still
 * refused with `out-of-bounds`. See LEARNINGS.md, "MapX SDK: camera resolvers".
 *
 * ## Every call has a deadline
 *
 * MapX 1.14.2 rejects failures and bounds SDK calls, but its default timeout
 * is too long for the embed command queue. askWithTimeout() retains a shorter
 * deadline so one stalled call cannot block all later host commands.
 *
 * Nothing runs on import.
 */
import { extentToBounds, parseBounds, parseCenter } from "../utils/camera.js";

/** How long an animated move takes; keep host commands responsive. */
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
   * @param {string} message - for the host: no MapX method names or view ids
   * @param {{ cause?: unknown, method?: string }} [options]
   */
  constructor(code, message, { cause, method } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CameraError";
    this.code = code;
    if (method) this.method = method;
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
      () => reject(new CameraError("timeout", `The map did not answer within ${timeoutMs} ms`, { method })),
      timeoutMs,
    );
  });
  // `Promise.resolve().then` so a synchronous throw from `ask` is a rejection too.
  const call = Promise.resolve().then(() => sdk.ask(method, params));
  return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
}

/** Is `inner` inside `outer`? Both `[w, s, e, n]`; MapX's `isBoundsInsideBounds`. */
const isInside = (inner, outer) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

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
  // session and the summary is a server round trip, so it is asked for once.
  // A failure is forgotten so a later fit can retry — except a timeout: a hung
  // raster summary holds one of the SDK's few concurrent request slots
  // (`maxSimultaneousRequest`), and asking again would take another.
  const extents = new Map();

  async function call(method, params, ms = timeoutMs) {
    const sdk = getSdk();
    if (!sdk) throw new CameraError("not-ready", "The map is not ready");
    try {
      return await askWithTimeout(sdk, method, params, ms);
    } catch (error) {
      if (error instanceof CameraError) throw error;
      throw new CameraError("camera-failed", "The map could not carry out the camera change", {
        cause: error,
        method,
      });
    }
  }

  /** Move to a centre and/or zoom; resolves once the camera has landed. */
  async function moveTo({ center = null, zoom = null, animate = false }) {
    const options = {};
    if (center) options.center = center;
    if (zoom !== null && zoom !== undefined) options.zoom = zoom;
    if (animate) options.duration = FLY_DURATION_MS;
    await call(animate ? "map_fly_to" : "map_jump_to", options);
  }

  /** Fit validated bounds: max-bounds check, `cameraForBounds`, then a move. */
  async function fitBounds(bounds, { animate = false } = {}) {
    const maxBounds = parseBounds(await call("map_get_max_bounds_array"));
    if (maxBounds && !isInside(bounds, maxBounds)) {
      throw new CameraError("out-of-bounds", "The map cannot show that area (outside its limits)");
    }
    const camera = await call("map", { method: "cameraForBounds", parameters: [bounds] });
    const center = parseCenter(camera?.center);
    if (!center || typeof camera?.zoom !== "number" || !Number.isFinite(camera.zoom)) {
      throw new CameraError("camera-failed", "The map could not work out a camera for that area", {
        method: "map",
      });
    }
    await moveTo({ center, zoom: camera.zoom, animate });
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
    setView: moveTo,

    /**
     * Fit the camera to `[w, s, e, n]`, refused with `out-of-bounds` when the
     * box is outside the map's max bounds.
     * @param {number[]} bounds
     * @param {{ animate?: boolean }} [options]
     */
    fitBounds,

    /**
     * Fit the camera to a country or region. The box comes from
     * `common_loc_get_bbox`, which answers `null` for a code MapX doesn't know.
     * @param {string} code - an ISO3 or `m49_` code (see parseAreaCode)
     * @param {{ animate?: boolean }} [options]
     */
    async fitArea(code, { animate = false } = {}) {
      const raw = await call("common_loc_get_bbox", { code });
      if (raw == null) throw new CameraError("unknown-area", `The map does not know the area "${code}"`);
      const bounds = parseBounds(raw);
      if (!bounds) {
        throw new CameraError("camera-failed", `The map reported an unusable box for the area "${code}"`);
      }
      await fitBounds(bounds, { animate });
    },

    /**
     * The bounds of a MapX view's source, from `get_view_source_summary`'s
     * `extent_sp`. Rejects with `no-extent` when MapX has none to give, or
     * takes longer than `extentTimeoutMs` to say so.
     * @param {string} idView
     * @returns {Promise<number[]>}
     */
    viewExtent(idView) {
      if (!extents.has(idView)) {
        let timedOut = false;
        const request = call("get_view_source_summary", { idView }, extentTimeoutMs)
          .catch((error) => {
            timedOut = error?.code === "timeout";
            throw new CameraError("no-extent", "The map could not report where this layer is", {
              cause: error,
              method: "get_view_source_summary",
            });
          })
          .then((summary) => {
            const bounds = extentToBounds(summary?.extent_sp);
            if (!bounds)
              throw new CameraError("no-extent", "The map reports no usable extent for this layer");
            return bounds;
          });
        request.catch(() => {
          if (!timedOut && extents.get(idView) === request) extents.delete(idView);
        });
        extents.set(idView, request);
      }
      return extents.get(idView);
    },
  };
}
