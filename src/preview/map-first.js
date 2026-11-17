/** Separate map-first UX experiment. It never reads the stepper workspace store. */
import { TABS, PRIMARY_PROJECT } from "../config/layers.js";
import { isLayerAvailable } from "../config/layers/status.js";
import { getViewDownloads, formatBytes } from "../config/downloads.js";
import { loadMapXSdk, getMapXBaseUrl } from "../sdk/availability.js";
import { askWithTimeout, createCamera } from "../sdk/camera.js";
import { readPreviewLegend } from "./map-legend.js";
import { createDownloads } from "../ui/downloads.js";
import { escapeHtml as escape, HIDDEN_ATTRIBUTE_KEYS, isEmptyAttributeValue } from "../utils/html.js";
import "../styles/components/downloads.css";
import "./layer-workspace.css";
import "./map-first.css";

const $ = (selector) => document.querySelector(selector);
const icon = (name) => `<span class="mg-icon mg-icon-${name}" aria-hidden="true"></span>`;
const storageKey = "undrr-map-first-preview-v1";
const featuredUid = "aal-to-gdp-2025:0";
const datasets = TABS.flatMap((tab) =>
  tab.layers.filter((layer) => isLayerAvailable(layer) && !layer.external).map((layer) => ({ tab, layer })),
);
const entries = datasets.flatMap(({ tab, layer }) =>
  (layer.sources?.length ? layer.sources : [null]).map((source, index) => ({
    uid: `${layer.key}:${index}`,
    id: source?.id ?? layer.id,
    source,
    layer,
    tab,
    variant: source?.label ?? "Published indicator",
  })),
);
const byUid = new Map(entries.map((entry) => [entry.uid, entry]));
let state = {
  current: featuredUid,
  saved: [],
  mode: "single",
  left: featuredUid,
  right: null,
  rail: "browse",
};
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && typeof saved === "object") {
    if (byUid.has(saved.current)) state.current = saved.current;
    if (Array.isArray(saved.saved)) state.saved = [...new Set(saved.saved.filter((uid) => byUid.has(uid)))];
    if (saved.mode === "compare") state.mode = "compare";
    if (byUid.has(saved.left)) state.left = saved.left;
    if (byUid.has(saved.right)) state.right = saved.right;
    if (saved.rail === "saved") state.rail = "saved";
  }
} catch {
  /* Storage is optional. */
}
const sharedUid = new URLSearchParams(location.search).get("map");
if (byUid.has(sharedUid)) {
  state.current = sharedUid;
  state.left = sharedUid;
  state.mode = "single";
}
let query = "",
  category = "all",
  expanded = null,
  linked = true,
  sdkPromise = null;
const choices = new Map();
const loaded = new Set();
const legendCache = new Map();
const tableCache = new Map();
const sides = Object.fromEntries(
  ["left", "right"].map((name) => [
    name,
    {
      name,
      manager: null,
      starting: false,
      ready: false,
      actual: null,
      running: false,
      dirty: false,
      legendId: null,
    },
  ]),
);
const names = {
  "aal-to-gdp-2025": "Average annual loss as a share of GDP",
  "pml-to-gdp-2025": "Probable maximum loss as a share of GDP",
  "change-fiscal-gap": "Fiscal resilience",
  "early-warning-coverage": "Early warning coverage",
  "recovery-speed": "Household recovery speed",
  "aal-public": "Average annual loss to public assets",
  "pml-public": "Probable maximum loss to public assets",
  "current-fiscal-gap": "Fiscal gap",
};
const title = (entry) => names[entry.layer.key] ?? entry.layer.label;
const suggestions = [
  { uid: featuredUid, image: "earthquake-loss.jpg", label: "Earthquake losses" },
  { uid: "change-fiscal-gap:0", image: "fiscal-gap.jpg", label: "Fiscal resilience" },
  { uid: "gar26-aal-crops:0", image: null, label: "Drought crop losses" },
].filter((item) => byUid.has(item.uid));
const empty = (heading, text) =>
  `<div class="mg-empty-state mg-empty-state--compact mg-empty-state--start"><p class="mg-empty-state__title">${escape(heading)}</p><p class="mg-empty-state__description">${escape(text)}</p></div>`;
