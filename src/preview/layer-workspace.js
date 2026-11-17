/** Local UX preview. Reuses published config, live MapX, legends and CSV flow. */
import { TABS, PRIMARY_PROJECT } from "../config/layers.js";
import { isLayerAvailable } from "../config/layers/status.js";
import { getViewDownloads, formatBytes } from "../config/downloads.js";
import { loadMapXSdk, getMapXBaseUrl } from "../sdk/availability.js";
import { createCamera, askWithTimeout } from "../sdk/camera.js";
import { readPreviewLegend } from "./map-legend.js";
import { createDownloads } from "../ui/downloads.js";
import "../styles/components/downloads.css";
import "./layer-workspace.css";

const $ = (selector) => document.querySelector(selector);
const escape = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const storageKey = "undrr-layer-workspace-preview-v1";
const catalog = TABS.flatMap((tab) =>
  tab.layers.filter((layer) => isLayerAvailable(layer) && !layer.external).map((layer) => ({ tab, layer })),
);
const variants = catalog.flatMap(({ tab, layer }) =>
  (layer.sources?.length ? layer.sources : [null]).map((source, index) => ({
    uid: `${layer.key}:${index}`,
    tab,
    layer,
    source,
    id: source?.id ?? layer.id,
    variant: source?.label ?? "Published indicator",
  })),
);
const byUid = new Map(variants.map((v) => [v.uid, v]));
// ?start=1 previews onboarding without reading or overwriting a saved workspace.
const previewStart = new URLSearchParams(location.search).get("start") === "1";
let state = { items: [], mode: "single", selected: null, left: null, right: null };
let restoredStep = null;

try {
  const saved = previewStart ? null : JSON.parse(localStorage.getItem(storageKey));
  if (saved && Array.isArray(saved.items)) {
    if (["choose", "explore"].includes(saved.step)) restoredStep = saved.step;
    const seen = new Set();
    state.items = saved.items
      .filter((item) => byUid.has(item.uid) && !seen.has(item.uid) && seen.add(item.uid))
      .map((item) => ({
        uid: item.uid,
        opacity: Number.isFinite(item.opacity) ? Math.max(0, Math.min(100, item.opacity)) : 100,
        visible: item.visible !== false,
      }));
    if (["single", "overlay", "compare"].includes(saved.mode)) state.mode = saved.mode;
    for (const key of ["selected", "left", "right"])
      if ((key === "selected" && saved[key] === null) || state.items.some((i) => i.uid === saved[key]))
        state[key] = saved[key];
  }
} catch {
  /* Storage is optional for the preview. */
}
let step = state.items.length && restoredStep !== "choose" ? "explore" : "choose";
let filter = "all";
let search = "";
let expanded = null;
let dragged = null;
let linked = true;
let sdkLoaded;
const loaded = new Set();
const sides = { left: makeSide("left"), right: makeSide("right") };
// Icon names are checked against the pinned Mangrove 2.3.0 stylesheet.
const icon = (name, className = "") =>
  `<span class="mg-icon mg-icon-${name} ${className}" aria-hidden="true"></span>`;
const eye = icon("eye");
const eyeOff = `<span class="workspace-icon-off" aria-hidden="true">${eye}</span>`;
const datasetLabel = (label) =>
  ({
    "Change in Fiscal Gap": "Change in fiscal gap",
    "Early Warning Coverage": "Early warning coverage",
    "AAL to GDP (2025)": "Average annual loss as a share of GDP (2025)",
    "PML to GDP (2025)": "Probable maximum loss as a share of GDP (2025)",
  })[label] ?? label;
const emptyState = (title, description) =>
  `<div class="mg-empty-state mg-empty-state--compact mg-empty-state--start"><p class="mg-empty-state__title">${escape(title)}</p><p class="mg-empty-state__description">${escape(description)}</p></div>`;

