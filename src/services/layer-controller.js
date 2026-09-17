/**
 * Layer controller: turns what the user asked for into what MapX shows.
 *
 * Callers write intent (`desired`, `sourceIdx`, `settings`) to a layer's record
 * in the layers store; the controller then reconciles MapX to it and writes
 * back what is actually on the map (`applied`, `viewId`, `appliedSourceIdx`,
 * `appliedSettings`) and a `status`.
 *
 * One policy covers simple, compound and external layers: the latest intent
 * wins. Each layer key runs at most one reconciliation at a time. Intent that
 * arrives while one is running marks the key dirty, and the running
 * reconciliation re-reads the record and goes again once its current MapX call
 * settles, so no click is dropped and no stale plan is finished. Keys are
 * independent, so restoring several layers issues their first `view_add` calls
 * in the order they were requested.
 *
 * Failure semantics (see ARCHITECTURE.md, "Layer controller"): the record
 * always describes what MapX shows. A failed operation sets `status: "error"`
 * and `error`, and resets intent to the applied state, unless newer intent
 * arrived meanwhile (that intent is then tried instead).
 *
 * Nothing here touches the DOM, the URL or the SDK directly, and nothing runs
 * on import: views, external providers and layer config are injected.
 *
 * `destroy()` retires a controller (the sidebar calls it on destroy and
 * rebuild): new intent is ignored, a MapX call that settles afterwards writes
 * nothing to the store, and no further MapX calls are made.
 */

const BUSY = new Set(["loading", "removing", "switching"]);

/** Whether a record status means a MapX call is in flight. */
export const isBusyStatus = (status) => BUSY.has(status);

/** Whether `actual` settings already satisfy every field of `wanted`. */
export function settingsMatch(actual, wanted) {
  if (!actual || !wanted) return false;
  return Object.keys(wanted).every((field) => actual[field] === wanted[field]);
}

/** Whether a layer has switchable sources (a compound layer). */
const hasSources = (layer) => Array.isArray(layer?.sources) && layer.sources.length > 0;

/**
 * Clamp a source index (from the URL or a widget) to the layer's sources: an
 * integer in range, otherwise 0. Always 0 for a layer without sources.
 * @param {object} layer
 * @param {unknown} sourceIdx
 * @returns {number}
 */
export function clampSourceIdx(layer, sourceIdx) {
  if (!hasSources(layer)) return 0;
  return Number.isInteger(sourceIdx) && sourceIdx >= 0 && sourceIdx < layer.sources.length ? sourceIdx : 0;
}

/** Record fields callers may set: intent. Everything else is written by the controller. */
const INTENT_FIELDS = new Set(["desired", "sourceIdx", "settings"]);

/** A provider runtime the controller can record: it names a view. */
const isRuntime = (runtime) =>
  Boolean(runtime) && typeof runtime.idView === "string" && runtime.idView !== "";

/**
 * @param {object} deps
 * @param {ReturnType<import("../state/layers-store.js").createLayersStore>} deps.store
 * @param {(key: string) => object|undefined} deps.getLayer - layer config by key
 * @param {{ add: (id: string) => Promise<unknown>, remove: (id: string) => Promise<unknown> }} deps.views
 * @param {{
 *   isExternal: (layer: object) => boolean,
 *   getRuntime: (layer: object) => ({ idView: string, settings: object }|null),
 *   open: (layer: object, settings: object) => Promise<{ idView: string, settings: object }>,
 *   close: (layer: object) => Promise<unknown>,
 *   replace: (layer: object, settings: object) => Promise<{ runtime: { idView: string, settings: object } }>,
 * }} deps.external - external layer registry; the source of truth for runtime view ids
 * @param {(key: string, error: unknown, action: string) => void} [deps.onError]
 */