function announce(text) {
  $("#mf-announcement").textContent = text;
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* Optional. */
  }
}
function availableUids() {
  return [...new Set([state.current, ...state.saved])];
}
function desired(name) {
  return name === "right"
    ? state.mode === "compare"
      ? state.right
      : null
    : state.mode === "compare"
      ? state.left
      : state.current;
}
function displayed(uid) {
  return desired("left") === uid || desired("right") === uid;
}
function statusLabel(text, modifier = "") {
  return `<span class="mg-status-label${modifier ? ` mg-status-label--${modifier}` : ""}"><span class="mg-status-label__indicator" aria-hidden="true"></span>${escape(text)}</span>`;
}
function status(text, error = false) {
  $("#mf-map-status").innerHTML = statusLabel(
    text,
    error ? "negative" : text === "Live map" ? "published" : "warning",
  );
}
function normalize() {
  if (!byUid.has(state.current)) state.current = featuredUid;
  if (state.mode === "compare") {
    if (!availableUids().includes(state.left)) state.left = state.current;
    if (!availableUids().includes(state.right) || state.right === state.left)
      state.right = availableUids().find((uid) => uid !== state.left) ?? null;
    if (!state.right) state.mode = "single";
  }
}
function update() {
  normalize();
  persist();
  renderRail();
  renderChrome();
  void startSide("left");
  if (state.mode === "compare") void startSide("right");
  for (const side of Object.values(sides)) void reconcile(side);
}
function view(uid) {
  if (!byUid.has(uid)) return;
  state.current = uid;
  state.left = uid;
  state.mode = "single";
  $("#mf-inspection").hidden = true;
  $("#mf-country").value = "";
  update();
  announce(`${title(byUid.get(uid))}, ${byUid.get(uid).variant}, selected for the map.`);
}
function save(uid) {
  if (state.saved.includes(uid)) return;
  state.saved.push(uid);
  update();
  $("#mf-save-status").textContent = "Saved to My maps. Viewing and saving are separate.";
  announce(`${title(byUid.get(uid))} saved to My maps.`);
}
function compare(uid) {
  if (uid === state.current) return;
  state.mode = "compare";
  state.left = state.current;
  state.right = uid;
  lastViews = null;
  $("#mf-inspection").hidden = true;
  update();
  resizeMaps();
}
function resizeMaps() {
  for (const side of Object.values(sides))
    if (side.ready) void side.manager.ask("map", { method: "resize" }).catch(() => {});
}
function renderRail() {
  $("#mf-browse").hidden = state.rail !== "browse";
  $("#mf-saved").hidden = state.rail !== "saved";
  for (const [id, value] of [
    ["mf-browse-tab", "browse"],
    ["mf-saved-tab", "saved"],
  ]) {
    const button = $(`#${id}`);
    button.setAttribute("aria-pressed", String(state.rail === value));
    button.classList.toggle("mg-button-outline", state.rail !== value);
  }
  $("#mf-saved-count").textContent = state.saved.length;
  $("#mf-clear-saved").disabled = !state.saved.length;
  $("#mf-suggestions").hidden = Boolean(query || category !== "all");
  $("#mf-suggestions").innerHTML =
    `<div class="mf-list-heading"><h2>Suggested maps</h2></div><div class="mf-suggestions">${suggestions.map((item) => `<button class="mf-suggestion" data-view="${item.uid}" aria-label="View map: ${escape(item.label)}" aria-pressed="${state.current === item.uid}">${item.image ? `<img src="${import.meta.env.BASE_URL}preview-thumbnails/${item.image}" alt="" width="910" height="624" />` : `<span class="mf-suggestion-icon">${icon("drought")}</span>`}<span>${escape(item.label)}</span></button>`).join("")}</div>`;
  const results = datasets.filter(
    ({ layer, tab }) =>
      (category === "all" || tab.id === category) &&
      [title({ layer }), layer.desc, tab.label, ...(layer.sources ?? []).map((source) => source.label)]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  $("#mf-result-count").textContent = results.length;
  const scroll = $(".mf-rail").scrollTop;
  $("#mf-datasets").innerHTML =
    results
      .map(({ layer, tab }) => {
        const variants = entries.filter((entry) => entry.layer === layer);
        const index = choices.get(layer.key) ?? 0;
        const entry = variants[index] ?? variants[0];
        const open = expanded === layer.key;
        return `<article class="mf-dataset"><button class="mf-dataset-title" data-expand="${layer.key}" aria-expanded="${open}" aria-controls="options-${layer.key}"><span>${escape(title(entry))}</span>${icon(open ? "minus" : "plus")}</button><p>${escape(layer.desc)}</p>${open ? `<div class="mf-dataset-options" id="options-${layer.key}">${variants.length > 1 ? `<label for="variant-${layer.key}">${escape(layer.widget?.label ?? "Map variant")}</label><select class="mg-form-select" id="variant-${layer.key}" data-variant="${layer.key}">${variants.map((v, i) => `<option value="${i}" ${i === index ? "selected" : ""}>${escape(v.variant)}</option>`).join("")}</select>` : `<p class="mf-dataset-note">${escape(tab.label)} · ${escape(entry.variant)}</p>`}<div class="mf-dataset-actions"><button class="mg-button mg-button-primary" data-view="${entry.uid}">View map</button><button class="mg-button mg-button-primary mg-button-outline" data-save="${entry.uid}" ${state.saved.includes(entry.uid) ? "disabled" : ""}>${state.saved.includes(entry.uid) ? "Saved" : "Save to My maps"}</button></div>${entry.source?.note || layer.note ? `<p class="mf-dataset-note">${escape(entry.source?.note || layer.note)}</p>` : ""}</div>` : ""}</article>`;
      })
      .join("") || empty("No matching maps", "Try another topic or category.");
  $(".mf-rail").scrollTop = scroll;
  $("#mf-saved-list").innerHTML =
    state.saved
      .map((uid) => {
        const entry = byUid.get(uid);
        const onMap = displayed(uid);
        const pending = onMap && !Object.values(sides).some((side) => side.actual === uid);
        const label = pending
          ? "Loading"
          : onMap
            ? state.mode === "compare"
              ? uid === state.left
                ? "Left map"
                : "Right map"
              : "On map"
            : "Saved";
        return `<article class="mf-saved-card ${onMap ? "is-on-map" : ""}"><h3>${escape(title(entry))}</h3><p>${escape(entry.variant)}</p>${statusLabel(label, onMap ? "published" : "")}<div class="mf-dataset-actions"><button class="mg-button mg-button-primary mg-button-outline" data-view="${uid}">View map</button>${uid !== state.current ? `<button class="mg-button mg-button-primary mg-button-outline" data-compare="${uid}">Compare</button>` : ""}<button class="mg-button mg-button-primary mg-button-outline" data-remove="${uid}" aria-label="Remove ${escape(title(entry))}, ${escape(entry.variant)}, from My maps">Remove</button></div></article>`;
      })
      .join("") ||
    empty(
      "No saved maps yet",
      "View any map straight away. Save a variant when you want to keep it or compare it later.",
    );
}
function renderChrome() {
  const entry = byUid.get(state.current);
  $("#mf-map-kind").textContent =
    state.mode === "compare"
      ? "Comparing maps"
      : state.current === featuredUid
        ? "Featured map"
        : "Viewing map";
  $("#mf-current-title").textContent = title(entry);
  $("#mf-current-variant").textContent = entry.layer.key.includes("gdp-2025")
    ? `${entry.variant} · % of GDP · 2025 baseline`
    : entry.variant;
  const saved = state.saved.includes(state.current);
  $("#mf-save-current").innerHTML =
    `${icon(saved ? "layers" : "plus")}${saved ? "Saved to My maps" : "Save to My maps"}`;
  $("#mf-save-current").disabled = saved;
  $("#mf-compare").hidden = state.mode === "compare" || availableUids().length < 2;
  $("#mf-single").hidden = state.mode !== "compare";
  $("#mf-link-views").hidden = state.mode !== "compare";
  $("#mf-link-views").textContent = linked ? "Views linked" : "Link views";
  $("#mf-link-views").setAttribute("aria-pressed", String(linked));
  $("#map-grid").classList.toggle("is-comparing", state.mode === "compare");
  $("#right-pane").hidden = state.mode !== "compare";
  $("#mf-interpretation").textContent =
    state.mode === "compare"
      ? "Each map has its own units and legend. Check the scales before comparing values."
      : entry.layer.key === "aal-to-gdp-2025"
        ? "A modelled average annual loss estimate, expressed as a share of GDP (2025 baseline). This is one indicator, not an overall risk score."
        : "Explore the named indicator. Open About this map for its description, source and exact variant.";
  for (const name of ["left", "right"]) {
    const current = desired(name);
    const v = byUid.get(current);
    $(`#${name}-map-label`).innerHTML =
      state.mode === "compare"
        ? `<label for="mf-${name}-select">${name === "left" ? "Left map" : "Right map"}</label><select id="mf-${name}-select" class="mg-form-select" data-side="${name}">${availableUids()
            .map((uid) => {
              const e = byUid.get(uid);
              return `<option value="${uid}" ${current === uid ? "selected" : ""}>${escape(title(e))} · ${escape(e.variant)}</option>`;
            })
            .join("")}</select>`
        : v
          ? `<strong>${escape(v.variant)}</strong><span>Click a location to inspect</span>`
          : "";
  }
  if ($("#mf-download-dialog").open) renderDownloadReview();
}
$("#mf-category").insertAdjacentHTML(
  "beforeend",
  TABS.map((tab) => `<option value="${tab.id}">${escape(tab.label)}</option>`).join(""),
);
$("#mf-search").addEventListener("input", (event) => {
  query = event.target.value;
  renderRail();
});
$("#mf-category").addEventListener("change", (event) => {
  category = event.target.value;
  renderRail();
});
$("#mf-browse-tab").addEventListener("click", () => {
  state.rail = "browse";
  update();
});
$("#mf-saved-tab").addEventListener("click", () => {
  state.rail = "saved";
  update();
});
$(".mf-rail").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.expand) {
    expanded = expanded === button.dataset.expand ? null : button.dataset.expand;
    renderRail();
    $(`[data-expand="${expanded ?? button.dataset.expand}"]`)?.focus();
  }
  if (button.dataset.view) view(button.dataset.view);
  if (button.dataset.save) save(button.dataset.save);
  if (button.dataset.compare) compare(button.dataset.compare);
  if (button.dataset.remove) {
    state.saved = state.saved.filter((uid) => uid !== button.dataset.remove);
    update();
    announce("Removed from My maps. The current map remains available.");
  }
});
$("#mf-datasets").addEventListener("change", (event) => {
  if (event.target.dataset.variant) {
    choices.set(event.target.dataset.variant, Number(event.target.value));
    renderRail();
    $(`[data-variant="${event.target.dataset.variant}"]`)?.focus();
  }
});
$("#mf-save-current").addEventListener("click", () => save(state.current));
$("#mf-clear-saved").addEventListener("click", () => {
  state.saved = [];
  state.mode = "single";
  update();
  announce("Saved maps cleared. The displayed map is unchanged.");
});
$("#mf-compare").addEventListener("click", () =>
  compare(availableUids().find((uid) => uid !== state.current)),
);
$("#mf-single").addEventListener("click", () => {
  state.current = state.left;
  state.mode = "single";
  update();
  resizeMaps();
});
$("#mf-link-views").addEventListener("click", () => {
  linked = !linked;
  lastViews = null;
  renderChrome();
});
$("#map-grid").addEventListener("change", (event) => {
  const side = event.target.dataset.side;
  if (!side) return;
  const other = side === "left" ? "right" : "left";
  const previous = state[side];
  state[side] = event.target.value;
  if (state[other] === state[side]) state[other] = previous;
  $("#mf-inspection").hidden = true;
  update();
});