function makeSide(name) {
  return {
    name,
    manager: null,
    ready: false,
    applied: [],
    running: false,
    dirty: false,
    error: null,
    legendId: null,
  };
}
function announce(message) {
  $("#workspace-announcement").textContent = message;
}
function persist() {
  if (previewStart) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...state, step }));
  } catch {
    /* Optional. */
  }
}
function ensureSelection() {
  for (const key of ["selected", "left", "right"])
    if (!(key === "selected" && state[key] === null) && !state.items.some((i) => i.uid === state[key]))
      state[key] = state.items[key === "right" && state.items.length > 1 ? 1 : 0]?.uid ?? null;
  if (state.left === state.right && state.items.length > 1)
    state.right = state.items.find((i) => i.uid !== state.left).uid;
}
function visibleFor(name) {
  if (name === "right" && state.mode !== "compare") return [];
  if (state.mode === "overlay") return state.items.filter((i) => i.visible);
  const uid = state.mode === "compare" ? state[name] : state.selected;
  return state.items.filter((i) => i.uid === uid);
}
function isVisible(uid) {
  return visibleFor("left").some((i) => i.uid === uid) || visibleFor("right").some((i) => i.uid === uid);
}
function update() {
  ensureSelection();
  if (!state.items.length) step = "choose";
  persist();
  renderSteps();
  renderWorkspace();
  renderMapChrome();
  if (step === "choose") renderCatalog();
  if ($("#download-dialog").open) renderDownloads();
  if (step === "explore") {
    void startSide("left");
    if (state.mode === "compare") void startSide("right");
    void reconcile(sides.left);
    void reconcile(sides.right);
  }
}
function renderWorkspace() {
  $("#layer-count").textContent = state.items.length;
  $("#download-count").textContent = state.items.length;
  $("#stack-caption").textContent =
    state.mode === "overlay" ? "Stack order: top to bottom" : "Selected layers";
  $("#clear-workspace").disabled = !state.items.length;
  $("#review-downloads").disabled = !state.items.length;
  $("#workspace-list").innerHTML =
    state.items
      .map((item, index) => {
        const entry = byUid.get(item.uid);
        const visible = isVisible(item.uid);
        const applied = Object.values(sides).some(
          (side) => (side.name === "left" || state.mode === "compare") && side.applied.includes(entry.id),
        );
        const label = visible
          ? state.mode === "compare"
            ? item.uid === state.left
              ? "Left map"
              : "Right map"
            : state.mode === "overlay"
              ? "Visible on map"
              : "Shown on map"
          : "Ready to view";
        return `<article class="layer-card ${visible ? "is-visible" : ""}" data-uid="${escape(item.uid)}">
      <div class="layer-row"><span class="drag-handle" draggable="true" role="img" aria-label="Drag to reorder ${escape(datasetLabel(entry.layer.label))}" title="Drag to reorder; or use the up and down buttons"><span class="mg-icon workspace-grip" aria-hidden="true"></span></span><div class="layer-main"><div class="layer-category">${escape(entry.tab.label)}${state.mode === "overlay" ? ` · Layer ${index + 1}` : ""}</div><h2 class="layer-title">${escape(datasetLabel(entry.layer.label))}</h2><div class="layer-variant">${escape(entry.variant)}</div></div><button class="mg-icon-button icon-button visibility-button" data-action="show" aria-label="${state.mode === "compare" ? (visible ? "Shown in comparison:" : "Show on left map:") : visible ? "Hide" : "Show"} ${escape(datasetLabel(entry.layer.label))} – ${escape(entry.variant)}" aria-pressed="${visible}" ${state.mode === "compare" && visible ? "disabled" : ""} title="${state.mode === "compare" ? "Choose indicators using the map selectors" : visible ? "Hide layer" : "Show layer"}">${visible ? eye : eyeOff}</button></div>
      <div class="layer-card-footer"><span class="mg-status-label layer-state ${visible ? "mg-status-label--published shown" : ""}">${visible ? '<span class="mg-status-label__indicator" aria-hidden="true"></span>' : ""}${visible && Object.values(sides).some((side) => side.error) ? "Map update needs retry" : visible && !applied ? "Selected · loading map" : label}</span><div class="card-controls"><button class="mg-icon-button icon-button" data-action="up" aria-label="Move ${escape(entry.variant)} up" title="Move up" ${index === 0 ? "disabled" : ""}>${icon("arrow-left", "workspace-arrow-up")}</button><button class="mg-icon-button icon-button" data-action="down" aria-label="Move ${escape(entry.variant)} down" title="Move down" ${index === state.items.length - 1 ? "disabled" : ""}>${icon("arrow-right", "workspace-arrow-down")}</button><button class="mg-button mg-button-primary mg-button-outline text-button" data-action="settings" aria-expanded="${expanded === item.uid}" aria-controls="settings-${index}">Settings ${icon("arrow-right", expanded === item.uid ? "workspace-arrow-up" : "workspace-arrow-down")}</button></div></div>
      ${expanded === item.uid ? `<div class="layer-settings" id="settings-${index}"><label class="opacity-control">Opacity <input class="mg-range" type="range" min="0" max="100" value="${item.opacity}" aria-label="Opacity for ${escape(entry.variant)}" /><output>${item.opacity}%</output></label><p>${escape(entry.source?.note ?? entry.source?.desc ?? entry.layer.desc)}</p><small>Source: ${escape(entry.layer.source)}<br>Licence: ${escape(entry.layer.license)}</small><div class="settings-actions"><button class="mg-button mg-button-primary mg-button-outline text-button" data-action="another">${icon("plus")}Add another variant</button><button class="mg-button mg-button-primary mg-button-outline text-button danger" data-action="remove">Remove</button></div></div>` : ""}</article>`;
      })
      .join("") || emptyState("Your workspace is empty", "Add layers to start exploring.");
}
function renderMapChrome() {
  document.querySelectorAll("[data-mode]").forEach((input) => {
    input.checked = input.dataset.mode === state.mode;
  });
  $("#map-grid").classList.toggle("is-comparing", state.mode === "compare");
  $("#right-pane").hidden = state.mode !== "compare";
  $("#mode-explanation").innerHTML =
    state.mode === "single"
      ? "<strong>Show one of your layers.</strong> Use a layer’s visibility button to show it on the map."
      : state.mode === "overlay"
        ? "<span><strong>The first layer appears on top.</strong> Drag or use the move buttons to reorder. Adjust opacity in Settings. Overlapping colours may obscure values.</span>"
        : `<span><strong>Compare layers side by side.</strong> Each map has its own indicator and legend.</span><button id="link-views" class="mg-button mg-button-primary mg-button-outline text-button" aria-pressed="${linked}">${icon("link")}${linked ? "Views linked" : "Link views"}</button>`;
  for (const name of ["left", "right"]) {
    const shown = visibleFor(name);
    const first = shown[0] && byUid.get(shown[0].uid);
    const label = $(`#${name}-map-label`);
    label.innerHTML =
      state.mode === "compare"
        ? `<span>${name === "left" ? "Left map" : "Right map"}</span><br><select class="mg-form-select" aria-label="Indicator for ${name} map" data-side="${name}">${state.items
            .map((item) => {
              const v = byUid.get(item.uid);
              return `<option value="${escape(item.uid)}" ${item.uid === state[name] ? "selected" : ""}>${escape(datasetLabel(v.layer.label))} · ${escape(v.variant)}</option>`;
            })
            .join("")}</select>`
        : first
          ? `<strong>${state.mode === "overlay" ? `${shown.length} visible layer${shown.length === 1 ? "" : "s"}` : escape(datasetLabel(first.layer.label))}</strong><span>${state.mode === "overlay" ? `Top: ${escape(datasetLabel(first.layer.label))} · ${escape(first.variant)}` : escape(first.variant)}</span>`
          : "<strong>Explore the world’s risk and resilience</strong><span>Add or show a layer to display its data.</span>";
  }
  const visible = new Set([...visibleFor("left"), ...visibleFor("right")].map((i) => i.uid)).size;
  $("#map-summary").textContent =
    `${state.items.length} collected · ${visible} selected for display${state.mode === "overlay" ? " · Layers shown in list order" : ""}`;
}
function move(uid, offset) {
  const from = state.items.findIndex((i) => i.uid === uid),
    to = from + offset;
  if (to < 0 || to >= state.items.length) return;
  state.items.splice(to, 0, state.items.splice(from, 1)[0]);
  update();
  announce(`${byUid.get(uid).variant} moved to position ${to + 1}.`);
  $("#workspace-list")
    .querySelector(`[data-uid="${CSS.escape(uid)}"] [data-action="${offset < 0 ? "up" : "down"}"]`)
    ?.focus();
}
$("#workspace-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]"),
    card = button?.closest("[data-uid]");
  if (!button || !card) return;
  const uid = card.dataset.uid,
    item = state.items.find((i) => i.uid === uid);
  switch (button.dataset.action) {
    case "show":
      if (state.mode === "overlay") item.visible = !item.visible;
      else if (state.mode === "compare") {
        if (uid !== state.right) state.left = uid;
        else [state.left, state.right] = [state.right, state.left];
      } else state.selected = state.selected === uid ? null : uid;
      // A cleared single selection is valid; do not auto-select it again.
      if (state.mode === "single" && !state.selected) {
        persist();
        renderWorkspace();
        renderMapChrome();
        void reconcile(sides.left);
        return;
      }
      break;
    case "settings":
      expanded = expanded === uid ? null : uid;
      renderWorkspace();
      $(`[data-uid="${CSS.escape(uid)}"] [data-action="settings"]`)?.focus();
      return;
    case "up":
      move(uid, -1);
      return;
    case "down":
      move(uid, 1);
      return;
    case "remove":
      state.items = state.items.filter((i) => i.uid !== uid);
      announce(`${byUid.get(uid).variant} removed from workspace.`);
      break;
    case "another":
      openCatalog(byUid.get(uid).layer.label);
      return;
  }
  update();
});
$("#workspace-list").addEventListener("input", (event) => {
  if (!event.target.matches("input[type=range]")) return;
  const item = state.items.find((i) => i.uid === event.target.closest("[data-uid]").dataset.uid);
  item.opacity = Number(event.target.value);
  event.target.nextElementSibling.textContent = `${item.opacity}%`;
  persist();
  for (const side of Object.values(sides)) void reconcile(side);
});
$("#workspace-list").addEventListener("dragstart", (event) => {
  dragged = event.target.closest("[data-uid]")?.dataset.uid;
  if (!dragged) return;
  event.dataTransfer.setData("text/plain", dragged);
  event.dataTransfer.effectAllowed = "move";
  event.target.closest(".layer-card").classList.add("is-dragging");
});
$("#workspace-list").addEventListener("dragover", (event) => {
  const card = event.target.closest("[data-uid]");
  if (card && dragged) {
    event.preventDefault();
    document.querySelectorAll(".is-drop-target").forEach((n) => n.classList.remove("is-drop-target"));
    card.classList.add("is-drop-target");
  }
});
$("#workspace-list").addEventListener("drop", (event) => {
  event.preventDefault();
  const target = event.target.closest("[data-uid]")?.dataset.uid;
  if (target && dragged) {
    const from = state.items.findIndex((i) => i.uid === dragged),
      to = state.items.findIndex((i) => i.uid === target);
    if (from >= 0 && to >= 0) move(dragged, to - from);
  }
  dragged = null;
});
$("#workspace-list").addEventListener("dragend", () => {
  dragged = null;
  document
    .querySelectorAll(".is-dragging,.is-drop-target")
    .forEach((n) => n.classList.remove("is-dragging", "is-drop-target"));
});
$(".view-switch").addEventListener("change", (event) => {
  const mode = event.target.closest("[data-mode]")?.dataset.mode;
  if (!mode) return;
  if (mode === "overlay" && state.mode !== "overlay" && state.selected) {
    state.items.forEach((i) => (i.visible = i.uid === state.selected));
  }
  if (mode === "compare" && state.mode === "single" && state.selected) state.left = state.selected;
  state.mode = mode;
  update();
  for (const side of Object.values(sides))
    if (side.ready) void side.manager.ask("map", { method: "resize" }).catch(() => {});
});
$("#mode-explanation").addEventListener("click", (event) => {
  if (event.target.closest("#link-views")) {
    linked = !linked;
    lastViews = null;
    renderMapChrome();
  }
});
$("#map-grid").addEventListener("change", (event) => {
  const side = event.target.dataset.side;
  if (side) {
    const other = side === "left" ? "right" : "left";
    const previous = state[side];
    state[side] = event.target.value;
    if (state[other] === state[side] && state.items.length > 1) state[other] = previous;
    update();
  }
});
$("#clear-workspace").addEventListener("click", () => {
  state.items = [];
  setStep("choose");
  announce("Workspace cleared. Choose a layer to continue.");
});

