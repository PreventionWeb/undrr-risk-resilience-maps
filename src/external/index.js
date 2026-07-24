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
    defaults: { ...layer.external.defaults },
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
  try {
    await providerFor(layer).remove(runtime.idView);
  } finally {
    unregister(runtime);
  }
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
  const next = await providerFor(layer).create(settings, sdk);

  unregister(current);
  const runtime = register(layer, next);

  try {
    await providerFor(layer).remove(current.idView, sdk);
  } catch (error) {
    console.warn(`Failed to delete replaced external view ${current.idView}:`, error);
  }

  if (camera) {
    await sdk.ask("map_jump_to", camera).catch(() => {});
  }
  return { runtime, previousIdView: current.idView };
}

/** Test helper for clearing module state without issuing SDK calls. */
export function resetExternalRuntime() {
  runtimeByLayerKey.clear();
  runtimeByViewId.clear();
}
