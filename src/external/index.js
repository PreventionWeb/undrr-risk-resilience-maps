/**
 * Runtime registry for non-MapX data providers.
 *
 * External providers still render inside MapX by creating temporary GeoJSON
 * views. The registry maps stable layer config keys to their runtime MapX IDs,
 * which lets existing opacity, inspection, clear-all, and hash logic keep using
 * the same openViews Set as pre-built MapX layers.
 */
import { getSDK } from "../sdk/client.js";
import { createEDRAView, deleteEDRAView, EDRA_CONTROLS, EDRA_LEGEND } from "./edra-agriculture.js";

const PROVIDERS = {
  "edra-agriculture": {
    create: createEDRAView,
    remove: deleteEDRAView,
    controls: EDRA_CONTROLS,
    legend: EDRA_LEGEND,
  },
};

const runtimeByLayerKey = new Map();
const runtimeByViewId = new Map();

/**
 * Provider contract:
 * - create(settings, sdk?) -> Promise<{ idView, settings }>
 * - remove(idView, sdk?) -> Promise<void>
 * - controls -> serialisable control definitions for the generic UI
 * - legend -> serialisable legend entries for the generic UI
 *
 * Provider-specific URLs, projections, joins, and styles stay in the adapter.
 * The sidebar and runtime registry only depend on this contract.
 */
function providerFor(layer) {
  const provider = PROVIDERS[layer.external?.provider];
  if (!provider) throw new Error(`Unknown external layer provider: ${layer.external?.provider}`);
  return provider;
}

function register(layer, record) {
  const runtime = { ...record, layer };
  runtimeByLayerKey.set(layer.key, runtime);
  runtimeByViewId.set(record.idView, runtime);
  return runtime;
}

function unregister(runtime) {
  if (!runtime) return;
  runtimeByLayerKey.delete(runtime.layer.key);
  runtimeByViewId.delete(runtime.idView);
}

export function isExternalLayer(layer) {
  return Boolean(layer?.external?.provider);
}

export function getExternalLayerRuntime(layer) {
  return runtimeByLayerKey.get(layer.key) ?? null;
}

export function getExternalRuntimeByViewId(idView) {
  return runtimeByViewId.get(idView) ?? null;
}

export function getExternalLayerDefinition(layer) {
  const provider = providerFor(layer);
  return {
    controls: provider.controls,
    legend: provider.legend,
  };
}

export async function openExternalLayer(layer, settings = layer.external.defaults) {
  const existing = getExternalLayerRuntime(layer);
  if (existing) return existing;
  const record = await providerFor(layer).create(settings);
  return register(layer, record);
}

export async function closeExternalLayer(layer) {
  const runtime = getExternalLayerRuntime(layer);
  if (!runtime) return null;
  await providerFor(layer).remove(runtime.idView);
  unregister(runtime);
  return runtime;
}

async function captureCamera(sdk) {
  try {
    const [center, zoom] = await Promise.all([sdk.ask("map_get_center"), sdk.ask("map_get_zoom")]);
    if (!center || typeof zoom !== "number") return null;
    return {
      center: Array.isArray(center) ? center : [center.lng, center.lat],
      zoom,
    };
  } catch {
    return null;
  }
}

/**
 * Replace a temporary view while preserving the current map camera. The new
 * view is created before the old one is removed, so failed requests leave the
 * currently visible layer intact.
 */
export async function replaceExternalLayer(layer, settings) {
  const current = getExternalLayerRuntime(layer);
  if (!current) throw new Error(`External layer "${layer.key}" is not open`);

  const sdk = getSDK();
  const camera = await captureCamera(sdk);
  const provider = providerFor(layer);
  let next;
  try {
    next = await provider.create(settings, sdk);
    try {
      await provider.remove(current.idView, sdk);
    } catch (error) {
      // Keep the currently registered view authoritative. Best-effort cleanup
      // of the candidate prevents a duplicate if old-view deletion failed.
      try {
        await provider.remove(next.idView, sdk);
      } catch (cleanupError) {
        console.warn(`Failed to clean up replacement external view ${next.idView}:`, cleanupError);
      }
      throw error;
    }

    unregister(current);
    const runtime = register(layer, next);
    return { runtime, previousIdView: current.idView };
  } finally {
    if (camera) {
      try {
        await sdk.ask("map_jump_to", camera);
      } catch {
        // Camera restoration is best-effort and must not corrupt view state.
      }
    }
  }
}

/** Test helper for clearing module state without issuing SDK calls. */
export function resetExternalRuntime() {
  runtimeByLayerKey.clear();
  runtimeByViewId.clear();
}