function renderSteps() {
  $("#main").classList.toggle("is-choosing", step === "choose");
  document.body.classList.toggle("is-choosing-step", step === "choose");
  $("#catalog-panel").hidden = step !== "choose";
  $(".workspace-sidebar").hidden = step === "choose";
  $(".workspace-stage").hidden = step === "choose";
  document.querySelectorAll("[data-step]").forEach((button) => {
    if (button.dataset.step === step) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    button.disabled = button.dataset.step === "explore" && !state.items.length;
  });
  $(".step-selection-count").textContent = state.items.length ? `(${state.items.length})` : "";
}
function setStep(next) {
  if (next === "explore" && !state.items.length) return;
  step = next;
  update();
  if (step === "choose") $("#catalog-title").focus();
  else $("#main").focus();
  for (const side of Object.values(sides))
    if (side.ready) void side.manager.ask("map", { method: "resize" }).catch(() => {});
}
document
  .querySelectorAll("[data-step]")
  .forEach((button) => button.addEventListener("click", () => setStep(button.dataset.step)));
$("#catalog-done").addEventListener("click", () => setStep("explore"));
function openCatalog(query = "") {
  search = query;
  filter = "all";
  $("#catalog-search").value = query;
  setStep("choose");
  $("#catalog-search").focus();
}
$("#add-layers").addEventListener("click", () => openCatalog());
document
  .querySelectorAll("[data-close]")
  .forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll(".workspace-dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  }),
);
$("#catalog-search").addEventListener("input", (event) => {
  search = event.target.value;
  renderCatalog();
});
$("#catalog-filters").addEventListener("click", (event) => {
  const value = event.target.closest("[data-filter]")?.dataset.filter;
  if (value) {
    filter = value;
    renderCatalog();
  }
});
const featuredLayers = [
  {
    uid: "early-warning-coverage:0",
    title: "Early warning coverage",
    image: "early-warning.jpg",
    description: "Explore national coverage of early warning systems.",
  },
  {
    uid: "change-fiscal-gap:0",
    title: "Fiscal resilience",
    image: "fiscal-gap.jpg",
    description: "Explore fiscal resilience with financial support after a disaster.",
  },
  {
    uid: "aal-to-gdp-2025:0",
    title: "Earthquake losses",
    image: "earthquake-loss.jpg",
    width: 1148,
    height: 782,
    description: "Explore average annual losses as a share of GDP.",
  },
].filter((item) => byUid.has(item.uid));
function featuredLayersHtml() {
  return `<section class="catalog-starters" aria-labelledby="catalog-starters-title"><h2 id="catalog-starters-title">Suggested starting points</h2><div class="catalog-starter-grid">${featuredLayers
    .map((item) => {
      const entry = byUid.get(item.uid);
      const added = state.items.some((selected) => selected.uid === item.uid);
      return `<article class="featured-layer"><img src="${import.meta.env.BASE_URL}preview-thumbnails/${item.image}" alt="" width="${item.width ?? 910}" height="${item.height ?? 624}" loading="eager" decoding="async" /><div class="featured-layer-content"><span class="eyebrow">${escape(entry.tab.label)}</span><h3>${escape(item.title)}</h3><p>${escape(item.description)}</p><button class="mg-button mg-button-primary mg-button-outline variant-button" data-add="${escape(item.uid)}" aria-label="${added ? "Added" : "Add layer"}: ${escape(item.title)}" ${added ? "disabled" : ""}>${icon(added ? "layers" : "plus")}${added ? "Added" : "Add layer"}</button></div></article>`;
    })
    .join(
      "",
    )}</div><p class="catalog-thumbnail-credit">Map previews from <a href="https://app.mapx.org/" target="_blank" rel="noopener">UNEP/GRID MapX</a> and its data providers. Open a layer to read its legend and source.</p></section><h2 class="catalog-browse-heading">Browse all datasets</h2>`;
}
function renderCatalog() {
  $("#catalog-title").textContent = state.items.length
    ? "Choose layers for your map"
    : "Choose your first layer";
  $("#catalog-description").textContent = !state.items.length
    ? "Start with a suggested map or browse the catalogue. Choose the layers you want to explore."
    : "Add several variants of the same dataset to your workspace.";
  const done = $("#catalog-done");
  done.textContent = `Explore map${state.items.length ? ` (${state.items.length})` : ""}`;
  done.disabled = state.items.length === 0;
  $("#catalog-filters").innerHTML = [{ id: "all", label: "All layers" }, ...TABS]
    .map(
      (tab) =>
        `<button class="mg-button mg-button-primary mg-button-outline catalog-filter" data-filter="${tab.id}" aria-pressed="${filter === tab.id}">${escape(tab.label)}</button>`,
    )
    .join("");
  const query = search.trim().toLowerCase();
  const results = catalog.filter(
    ({ tab, layer }) =>
      (filter === "all" || filter === tab.id) &&
      [layer.label, layer.desc, tab.label, ...(layer.sources ?? []).map((s) => s.label)]
        .join(" ")
        .toLowerCase()
        .includes(query),
  );
  $("#catalog-result-count").textContent = `${results.length} dataset${results.length === 1 ? "" : "s"}`;
  $("#catalog-selection-count").textContent =
    `${state.items.length} variant${state.items.length === 1 ? "" : "s"} in your workspace`;
  const scroll = $("#catalog-results").scrollTop;
  $("#catalog-results").innerHTML =
    (!query && filter === "all" ? featuredLayersHtml() : "") +
    (results
      .map(
        ({ tab, layer }) =>
          `<article class="catalog-item"><div class="catalog-item-top"><div><span class="eyebrow">${escape(tab.label)}${layer.r2rCategory ? ` / ${escape(layer.r2rCategory)}` : ""}</span><h3>${escape(datasetLabel(layer.label))}</h3></div></div><p>${escape(layer.desc)}</p><div class="variant-list">${variants
            .filter((v) => v.layer === layer)
            .map((v) => {
              const added = state.items.some((i) => i.uid === v.uid);
              return `<button class="mg-button mg-button-primary mg-button-outline variant-button" data-add="${escape(v.uid)}" ${added ? "disabled" : ""}>${added ? icon("layers") : icon("plus")} ${escape(v.variant)}${added ? " (added)" : ""}</button>`;
            })
            .join("")}</div></article>`,
      )
      .join("") || emptyState("No matching layers", "Try another search or category."));
  $("#catalog-results").scrollTop = scroll;
}
$("#catalog-results").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  const uid = button.dataset.add;
  if (state.items.some((i) => i.uid === uid)) return;
  state.items.unshift({ uid, opacity: 100, visible: state.items.length === 0 });
  if (state.items.length === 1) state.selected = uid;
  update();
  announce(`${byUid.get(uid).layer.label}, ${byUid.get(uid).variant}, added to workspace.`);
  $("#catalog-done").focus();
});

