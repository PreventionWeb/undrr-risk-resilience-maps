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
 */
(function () {
  "use strict";

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
  };
  window.__mapxStub = stub;

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
    set_vector_highlight: function () {
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
    // src/sdk/filters.js — the opacity slider's read and write
    get_view_layer_transparency: function () {
      return 0;
    },
    set_view_layer_transparency: function () {
      return true;
    },
    // src/external/index.js keeps the camera across an external layer's reopen
    map_get_center: function () {
      return { lng: 0, lat: 0 };
    },
    map_get_zoom: function () {
      return 2;
    },
  };

  var SLOW_METHODS = { view_add: true, view_remove: true };

  function Manager(options) {
    this._listeners = Object.create(null);

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
          resolve(handler(params || {}));
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