export function createLayerController({ store, getLayer, views, external, onError = () => {} }) {
  /** key → promise of the running reconciliation */
  const running = new Map();
  /** keys whose intent changed while their reconciliation was running */
  const dirty = new Set();
  /** key → count of intent changes written, to tell whether intent changed during a call */
  const versions = new Map();
  let destroyed = false;

  // Once destroyed, store writes and error reports are dropped, and no new MapX
  // call is started: a reconciliation checks `destroyed` after each call settles.

  /** Write to the store, unless the controller has been destroyed. */
  function write(key, patch) {
    if (!destroyed) store.set(key, patch);
  }

  /**
   * Report a failure to `onError`. A throwing handler is logged, never rethrown,
   * so it cannot abandon a reconciliation halfway (leaving the key busy).
   */
  function report(key, error, action) {
    if (destroyed) return;
    try {
      onError(key, error, action);
    } catch (handlerError) {
      console.error(`Layer controller: onError failed for "${key}":`, handlerError);
    }
  }

  /**
   * Record intent and reconcile. Resolves with the settled record.
   * Only intent fields (`desired`, `sourceIdx`, `settings`) are accepted; any
   * other field is ignored with a console warning.
   */
  function intend(key, patch) {
    if (destroyed) return Promise.resolve(store.get(key));
    const intent = {};
    for (const [field, value] of Object.entries(patch ?? {})) {
      if (INTENT_FIELDS.has(field)) intent[field] = value;
      else console.warn(`Layer controller: ignoring non-intent field "${field}" for "${key}"`);
    }
    const before = store.get(key);
    const changed = store.set(key, intent) !== before;
    // Only a real change is newer intent. Intent equal to the record joins the
    // running reconciliation without marking it dirty, so it neither retries a
    // failed call nor stops a failure from resetting intent.
    if (changed) versions.set(key, (versions.get(key) ?? 0) + 1);
    return reconcileKey(key, changed);
  }

  /**
   * Reconcile one key, or join the reconciliation already running for it.
   * `changed` means new intent was written, which a running reconciliation
   * must plan again for (the key is marked dirty).
   */
  function reconcileKey(key, changed) {
    if (destroyed) return Promise.resolve(store.get(key));
    if (running.has(key)) {
      if (changed) dirty.add(key);
      return running.get(key);
    }
    let settle;
    const done = new Promise((resolve) => (settle = resolve));
    // Registered before drain() starts, so intent written by a store subscriber
    // during its synchronous first step joins this run instead of starting another.
    running.set(key, done);
    drain(key).then(settle, (error) => {
      // drain() handles MapX failures itself, so this is a bug (e.g. a store
      // write that threw). Free the key so later intent starts a new run, leave
      // no busy status behind, and settle every caller with the record.
      console.error(`Layer controller: reconciliation failed for "${key}":`, error);
      if (running.get(key) === done) running.delete(key);
      dirty.delete(key);
      try {
        if (isBusyStatus(store.get(key).status)) write(key, { status: "error", error });
      } catch (writeError) {
        console.error(`Layer controller: could not record the failure for "${key}":`, writeError);
      }
      settle(store.get(key));
    });
    return done;
  }

  async function drain(key) {
    const run = { touched: false, error: null };
    for (;;) {
      dirty.delete(key);
      try {
        await reconcile(key, run);
      } catch (error) {
        // Unexpected (e.g. unknown provider): report it and stop.
        run.error = error;
        run.touched = true;
        report(key, error, "reconcile");
      }
      if (destroyed) break;
      if (dirty.has(key)) continue;
      if (run.touched) {
        write(key, { status: run.error ? "error" : "idle", error: run.error });
      }
      // A subscriber may have written new intent while the status was set.
      if (!dirty.has(key)) break;
    }
    // Synchronously with the last check, so later intent starts a new run.
    running.delete(key);
    return store.get(key);
  }

  /** Mark the record busy for a MapX call. */
  function begin(key, run, status) {
    run.touched = true;
    write(key, { status });
  }

  /**
   * Record a failed MapX call. `always` describes what MapX now shows. `reset`
   * puts intent back to that state, unless intent changed since the call began
   * (`intent`): the newer intent is then tried instead and the failure is only
   * reported, not kept as the record's error.
   */
  function fail(key, run, error, action, intent, always, reset) {
    report(key, error, action);
    const unchanged = (versions.get(key) ?? 0) === intent.version;
    if (unchanged) run.error = error;
    write(key, unchanged ? { ...always, ...reset } : always);
  }

  function succeed(key, run, patch) {
    run.error = null;
    write(key, patch);
  }

  /** What a call was planned from: the intent version and settings object. */
  const intentOf = (key, record) => ({ version: versions.get(key) ?? 0, settings: record.settings });

  async function reconcile(key, run) {
    const layer = getLayer(key);
    if (!layer) return;
    if (external.isExternal(layer)) return reconcileExternal(key, layer, run);
    return reconcileView(key, layer, run);
  }

  /** Simple (one view) and compound (one view per source) MapX layers. */
  async function reconcileView(key, layer, run) {
    const viewFor = (idx) => (hasSources(layer) ? layer.sources[clampSourceIdx(layer, idx)].id : layer.id);

    let record = store.get(key);
    const intent = intentOf(key, record);
    const targetIdx = clampSourceIdx(layer, record.sourceIdx);
    const target = record.desired ? viewFor(targetIdx) : null;
    const current = record.applied ? record.viewId : null;

    if (current === target) {
      // Mid-switch, nothing of this layer is on the map and none is wanted any more.
      if (record.applied && !target) succeed(key, run, { applied: false, viewId: null });
      return;
    }

    if (current) {
      begin(key, run, target ? "switching" : "removing");
      try {
        await views.remove(current);
      } catch (error) {
        // MapX may still show the view, so the layer stays on as it was.
        fail(key, run, error, "remove", intent, {}, { desired: true, sourceIdx: record.appliedSourceIdx });
        return;
      }
      if (destroyed) return;
      // During a switch the layer stays on, with no view until the new one is added.
      succeed(key, run, target ? { viewId: null } : { applied: false, viewId: null });
      // Newer intent is planned afresh rather than finishing this switch.
      if (!target || dirty.has(key)) return;
    }

    record = store.get(key);
    const midSwitch = record.applied;
    begin(key, run, midSwitch ? "switching" : "loading");
    try {
      await views.add(target);
    } catch (error) {
      if (destroyed) return;
      if (!midSwitch) {
        fail(key, run, error, "add", intent, {}, { desired: false });
      } else if (dirty.has(key)) {
        // Newer intent is tried next instead of rolling back.
        fail(key, run, error, "add", intent, {}, {});
      } else {
        await rollBackSwitch(
          key,
          run,
          error,
          intent,
          record.appliedSourceIdx,
          viewFor(record.appliedSourceIdx),
        );
      }
      return;
    }
    succeed(key, run, { applied: true, viewId: target, appliedSourceIdx: targetIdx });
  }

  /**
   * A source switch removed the old view but could not add the new one: put the
   * old view back. If that fails too, nothing of the layer is on the map, so it
   * is recorded as off rather than as on with no view.
   */
  async function rollBackSwitch(key, run, error, intent, previousIdx, previousView) {
    try {
      await views.add(previousView);
    } catch (rollbackError) {
      report(key, error, "add");
      fail(
        key,
        run,
        rollbackError,
        "rollback",
        intent,
        { applied: false, viewId: null },
        { desired: false, sourceIdx: previousIdx },
      );
      return;
    }
    fail(key, run, error, "add", intent, { viewId: previousView }, { desired: true, sourceIdx: previousIdx });
  }

  /** Layers whose MapX views are created at runtime by an external provider. */
  async function reconcileExternal(key, layer, run) {
    const record = store.get(key);
    const intent = intentOf(key, record);
    // The registry, not the record, says which runtime view is on the map.
    const runtime = external.getRuntime(layer);
    const off = { applied: false, viewId: null, appliedSettings: null };

    if (!record.desired) {
      if (!runtime) {
        if (record.applied) succeed(key, run, off);
        return;
      }
      begin(key, run, "removing");
      try {
        await external.close(layer);
      } catch (error) {
        fail(key, run, error, "remove", intent, {}, { desired: true, settings: runtime.settings });
        return;
      }
      succeed(key, run, off);
      return;
    }

    if (!runtime) {
      begin(key, run, "loading");
      let opened;
      try {
        // `settings` is kept while the layer is off, so turning it back on
        // reopens the last variant; provider defaults apply only to a layer
        // that never had settings.
        opened = await external.open(layer, record.settings ?? layer.external?.defaults);
        if (!isRuntime(opened)) throw new TypeError(`Layer "${key}": provider open returned no runtime view`);
      } catch (error) {
        fail(key, run, error, "add", intent, {}, { desired: false, settings: record.appliedSettings });
        return;
      }
      succeed(key, run, {
        applied: true,
        viewId: opened.idView,
        appliedSettings: opened.settings,
        ...(store.get(key).settings === intent.settings ? { settings: opened.settings } : {}),
      });
      return;
    }

    if (record.settings && !settingsMatch(runtime.settings, record.settings)) {
      begin(key, run, "switching");
      let replaced;
      try {
        // Creates the new view before removing the old one, so on failure the
        // registered view is still the one on the map.
        replaced = await external.replace(layer, record.settings);
        if (!isRuntime(replaced?.runtime)) {
          throw new TypeError(`Layer "${key}": provider replace returned no runtime view`);
        }
      } catch (error) {
        // The registry, not the provider's result, says which view is on the map now.
        const registered = external.getRuntime(layer);
        const shown = isRuntime(registered) ? registered : runtime;
        fail(
          key,
          run,
          error,
          "switch",
          intent,
          { viewId: shown.idView, appliedSettings: shown.settings },
          { settings: shown.settings },
        );
        return;
      }
      const { idView, settings } = replaced.runtime;
      succeed(key, run, {
        applied: true,
        viewId: idView,
        appliedSettings: settings,
        ...(store.get(key).settings === intent.settings ? { settings } : {}),
      });
      return;
    }

    // MapX already shows what is wanted; make sure the record says so.
    if (!record.applied || record.viewId !== runtime.idView) {
      succeed(key, run, { applied: true, viewId: runtime.idView, appliedSettings: runtime.settings });
    }
  }

  /**
   * Whether a layer's intent differs from what MapX shows: on/off, the source
   * of a compound layer that is on, or the settings of an external layer that
   * is on. True from the moment intent is written until the controller has
   * applied it, or reset it after a failure.
   */
  function hasPendingIntent(key) {
    const record = store.get(key);
    if (record.desired !== record.applied) return true;
    if (!record.desired) return false;
    const layer = getLayer(key);
    if (!layer) return false;
    if (external.isExternal(layer)) {
      return Boolean(record.settings) && !settingsMatch(record.appliedSettings, record.settings);
    }
    return hasSources(layer) && clampSourceIdx(layer, record.sourceIdx) !== record.appliedSourceIdx;
  }

  return {
    intend,
    hasPendingIntent,
    /** Turn a layer on or off. */
    setOn: (key, on) => intend(key, { desired: Boolean(on) }),
    /** Pick a compound layer's source. Applied now if the layer is on, otherwise on the next turn-on. */
    setSource: (key, sourceIdx) => intend(key, { sourceIdx }),
    /** Change an external layer's provider settings. */
    setSettings: (key, settings) => intend(key, { settings }),
    /** Turn off every layer that is on, loading or wanted. Resolves once all have settled. */
    clearAll: () =>
      Promise.all(
        store
          .all()
          .filter((record) => record.desired || record.applied || running.has(record.key))
          .map((record) => intend(record.key, { desired: false })),
      ),
    /**
     * Retire the controller: ignore new intent, drop the results of MapX calls
     * still in flight (nothing is written to the store) and start no more calls.
     * Pending callers resolve with the store's record as it was left.
     */
    destroy() {
      destroyed = true;
    },
  };
}