const downloads = createDownloads({
  isViewWanted: (id) => visibleFor("left").some((i) => byUid.get(i.uid).id === id),
  isViewLoaded: (id) => loaded.has(id),
  onViewLoaded: (id) => loaded.add(id),
  onTemporaryView: (active) => {
    $("#map-left").style.visibility = active ? "hidden" : "";
  },
  isReady: () => sides.left.ready,
  onReadyChange: () => () => {},
  getSdk: () => sides.left.manager,
  viewerUrl: () => new URL("./", location.href).href,
});
$("#review-downloads").addEventListener("click", () => {
  renderDownloads();
  $("#download-dialog").showModal();
});
function renderDownloads() {
  $("#download-results").innerHTML = state.items
    .map((item) => {
      const v = byUid.get(item.uid),
        available = getViewDownloads(v.layer, v.source);
      const formats = available.files
        .map(
          (file) =>
            `<a class="layer-downloads__link" href="${escape(file.url)}" download="${escape(file.filename)}" data-bytes="${file.bytes}" ${file.large ? "data-large" : ""} target="_blank" rel="noopener">${escape(file.format)} · ${escape(formatBytes(file.bytes))} ${icon("external-link")}</a>`,
        )
        .join(" ");
      return `<article class="download-row"><div><h3>${escape(datasetLabel(v.layer.label))}</h3><p>${escape(v.variant)}</p><small>${isVisible(item.uid) ? "Selected for display" : "Hidden on map · available to download"}</small></div><div>${available.csv ? `<button class="mg-button mg-button-primary mg-button-outline variant-button" data-csv="${escape(v.id)}" ${!sides.left.ready ? "disabled" : ""}>${icon("download")}Download CSV</button>` : formats || "<small>No reviewed download available</small>"}</div></article>`;
    })
    .join("");
}
$("#download-results").addEventListener("click", (event) => {
  const large = event.target.closest("a[data-large]");
  if (large) {
    event.preventDefault();
    $("#download-dialog").close();
    void downloads.confirmLargeFile(large);
    return;
  }
  const button = event.target.closest("[data-csv]");
  if (!button) return;
  // Close the review dialog so the existing accessible progress dialog owns focus.
  $("#download-dialog").close();
  downloads.requestCsv(button.dataset.csv, { opener: $("#review-downloads") });
});

