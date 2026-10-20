/**
 * The MapX SDK stub. This file is not loaded by the test runner: the `app`
 * fixture reads it as text and serves it from
 * `https://app.mapx.org/sdk/mxsdk.umd.js`, so `loadMapXSdk()` gets a script
 * that sets `window.mxsdk` exactly as the real UMD bundle does.
 *
 * It is the only place the suite fakes MapX. Nothing here talks to a network:
 * no iframe to app.mapx.org, no GeoServer, no MapX mirror. `initSDK()` builds
 * a `Manager`, the manager emits `ready` on the next tick, and `ask()` answers
 * the commands `src/sdk/` sends (see ARCHITECTURE.md's Testing section).
 *
 * `window.__mapxStub` is the seam the specs assert against:
 *   - `ready`      — the `ready` event has been emitted
 *   - `openViews`  — the view ids MapX currently holds (view_add minus view_remove)
 *   - `calls`      — every `ask()` as `{ method, params }`, in order
 *   - `camera`     — `{ center, zoom, bounds }`, moved by the camera commands
 */
(function () {
  // The MapX version to impersonate, set by the fixture's `mapxVersion`
  // option. Production runs 1.14.1 until 1.14.2 ships.
  var VERSION = window.__MAPX_STUB_VERSION__ || "1.14.1";
  var IS_1_14_2 = (function () {
    var parts = /^(\d+)\.(\d+)\.(\d+)/.exec(VERSION);
    if (!parts) return false;
    var n = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    return n[0] > 1 || (n[0] === 1 && (n[1] > 14 || (n[1] === 14 && n[2] >= 2)));
  })();
  ("use strict");

  var stub = {
    ready: false,
    /**
     * Hold the manager's `ready` event until `__mapxStub.releaseReady()` is
     * called. Real MapX loads in a cross-origin iframe and makes no progress
     * while that iframe is not painted — behind the preview PIN gate, for
     * instance (see #24) — but this stub is local JavaScript and is otherwise
     * ready a tick after it is built. A spec about what happens *after* an
     * unlock has to be able to reproduce a map that was not ready before it.
     *
     * Set it from an init script, as `window.__mapxStubHoldReady = true`: this
     * file is served as the SDK, so it runs later than any init script does.
     */
    holdReady: Boolean(window.__mapxStubHoldReady),
    /** Emit the held `ready`. Replaced per manager; a no-op until one is built. */
    releaseReady: function () {},
    /**
     * Fire a MapX event (`click_features`, `click_attributes`) at the app, the
     * way a map click would. Replaced per manager; a no-op until one is built.
     */
    emit: function () {},
    /** Whether the app has a handler for `event`. Replaced per manager. */
    listening: function () {
      return false;
    },
    openViews: [],
    calls: [],
    /**
     * How long `view_add` and `view_remove` take to answer. A spec that is
     * about a race — a second click, overlapping source picks, Clear all
     * during a load — raises this so the later action provably lands while the
     * earlier call is still in flight. That is a controlled latency, not a
     * sleep: the assertions still wait on the app's own state.
     */
    delayMs: 25,
    /**
     * The map camera. The camera resolvers read and move it the way MapLibre
     * would, approximately: a move sets the centre and zoom and a fit sets the
     * bounds, which is all the embed's host API reads back.
     */
    camera: { center: { lng: 0, lat: 0 }, zoom: 2, bounds: [-180, -85, 180, 85] },
    /**
     * What `get_view_source_summary` reports as a view's `extent_sp`, by view
     * id. A view not listed gets `defaultExtent`. A view listed as `null` gets
     * a summary with no extent, which is what an empty or unreadable source
     * looks like.
     */
    extents: {},
    defaultExtent: { lng1: -20, lat1: -35, lng2: 52, lat2: 38 },
    /** What `map_get_max_bounds_array` answers: `null` (no limit) or `[w, s, e, n]`. */
    maxBounds: null,
  };

  /**
   * A handler's answer meaning "never answer", the way `Manager.ask()` behaves
   * for a resolver that fails or hangs on MapX 1.14.0.
   */
  var NEVER = {};

  /**
   * The last camera `cameraForBounds` computed, so a jump to exactly that
   * centre and zoom reports exactly the fitted box back (real MapLibre would
   * report the box the viewport shows, which depends on its size).
   */
  var lastFit = null;
  window.__mapxStub = stub;

  /**
   * Country and region boxes the stub's common-location resolvers know. As in
   * MapX, an unknown code is not an error: `getBbox` answers `null`.
   */
  var AREAS = {
    KEN: [33.9, -4.7, 41.9, 5.0],
    m49_014: [21.0, -26.9, 51.4, 18.0],
  };

  /** Point the camera at a box, as a fit does. */
  function fitTo(bounds) {
    stub.camera = {
      center: { lng: (bounds[0] + bounds[2]) / 2, lat: (bounds[1] + bounds[3]) / 2 },
      zoom: Math.max(0, Math.min(22, Math.log2(360 / Math.max(bounds[2] - bounds[0], 1e-9)))),
      bounds: bounds.slice(),
    };
  }

  /** MapLibre's cameraForBounds, roughly: the box's middle and a zoom that fits its width. */
  function cameraForBounds(bounds) {
    var camera = {
      center: { lng: (bounds[0] + bounds[2]) / 2, lat: (bounds[1] + bounds[3]) / 2 },
      zoom: Math.max(0, Math.min(22, Math.log2(360 / Math.max(bounds[2] - bounds[0], 1e-9)))),
      bearing: 0,
    };
    lastFit = { center: camera.center, zoom: camera.zoom, bounds: bounds.slice() };
    return camera;
  }

  /** Move the camera to a centre and/or zoom, as jumpTo and flyTo do. */
  function moveTo(options) {
    var center = options.center || stub.camera.center;
    var zoom = typeof options.zoom === "number" ? options.zoom : stub.camera.zoom;
    if (
      lastFit &&
      zoom === lastFit.zoom &&
      center.lng === lastFit.center.lng &&
      center.lat === lastFit.center.lat
    ) {
      stub.camera = {
        center: { lng: center.lng, lat: center.lat },
        zoom: zoom,
        bounds: lastFit.bounds.slice(),
      };
      return;
    }
    var halfWidth = 180 / Math.pow(2, zoom);
    stub.camera = {
      center: { lng: center.lng, lat: center.lat },
      zoom: zoom,
      bounds: [
        center.lng - halfWidth,
        Math.max(-85, center.lat - halfWidth / 2),
        center.lng + halfWidth,
        Math.min(85, center.lat + halfWidth / 2),
      ],
    };
  }

  // Every view id MapX has been asked to add, so `get_views` can answer for it.
  var known = new Set();

  /**
   * A per-view legend image, as `get_view_legend_image` returns one: the app
   * accepts a full data URL and uses it verbatim. An un-encoded SVG payload
   * keeps the view id readable in the `img[src]`, which is how a spec checks
   * that the legend on screen belongs to the view the URL names.
   */
  function legendImage(idView) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">' +
      "<title>" +
      idView +
      "</title>" +
      '<rect width="8" height="8" fill="#336699"/></svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  var HANDLERS = {
    // main.js, on ready
    set_immersive_mode: function () {
      return true;
    },
    // src/sdk/inspect.js
    set_features_click_sdk_only: function () {
      return true;
    },
    // src/sdk/views.js
    view_add: function (params) {
      known.add(params.idView);
      if (stub.openViews.indexOf(params.idView) === -1) stub.openViews.push(params.idView);
      return true;
    },
    view_remove: function (params) {
      stub.openViews = stub.openViews.filter(function (id) {
        return id !== params.idView;
      });
      return true;
    },
    get_view_legend_image: function (params) {
      return legendImage(params.idView);
    },
    /**
     * The live catalogue src/sdk/legends.js reads. Raster views with no
     * `data.source.legend` are what the app's approved-provider policy rejects
     * without any request, so legend resolution falls to the image above —
     * which is the real behaviour for every layer this suite touches except
     * Earthquake PGA, whose GeoServer legend the suite deliberately does not
     * reach. The result is a `[data-legend-reason="raster"]` image legend.
     */
    get_views: function () {
      return Array.from(known).map(function (id) {
        return { id: id, type: "rt", data: {} };
      });
    },
    // src/sdk/filters.js — the opacity slider's read and write. The getter
    // changed scale in MapX 1.14.2: it answers transparency 0-100 (0 for a
    // fresh, fully opaque view), where 1.14.1 answered the view's opacity 0-1
    // (1 for a fresh view). The setter takes transparency 0-100 on both.
    get_view_layer_transparency: function () {
      return IS_1_14_2 ? 0 : 1;
    },
    set_view_layer_transparency: function () {
      return true;
    },
    // src/external/index.js keeps the camera across an external layer's reopen,
    // and src/sdk/camera.js is the embed host API's camera.
    map_get_center: function () {
      return { lng: stub.camera.center.lng, lat: stub.camera.center.lat };
    },
    map_get_zoom: function () {
      return stub.camera.zoom;
    },
    map_get_bounds_array: function () {
      return stub.camera.bounds.slice();
    },
    map_jump_to: function (params) {
      moveTo(params);
      return params;
    },
    map_fly_to: function (params) {
      moveTo(params);
      return params;
    },
    map_get_max_bounds_array: function () {
      return stub.maxBounds ? stub.maxBounds.slice() : null;
    },
    // MapX's generic resolver: `map[method](...parameters)`. Only what the app uses.
    map: function (params) {
      if (params.method === "cameraForBounds") return cameraForBounds(params.parameters[0]);
      throw new Error("mapx stub: unhandled map method " + params.method);
    },
    // Like MapX: starts an animated fit and answers `true` at once, before the
    // camera has arrived (the embed must not rely on it, and doesn't).
    map_set_bounds_array: function (params) {
      var b = params.bounds;
      setTimeout(function () {
        fitTo(b);
      }, 1000);
      return true;
    },
    common_loc_get_bbox: function (params) {
      return AREAS[params.code] ? AREAS[params.code].slice() : null;
    },
    // Like MapX: `null` for an unknown code, and no answer at all for a fit
    // with `duration: 0` (MapLibre fires `moveend` before the resolver listens).
    common_loc_fit_bbox: function (params) {
      var bounds = AREAS[params.code];
      if (!bounds) return null;
      if (params.param && params.param.duration === 0) return NEVER;
      fitTo(bounds);
      return bounds.slice();
    },
    get_view_source_summary: function (params) {
      var extent = Object.prototype.hasOwnProperty.call(stub.extents, params.idView)
        ? stub.extents[params.idView]
        : stub.defaultExtent;
      var summary = { id: params.idView, attributes: [] };
      if (extent) summary.extent_sp = extent;
      return summary;
    },
  };

  var SLOW_METHODS = { view_add: true, view_remove: true };

  function Manager(options) {
    this._listeners = Object.create(null);
    // The real SDK has no window.mxsdk.version; the version is a getter on
    // the Manager instance (src/sdk/client.js getMapXVersion()).
    this.version = VERSION;

    // Stand in for the SDK's iframe. Nothing is loaded into it: the point of
    // the stub is that no cross-origin document exists to wait for.
    var frame = document.createElement("div");
    frame.setAttribute("data-mapx-stub", "");
    frame.style.width = "100%";
    frame.style.height = "100%";
    if (options && options.container) options.container.appendChild(frame);
    this.frame = frame;

    // The app registers its `ready` handler after initSDK() returns, so the
    // event cannot be emitted synchronously.
    var self = this;
    stub.emit = function (event, payload) {
      self._emit(event, payload);
    };
    stub.listening = function (event) {
      return (self._listeners[event] || []).length > 0;
    };
    var emitReady = function () {
      stub.ready = true;
      self._emit("ready", {});
    };
    if (stub.holdReady) {
      stub.releaseReady = emitReady;
    } else {
      setTimeout(emitReady, 0);
    }
  }

  Manager.prototype.on = function (event, handler) {
    (this._listeners[event] = this._listeners[event] || []).push(handler);
  };

  Manager.prototype.off = function (event, handler) {
    var handlers = this._listeners[event];
    if (!handlers) return;
    this._listeners[event] = handlers.filter(function (candidate) {
      return candidate !== handler;
    });
  };

  Manager.prototype._emit = function (event, payload) {
    var handlers = this._listeners[event] || [];
    for (var i = 0; i < handlers.length; i++) {
      try {
        handlers[i](payload);
      } catch (error) {
        console.error("mapx stub: a " + event + " handler threw", error);
      }
    }
  };

  Manager.prototype.ask = function (method, params) {
    stub.calls.push({ method: method, params: params || {} });
    var handler = HANDLERS[method];
    if (!handler) {
      return Promise.reject(new Error('mapx stub: unhandled command "' + method + '"'));
    }
    var delay = SLOW_METHODS[method] ? stub.delayMs : 0;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var result = handler(params || {});
          if (result !== NEVER) resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  };

  Manager.prototype.destroy = function () {
    if (this.frame && this.frame.parentNode) this.frame.parentNode.removeChild(this.frame);
  };

  window.mxsdk = { Manager: Manager };
})();