async function startSide(name) {
  const side = sides[name];
  if (side.manager || side.starting) return;
  side.starting = true;
  try {
    sdkPromise ??= loadMapXSdk();
    await sdkPromise;
    side.manager = new window.mxsdk.Manager({
      container: $(`#map-${name}`),
      url: `${getMapXBaseUrl()}/?project=${PRIMARY_PROJECT}`,
      iframeTitle: name === "left" ? "Main interactive map" : "Comparison interactive map",
      params: { closePanels: true, language: "en", theme: "color_light" },
      style: { width: "100%", height: "100%", border: "none" },
    });
    const timer = setTimeout(() => {
      if (!side.ready) status("Map is taking longer to connect. Reload to retry.", true);
    }, 40000);
    side.manager.on("click_features", (data) => {
      if (!side.actual || side.actual !== desired(name)) return;
      const entry = byUid.get(side.actual);
      const raw = data?.attributes?.[entry.id];
      inspect(entry, Array.isArray(raw) ? raw : raw ? [raw] : [], data?.lngLat, side.name);
    });
    side.manager.on("ready", async () => {
      clearTimeout(timer);
      try {
        await askWithTimeout(side.manager, "set_immersive_mode", { enable: true });
        await askWithTimeout(side.manager, "set_features_click_sdk_only", { enable: true });
        if (name === "right" && sides.left.ready)
          await createCamera(() => side.manager).setView(
            await createCamera(() => sides.left.manager).getView(),
          );
        else await createCamera(() => side.manager).setView({ center: { lng: 12, lat: 18 }, zoom: 1.5 });
        side.ready = true;
        await reconcile(side);
      } catch (error) {
        console.error("Map-first setup:", error);
        status("Could not prepare the map. Reload to retry.", true);
      }
    });
  } catch (error) {
    console.error("Map-first connection:", error);
    status("Map service unavailable. Browse and save maps while offline.", true);
  }
}
async function reconcile(side) {
  if (!side.ready) return;
  side.dirty = true;
  if (side.running) return;
  side.running = true;
  try {
    do {
      side.dirty = false;
      const uid = desired(side.name);
      const entry = byUid.get(uid);
      status("Updating map…");
      if (side.actual && side.actual !== uid) {
        await askWithTimeout(side.manager, "view_remove", { idView: byUid.get(side.actual).id });
        side.actual = null;
      }
      if (uid && !side.actual) {
        await askWithTimeout(side.manager, "view_add", { idView: entry.id, zoomToView: false }, 20000);
        side.actual = uid;
        if (side.name === "left") loaded.add(entry.id);
      }
      if (!side.dirty) {
        void legend(side, entry);
        if (side.name === "left") void loadCountryIndex(entry);
      }
    } while (side.dirty);
    status(state.mode === "compare" && !sides.right.ready ? "Loading comparison map…" : "Live map");
  } catch (error) {
    console.error("Map-first update:", error);
    status("Map update failed. Choose a map to retry.", true);
  } finally {
    side.running = false;
    renderRail();
  }
}
async function legend(side, entry) {
  const host = $(`#${side.name}-legend`);
  if (!entry) {
    host.replaceChildren();
    side.legendId = null;
    return;
  }
  side.legendId = entry.id;
  host.innerHTML = '<span class="muted">Loading legend…</span>';
  try {
    if (!legendCache.has(entry.id))
      legendCache.set(
        entry.id,
        readPreviewLegend(side.manager, entry).catch((error) => {
          legendCache.delete(entry.id);
          throw error;
        }),
      );
    const result = await legendCache.get(entry.id);
    if (side.legendId !== entry.id) return;
    host.innerHTML = `<h3>${escape(result?.title || title(entry))}</h3>`;
    if (result?.entries)
      for (const item of result.entries) {
        const row = document.createElement("div");
        row.className = "legend-item";
        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        swatch.style.backgroundColor = item.color;
        const label = document.createElement("span");
        label.textContent = item.label;
        row.append(swatch, label);
        host.append(row);
      }
    else if (typeof result?.image === "string") {
      const img = document.createElement("img");
      img.alt = `Legend for ${title(entry)}`;
      img.src = result.image.startsWith("data:") ? result.image : `data:image/png;base64,${result.image}`;
      img.style.maxWidth = "100%";
      host.append(img);
    }
  } catch {
    if (side.legendId === entry.id)
      host.innerHTML = '<span class="muted">Legend unavailable. Try viewing the map again.</span>';
  }
}
const countryName = (row) => row.maplab || row.romnam || row.name_en || row.name || row.iso3cd;
const missing = (value) =>
  isEmptyAttributeValue(value) ||
  (typeof value === "number" && (!Number.isFinite(value) || value <= -3.4e38));