function mapStatus(message, error = false) {
  $("#map-status").innerHTML =
    `<span class="status-dot" style="background:${error ? "#ab5757" : "#37816c"}"></span>${escape(message)}`;
}
async function startSide(name) {
  const side = sides[name];
  if (side.manager || side.starting) return;
  side.starting = true;
  try {
    sdkLoaded ??= loadMapXSdk();
    await sdkLoaded;
    side.manager = new window.mxsdk.Manager({
      container: $(`#map-${name}`),
      url: `${getMapXBaseUrl()}/?project=${PRIMARY_PROJECT}`,
      iframeTitle: name === "left" ? "Main interactive map" : "Comparison interactive map",
      params: { closePanels: true, language: "en", theme: "color_light" },
      style: { width: "100%", height: "100%", border: "none" },
    });
    const readyTimeout = setTimeout(() => {
      if (!side.ready) mapStatus("Map is taking longer to connect. Reload to retry.", true);
    }, 40000);
    side.manager.on("ready", async () => {
      clearTimeout(readyTimeout);
      try {
        await askWithTimeout(side.manager, "set_immersive_mode", { enable: true });
        await askWithTimeout(side.manager, "set_features_click_sdk_only", { enable: true });
        side.ready = true;
        if (name === "right" && sides.left.ready) {
          const view = await createCamera(() => sides.left.manager).getView();
          await createCamera(() => side.manager).setView(view);
        } else await createCamera(() => side.manager).setView({ center: { lng: 12, lat: 18 }, zoom: 1.5 });
        await reconcile(side);
        renderWorkspace();
        renderDownloads();
      } catch (error) {
        console.error("Preview map setup:", error);
        side.error = error;
        mapStatus("Map setup failed. Reload to retry.", true);
      }
    });
  } catch (error) {
    console.error("Preview connection:", error);
    mapStatus("Map unavailable. Layer catalogue still works.", true);
  }
}
async function reconcile(side) {
  if (!side.ready || step !== "explore") return;
  side.dirty = true;
  if (side.running) return;
  side.running = true;
  try {
    do {
      side.dirty = false;
      const target = visibleFor(side.name).map((item) => ({ ...item, entry: byUid.get(item.uid) }));
      mapStatus("Updating map…");
      for (const id of [...side.applied])
        if (!target.some((item) => item.entry.id === id)) {
          await askWithTimeout(side.manager, "view_remove", { idView: id });
          side.applied = side.applied.filter((v) => v !== id);
        }
      for (const item of [...target].reverse()) {
        if (!side.applied.includes(item.entry.id)) {
          await askWithTimeout(side.manager, "view_add", { idView: item.entry.id, zoomToView: false }, 20000);
          side.applied.push(item.entry.id);
          if (side.name === "left") loaded.add(item.entry.id);
        }
        await askWithTimeout(side.manager, "set_view_layer_transparency", {
          idView: item.entry.id,
          value: 100 - item.opacity,
        });
      }
      if (target.length > 1)
        await askWithTimeout(side.manager, "set_views_layer_order", {
          order: target.map((i) => i.entry.id),
          orig: "layer-workspace-preview",
        });
      side.error = null;
      if (!side.dirty) void renderLegend(side, target[0]?.entry);
    } while (side.dirty);
    mapStatus(state.mode === "compare" && !sides.right.ready ? "Loading comparison map…" : "Live map");
  } catch (error) {
    console.error("Preview layer update:", error);
    side.error = error;
    mapStatus("Layer update failed. Change a layer to retry.", true);
  } finally {
    side.running = false;
    if (!document.activeElement?.matches(".opacity-control input")) renderWorkspace();
  }
}
const legendCache = new Map();
async function renderLegend(side, entry) {
  const host = $(`#${side.name}-legend`);
  if (!entry) {
    host.replaceChildren();
    side.legendId = null;
    return;
  }
  side.legendId = entry.id;
  host.innerHTML = `<h3>${escape(datasetLabel(entry.layer.label))}</h3><span class="muted">Loading legend…</span>`;
  try {
    if (!legendCache.has(entry.id))
      legendCache.set(
        entry.id,
        readPreviewLegend(side.manager, entry).catch((error) => {
          legendCache.delete(entry.id);
          throw error;
        }),
      );
    const legend = await legendCache.get(entry.id);
    if (side.legendId !== entry.id) return;
    host.innerHTML = `<h3>${state.mode === "overlay" ? "Top layer · " : ""}${escape(legend?.title || entry.layer.label)}</h3>`;
    if (legend?.entries)
      for (const item of legend.entries) {
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
    else if (legend?.image) {
      const img = document.createElement("img");
      img.alt = `Legend for ${entry.layer.label}`;
      img.src = legend.image.startsWith("data:") ? legend.image : `data:image/png;base64,${legend.image}`;
      img.style.maxWidth = "100%";
      host.append(img);
    } else
      host.insertAdjacentHTML("beforeend", '<span class="muted">Legend unavailable for this layer.</span>');
  } catch {
    if (side.legendId === entry.id)
      host.innerHTML = '<span class="muted">Legend unavailable. Try switching layers.</span>';
  }
}
let lastViews = null;
let syncing = false;
const signature = (view) =>
  `${view.center.lng.toFixed(4)},${view.center.lat.toFixed(4)},${view.zoom.toFixed(3)}`;
setInterval(async () => {
  if (
    state.mode !== "compare" ||
    !linked ||
    syncing ||
    document.hidden ||
    !sides.left.ready ||
    !sides.right.ready
  )
    return;
  syncing = true;
  try {
    const cameras = [createCamera(() => sides.left.manager), createCamera(() => sides.right.manager)];
    const views = await Promise.all(cameras.map((camera) => camera.getView()));
    const next = views.map(signature);
    const source = !lastViews || next[0] !== lastViews[0] ? 0 : next[1] !== lastViews[1] ? 1 : null;
    if (source !== null && next[0] !== next[1]) {
      await cameras[1 - source].setView(views[source]);
      next[1 - source] = next[source];
    }
    lastViews = next;
  } catch {
    /* A failed camera read must not interrupt layer work. */
  } finally {
    syncing = false;
  }
}, 1200);
const narrowLayout = window.matchMedia("(max-width: 720px)");
function positionDisplayControls() {
  const controls = $(".display-controls");
  if (narrowLayout.matches) $(".workspace-stage").prepend(controls);
  else $(".sidebar-intro").after(controls);
}
positionDisplayControls();
narrowLayout.addEventListener("change", positionDisplayControls);
update();
if (step === "choose") $("#catalog-title").focus();