const format = (value) =>
  missing(value)
    ? "No reported data"
    : typeof value === "number"
      ? new Intl.NumberFormat("en", { maximumSignificantDigits: 5 }).format(value)
      : String(value);
async function table(entry) {
  if (!tableCache.has(entry.id))
    tableCache.set(
      entry.id,
      askWithTimeout(sides.left.manager, "get_view_table_attribute", { idView: entry.id }, 20000)
        .then((rows) => (Array.isArray(rows) ? rows : []))
        .catch((error) => {
          tableCache.delete(entry.id);
          throw error;
        }),
    );
  return tableCache.get(entry.id);
}
async function loadCountryIndex(entry) {
  if (!entry || !getViewDownloads(entry.layer, entry.source).csv) {
    $("#mf-country").disabled = true;
    $("#mf-country-go").disabled = true;
    $("#mf-countries").replaceChildren();
    $("#mf-country-hint").textContent =
      "Country search is not available for this map. Click a feature or location.";
    return;
  }
  const uid = entry.uid;
  $("#mf-country").disabled = true;
  $("#mf-country-go").disabled = true;
  try {
    const rows = await table(entry);
    if (desired("left") !== uid) return;
    const named = rows.filter((row) => typeof countryName(row) === "string");
    $("#mf-countries").innerHTML = [...new Set(named.map(countryName))]
      .sort()
      .map((name) => `<option value="${escape(name)}"></option>`)
      .join("");
    $("#mf-country").disabled = !named.length;
    $("#mf-country-go").disabled = !named.length;
    $("#mf-country-hint").textContent = "You can also click the map to inspect a location.";
  } catch {
    if (desired("left") === uid)
      $("#mf-country-hint").textContent =
        "Country search unavailable for this indicator. Click the map to inspect a location.";
  }
}
function metricKey(entry, row) {
  if (!row) return null;
  if ("j0_value" in row) return "j0_value";
  // This family exposes the named joined GDP-percentage attribute, not j0_value.
  // Do not infer a primary metric for unrelated multi-attribute datasets.
  if (entry.layer.key === "aal-to-gdp-2025") {
    const candidates = Object.keys(row).filter((key) => /^j0_aal_.+_togdppercent$/i.test(key));
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}
function inspect(entry, rows, lngLat = null, sideName = "left") {
  const row = rows[0];
  const location = (row && countryName(row)) || "Selected location";
  $("#mf-inspection-title").textContent = location;
  const valueKey = metricKey(entry, row);
  const main = valueKey ? row[valueKey] : undefined;
  const fields = row
    ? Object.entries(row).filter(
        ([key, value]) =>
          !HIDDEN_ATTRIBUTE_KEYS.includes(key.toLowerCase()) &&
          !["maplab", "romnam", "name_en", "name", valueKey].includes(key) &&
          typeof value !== "object",
      )
    : [];
  const metric = entry.layer.key.includes("gdp-2025") ? "% of GDP (2025 baseline)" : "Source value";
  $("#mf-inspection-body").innerHTML =
    `<p><strong>${escape(title(entry))}</strong><br>${escape(entry.variant)}</p>${row && valueKey ? `<strong class="mf-value">${escape(format(main))}</strong><p>${escape(metric)}</p>` : !row ? "<p>No reported data at this location. This does not mean zero.</p>" : ""}${fields.length ? `<dl>${fields.map(([key, value]) => `<dt>${escape(key === "iso3cd" ? "Country code" : key === "GRAY_INDEX" ? "Raster value" : key.replace(/_/g, " "))}</dt><dd>${escape(format(value))}</dd>`).join("")}</dl>` : ""}${lngLat ? `<p>Location: ${Number(lngLat.lat).toFixed(3)}, ${Number(lngLat.lng).toFixed(3)}</p>` : ""}<p>${rows.length > 1 ? "First matching feature is shown. " : ""}${entry.layer.key.includes("gdp-2025") ? "National estimates do not describe differences within a country." : ""}</p><p>Source: ${escape(entry.layer.source)}</p>`;
  $("#mf-inspection").hidden = false;
  announce(
    `${location}. ${row && valueKey ? format(main) : row ? "Feature details available" : "No reported data"}.`,
  );
  const code = row?.iso3cd;
  if (typeof code === "string" && /^[A-Z]{3}$/.test(code) && sides[sideName].ready)
    void sides[sideName].manager.ask("set_country_highlight", [code]).catch(() => {});
}
$("#mf-country-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#mf-country").value.trim().toLowerCase();
  const entry = byUid.get(desired("left"));
  try {
    const rows = await table(entry);
    const row = rows.find(
      (candidate) =>
        String(countryName(candidate) ?? "").toLowerCase() === input ||
        String(candidate.iso3cd ?? "").toLowerCase() === input,
    );
    if (!row) {
      $("#mf-country-hint").textContent = "Choose a country name from the suggestions, or click the map.";
      return;
    }
    inspect(entry, [row]);
    $("#mf-inspection-title").focus();
  } catch {
    status("Could not retrieve country details. Try clicking the map.", true);
  }
});
$("#mf-close-inspection").addEventListener("click", () => {
  $("#mf-inspection").hidden = true;
  $("#mf-country").focus();
});
$("#mf-map-details").addEventListener("click", () => {
  const entry = byUid.get(desired("left"));
  $("#mf-inspection-title").textContent = "About this map";
  $("#mf-inspection-body").innerHTML =
    `<p><strong>${escape(title(entry))}</strong><br>${escape(entry.variant)}</p><p>${escape(entry.source?.note || entry.source?.desc || entry.layer.desc)}</p><p>Source: ${escape(entry.layer.source)}</p><p>Licence: ${escape(entry.layer.license)}</p><p>${escape(entry.layer.citation)}</p>`;
  $("#mf-inspection").hidden = false;
  $("#mf-inspection-title").focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#mf-download-dialog").open) $("#mf-inspection").hidden = true;
});

const downloads = createDownloads({
  isViewWanted: (id) => desired("left") && byUid.get(desired("left")).id === id,
  isViewLoaded: (id) => loaded.has(id),
  onViewLoaded: (id) => loaded.add(id),
  onTemporaryView: (active) => {
    $("#map-left").style.visibility = active ? "hidden" : "";
  },
  isReady: () => sides.left.ready,
  onReadyChange: () => () => {},
  getSdk: () => sides.left.manager,
  viewerUrl: () => new URL(`./map-first.html?map=${encodeURIComponent(state.current)}`, location.href).href,
});
function renderDownloadReview() {
  $("#mf-download-results").innerHTML = availableUids()
    .map((uid) => {
      const entry = byUid.get(uid),
        available = getViewDownloads(entry.layer, entry.source);
      return `<article class="download-row"><div><h3>${escape(title(entry))}</h3><p>${escape(entry.variant)}</p><small>${displayed(uid) ? "Selected for display" : "Saved · not on map"}</small></div><div class="mf-dl-actions">${available.csv ? `<button class="mg-button mg-button-primary mg-button-outline variant-button" data-csv="${entry.id}" ${!sides.left.ready ? "disabled" : ""}>Download CSV</button>` : available.files.map((file) => `<a class="layer-downloads__link" href="${escape(file.url)}" download="${escape(file.filename)}" data-bytes="${file.bytes}" ${file.large ? "data-large" : ""} target="_blank" rel="noopener">${escape(file.format)} · ${escape(formatBytes(file.bytes))}</a>`).join("") || "<small>No reviewed download available</small>"}</div></article>`;
    })
    .join("");
}
$("#mf-downloads").addEventListener("click", () => {
  renderDownloadReview();
  $("#mf-download-dialog").showModal();
});
document
  .querySelectorAll("[data-dismiss]")
  .forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("#mf-download-results").addEventListener("click", (event) => {
  const csv = event.target.closest("[data-csv]"),
    large = event.target.closest("[data-large]");
  if (large) {
    event.preventDefault();
    $("#mf-download-dialog").close();
    void downloads.confirmLargeFile(large);
  }
  if (csv) {
    $("#mf-download-dialog").close();
    downloads.requestCsv(csv.dataset.csv, { opener: $("#mf-downloads") });
  }
});
let syncing = false,
  lastViews = null;
const signature = (view) =>
  `${view.center.lng.toFixed(4)},${view.center.lat.toFixed(4)},${view.zoom.toFixed(3)}`;
setInterval(async () => {
  if (
    syncing ||
    !linked ||
    state.mode !== "compare" ||
    document.hidden ||
    !sides.left.ready ||
    !sides.right.ready
  )
    return;
  syncing = true;
  try {
    const cameras = [createCamera(() => sides.left.manager), createCamera(() => sides.right.manager)],
      views = await Promise.all(cameras.map((camera) => camera.getView())),
      next = views.map(signature),
      source = !lastViews || next[0] !== lastViews[0] ? 0 : next[1] !== lastViews[1] ? 1 : null;
    if (source !== null && next[0] !== next[1]) {
      await cameras[1 - source].setView(views[source]);
      next[1 - source] = next[source];
    }
    lastViews = next;
  } catch {
    /* A camera read must not interrupt exploration. */
  } finally {
    syncing = false;
  }
}, 1200);
update();
