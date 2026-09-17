/**
 * One layer row, rendered from its layers-store record.
 *
 * The same component draws a layer in its home tab (`variant: "full"`, an
 * accordion with the source widget or external controls) and in other tabs'
 * cross-tab sections (`variant: "compact"`: label, type tag, switch, and
 * description, opacity slider and legend while the layer is on). Both kinds
 * call the layer controller and render from the same record, so they cannot
 * drift apart (the cause of #10 and #12). Part of
 * unisdr/undrr-risk-resilience-maps#14.
 *
 * `update(record)` is idempotent: it compares the record with the last one it
 * rendered and with what the row already shows, so calling it again with the
 * same record changes nothing and requests nothing. The opacity slider and
 * legend (SDK requests) are rendered only while `isVisible()` is true, i.e. the
 * row's tab is shown; once rendered they are kept while the tab is hidden and
 * re-rendered only when a view arrives on the map for the layer. Clearing is
 * immediate for every row.
 *
 * The row queries only its own elements, adds no ids and registers its
 * listeners, including those of the source widget and external controls it
 * builds, with one AbortController, so `destroy()` removes them all. Async
 * work already started (a pick waiting on MapX) still settles; its callbacks
 * check `destroyed`.
 */
import { buildWidget, isCompound } from "./widgets/index.js";
import { addLegend, addOpacitySlider } from "./layer-controls.js";
import { buildExternalControls } from "./external-controls.js";
import { isLayerAvailable } from "../config/layers/status.js";
import { getExternalLayerDefinition, getExternalLayerRuntime, isExternalLayer } from "../external/index.js";
import { clampSourceIdx, isBusyStatus, settingsMatch } from "../services/layer-controller.js";

// MapX view types: cc = custom coded (live), rt = raster tile, vt = vector tile
const TYPE_LABELS = { cc: "live", rt: "raster", vt: "vector" };
const GEOMETRY_LABELS = { point: "points", polygon: "polygons", line: "lines" };

/** What a row shows before its first record: off, idle. */
const OFF = Object.freeze({
  desired: false,
  sourceIdx: 0,
  settings: null,
  applied: false,
  appliedSourceIdx: 0,
  appliedSettings: null,
  viewId: null,
  status: "idle",
  error: null,
});

function layerBadgeLabel(layer) {
  return (layer.geometry && GEOMETRY_LABELS[layer.geometry]) || TYPE_LABELS[layer.type] || layer.type;
}

/** Build the type/geometry badge shown next to a layer label. */
function buildLayerTypeTag(layer) {
  const tag = document.createElement("span");
  tag.className = "mg-tag layer-type-tag";
  if (layer.type === "rt") tag.classList.add("mg-tag--accent");
  if (layer.type === "vt") tag.classList.add("mg-tag--secondary");
  tag.textContent = layerBadgeLabel(layer);
  return tag;
}

/**
 * Show a switch's state. `aria-checked` follows intent (`active`). While a
 * MapX call is in flight (`busy`) the switch is `aria-busy` and its label says
 * what is happening, since the layer is not on (or off) the map yet.
 */
function setLayerToggleState(layer, button, active, busy = false) {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-checked", String(active));
  button.setAttribute("aria-busy", String(busy));
  const label = busy
    ? `${active ? "Loading" : "Turning off"} ${layer.label}…`
    : `${active ? "Turn off" : "Turn on"} ${layer.label}`;
  button.setAttribute("aria-label", label);
  button.title = active ? "Turn layer off" : "Turn layer on";
}

/**
 * A visually hidden, polite live region for a layer row. Rows own their
 * announcer (no ids, no global region), so the one in the visible row speaks.
 */
function buildAnnouncer() {
  const announcer = document.createElement("p");
  announcer.className = "layer-announcer mg-u-sr-only";
  announcer.setAttribute("aria-live", "polite");
  return announcer;
}

/** What to announce when a MapX call for a layer failed, from what MapX now shows. */
function failureMessage(layer, record) {
  return record.applied
    ? `Could not change ${layer.label}. It is still on as before.`
    : `Could not load ${layer.label}. It is off.`;
}

/** The initiative sentence followed by the description. */
export function layerDescriptionText(layer, description) {
  const initiative = layer.initiative?.trim();
  const initiativeSentence = initiative ? (/[.!?]$/.test(initiative) ? initiative : `${initiative}.`) : "";
  return [initiativeSentence, description?.trim()].filter(Boolean).join(" ");
}

// Write only what differs, so rendering the same record twice mutates nothing.
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function setHidden(element, hidden) {
  if (element.hidden !== hidden) element.hidden = hidden;
}

function setClass(element, className, on) {
  if (element.classList.contains(className) !== on) element.classList.toggle(className, on);
}

function buildSlot(className) {
  const slot = document.createElement("div");
  slot.className = className;
  return slot;
}

/**
 * The layer config addLegend needs for the view MapX now shows: a compound
 * layer's shown source merged onto the layer, or an external layer's runtime
 * view and legend.
 */
function legendLayerFor(layer, record) {
  if (isExternalLayer(layer)) {
    return { ...layer, id: record.viewId, legend: getExternalLayerRuntime(layer)?.legend };
  }
  if (isCompound(layer)) {
    const source = layer.sources[clampSourceIdx(layer, record.appliedSourceIdx)];
    return { ...layer, ...source, label: layer.label };
  }
  return layer;
}

/**
 * @typedef {object} LayerRow
 * @property {HTMLElement} element - the row's root element
 * @property {(record: object) => void} update - render the layer's record (idempotent)
 * @property {() => boolean} hasPendingSelection - a source or variant pick made
 *   through this row's controls is still settling
 * @property {() => void} destroy - remove the row's listeners (its source widget's and
 *   external controls' too); later updates do nothing
 */

/**
 * Create a layer row.
 * @param {object} layer - layer config
 * @param {object} options
 * @param {"full"|"compact"} [options.variant] - home-tab accordion or cross-tab row
 * @param {ReturnType<import("../state/layers-store.js").createLayersStore>|null} options.store
 * @param {ReturnType<import("../services/layer-controller.js").createLayerController>|null} options.controller
 * @param {() => boolean} [options.isReady] - whether the map accepts layer changes yet
 * @param {() => boolean} [options.isVisible] - whether the row's tab is shown
 * @param {(tabId: string) => void} [options.onNavigate] - open another page (full row's citation link)
 * @param {() => boolean} [options.selectionPending] - a pick made through another
 *   row's controls for this layer is settling (its controls announce failures)
 * @returns {LayerRow}
 */
export function createLayerRow(
  layer,
  {
    variant = "full",
    store,
    controller,
    isReady = () => true,
    isVisible = () => true,
    onNavigate = () => {},
    selectionPending = () => false,
  },
) {
  const full = variant === "full";
  const published = isLayerAvailable(layer);
  const external = isExternalLayer(layer);
  const listeners = new AbortController();
  const { signal } = listeners;
  let destroyed = false;

  // Last record rendered, and what the switch shows.
  let last = null;
  let shownDesired = false;
  let shownBusy = false;
  // The view whose slider and legend the row should show: the record it
  // arrived with, its id and the legend input. `rendered` is the arrival
  // record whose controls are in the slots (null when the slots are empty).
  let details = null;
  let rendered = null;
  // Compact rows: an external layer's loading or error message.
  let status = null;
  // Full rows: whether the accordion opens when the layer comes on (not when
  // the header turned it on, since the header manages expansion itself), and
  // what the source widget or external controls show.
  let expanded = false;
  let expandOnApply = true;
  let shownSourceIdx = null;
  let shownSettings = null;
  let pendingSelections = 0;

  // ── DOM ────────────────────────────────────────────────────────────────
  const element = document.createElement("div");
  element.className = full ? "layer-item" : "cross-tab-item";

  const header = document.createElement("div");
  header.className = full ? "layer-header" : "cross-tab-row";

  let arrow = null;
  if (full) {
    arrow = document.createElement("span");
    arrow.className = "layer-arrow";
    arrow.textContent = "▶"; // ▶
    arrow.setAttribute("aria-hidden", "true");
    header.appendChild(arrow);
  }

  const label = document.createElement("span");
  label.className = full ? "layer-label" : "cross-tab-label";
  label.textContent = layer.label;
  header.appendChild(label);
  header.appendChild(buildLayerTypeTag(layer));

  let eyeBtn = null;
  if (published) {
    eyeBtn = document.createElement("button");
    eyeBtn.className = "layer-eye";
    eyeBtn.setAttribute("role", "switch");
    setLayerToggleState(layer, eyeBtn, false);
    if (!full) eyeBtn.title += " — switch to tab for sub-source controls";
    eyeBtn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        toggleLayer({ expand: true });
      },
      { signal },
    );
    header.appendChild(eyeBtn);
  }
  element.appendChild(header);

  // Outside the header (a role="button" has presentational children) and the
  // body (hidden while collapsed), so it can speak while the row is collapsed.
  const announcer = published ? buildAnnouncer() : null;
  if (announcer) element.appendChild(announcer);

  const body = document.createElement("div");
  body.className = full ? "layer-body" : "cross-tab-body";
  if (full) body.style.display = "none";
  else body.hidden = true;

  let desc = null;
  if (layer.initiative || layer.desc) {
    desc = document.createElement("p");
    desc.className = "layer-desc mg-form-help";
    desc.textContent = layerDescriptionText(layer, layer.desc);
    body.appendChild(desc);
  }

  let widgetSlot = null;
  let statusEl = null;
  if (full) {
    body.appendChild(buildMetaLinks());
    // Compound layers render the source switcher here, external layers their controls.
    widgetSlot = buildSlot("layer-widget-slot");
    body.appendChild(widgetSlot);
  } else {
    statusEl = document.createElement("p");
    // Visual only; failures are announced by the row's announcer.
    statusEl.className = "external-layer-status";
    statusEl.hidden = true;
    body.appendChild(statusEl);
  }
  const sliderSlot = buildSlot("layer-slider-slot");
  body.appendChild(sliderSlot);
  const legendSlot = buildSlot("layer-legend-slot");
  body.appendChild(legendSlot);
  element.appendChild(body);

  if (full) {
    // All layers support expand/collapse so reviewers can read descriptions
    header.tabIndex = 0;
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", "false");
    header.addEventListener("click", toggleAccordion, { signal });
    header.addEventListener(
      "keydown",
      (e) => {
        // Only keys on the header itself. Enter/Space on the switch inside it
        // must keep their default, which activates the switch.
        if (e.target !== header) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleAccordion();
        }
      },
      { signal },
    );
  }

  function buildMetaLinks() {
    const metadata = document.createElement("p");
    metadata.className = "layer-meta-links";
    if (layer.sourceUrl && layer.source && layer.source !== "Source to be confirmed.") {
      const sourceLink = document.createElement("a");
      sourceLink.href = layer.sourceUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener";
      sourceLink.textContent = "Source";
      metadata.appendChild(sourceLink);
      metadata.append(" · ");
    }
    const detailsLink = document.createElement("a");
    detailsLink.href = "#sources";
    detailsLink.textContent = "Citation and methodology details";
    // Navigate like the nav links do; the href stays for open-in-new-tab.
    detailsLink.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        onNavigate("sources");
      },
      { signal },
    );
    metadata.appendChild(detailsLink);
    return metadata;
  }

  // ── Intent ─────────────────────────────────────────────────────────────

  /**
   * Ask for the opposite of the layer's current intent. Toggling intent rather
   * than what MapX shows makes a second click while loading cancel the first;
   * the controller applies the latest intent once the call in flight settles.
   */
  function toggleLayer({ expand }) {
    if (destroyed || !store || !controller) return;
    // Guard: SDK must be ready before attempting map operations
    if (!isReady()) {
      console.warn(`${layer.label} cannot be toggled yet — map is still loading.`);
      return;
    }
    const on = !store.get(layer.key).desired;
    if (on && full) expandOnApply = expand;
    return controller.setOn(layer.key, on);
  }

  function setExpanded(value) {
    expanded = value;
    body.style.display = value ? "block" : "none";
    arrow.textContent = value ? "▼" : "▶"; // ▼ / ▶
    header.setAttribute("aria-expanded", String(value));
  }

  function toggleAccordion() {
    const open = expanded;
    setExpanded(!open);
    // Expanding a published layer is an activation intent. Collapsing only
    // hides its controls; the layer remains on until its switch is turned off.
    // The header manages expansion itself, so a slow load must not reopen it.
    if (!open && eyeBtn && store && !store.get(layer.key).desired) {
      toggleLayer({ expand: false });
    }
  }

  // ── Rendering from the record ──────────────────────────────────────────

  function update(next) {
    if (destroyed) return;
    const prev = last ?? OFF;
    last = next;
    const busy = isBusyStatus(next.status);
    const wasBusy = isBusyStatus(prev.status);

    if (eyeBtn && (next.desired !== shownDesired || busy !== shownBusy)) {
      setLayerToggleState(layer, eyeBtn, next.desired, busy);
      shownDesired = next.desired;
      shownBusy = busy;
    }
    // Every new activation expands on apply unless the header starts it.
    if (!next.desired && prev.desired) expandOnApply = true;

    if (announcer) {
      // Failures are announced in the row for every kind of layer (a failed
      // turn-on otherwise only flips the switch back). A new call clears the
      // message, so the same failure is announced again if it happens again.
      if (busy && !wasBusy) setText(announcer, "");
      // External controls announce the failures of changes made through them.
      const announcedByControls = external && (pendingSelections > 0 || selectionPending());
      if (
        next.status === "error" &&
        (prev.status !== "error" || next.error !== prev.error) &&
        !announcedByControls
      ) {
        announcer.textContent = failureMessage(layer, next);
      }
    }

    if (external && next.status === "loading" && prev.status !== "loading" && !next.applied) {
      showExternalStatus(`Loading ${layer.label}…`, false);
    }

    if (next.applied && !prev.applied) turnedOn(next);
    else if (!next.applied && prev.applied) turnedOff();
    else if (next.applied && next.viewId && next.viewId !== prev.viewId) viewArrived(next);

    const settled = !busy && wasBusy;
    if (settled && next.applied && full) syncSelectors(next);
    if (settled && !next.applied && external) {
      if (next.status === "error")
        showExternalStatus(`Could not load ${layer.label}. Please try again.`, true);
      else clearControls();
    }

    renderDetails();
  }

  /** The layer came on: reveal the row and build its controls. */
  function turnedOn(record) {
    if (full) {
      element.classList.add("layer-active");
      // Direct switch activation reveals controls. Header activation already
      // manages expansion and must not reopen after a slow MapX response.
      if (expandOnApply) setExpanded(true);
      widgetSlot.innerHTML = "";
      if (isCompound(layer) && layer.widget) renderSourceWidget(record.sourceIdx);
      if (external) renderExternalControls(record.appliedSettings);
    } else {
      // Open the cross-tab section containing this row.
      const section = element.closest("details.cross-tab-section");
      if (section) section.open = true;
    }
    if (record.viewId) viewArrived(record);
  }

  /** A view arrived on the map for the layer: show its description, slider and legend. */
  function viewArrived(record) {
    const legendLayer = legendLayerFor(layer, record);
    details = { arrival: record, viewId: record.viewId, legendLayer };
    status = null;
    // Show the shown source's description instead of the parent's.
    if (desc && isCompound(layer)) setText(desc, layerDescriptionText(layer, legendLayer.desc || layer.desc));
  }

  /** The layer went off: clear its controls and return the row to its compact state. */
  function turnedOff() {
    clearControls();
    if (full) {
      element.classList.remove("layer-active");
      // Turning a layer off ends the interaction and returns the row to its
      // compact state. Collapsing alone still leaves an active layer on.
      setExpanded(false);
    }
  }

  function clearControls() {
    details = null;
    status = null;
    if (full) {
      widgetSlot.innerHTML = "";
      shownSourceIdx = null;
      shownSettings = null;
    }
  }

  /** An external layer's loading or load-error message (visual only). */
  function showExternalStatus(text, isError) {
    if (!full) {
      status = { text, isError };
      return;
    }
    if (!isError) {
      if (!expandOnApply) return;
      setExpanded(true);
      widgetSlot.innerHTML = "";
      const statusP = document.createElement("p");
      // Visual only: the switch is aria-busy while loading, and a failure is
      // announced by the row's announcer.
      statusP.className = "external-layer-status";
      statusP.textContent = text;
      widgetSlot.appendChild(statusP);
      return;
    }
    const statusP = widgetSlot.querySelector(".external-layer-status");
    if (statusP) {
      statusP.classList.add("is-error");
      statusP.textContent = text;
    }
  }

  /**
   * Bring the slots in line with `details`. Clearing happens at once; the
   * slider and legend (SDK requests) are only built while the row is visible,
   * and only once per view arrival.
   */
  function renderDetails() {
    const wanted = details?.arrival ?? null;
    if (rendered && rendered !== wanted) {
      sliderSlot.innerHTML = "";
      legendSlot.innerHTML = "";
      rendered = null;
    }

    if (!full) {
      const hasContent = Boolean(details || status);
      if (!hasContent) {
        setHidden(body, true);
        setHidden(statusEl, true);
        setText(statusEl, "");
        setClass(statusEl, "is-error", false);
      } else if (isVisible()) {
        if (desc) setText(desc, layerDescriptionText(layer, details?.legendLayer?.desc || layer.desc));
        setHidden(statusEl, !status);
        setText(statusEl, status?.text ?? "");
        setClass(statusEl, "is-error", Boolean(status?.isError));
        setHidden(body, false);
      }
    }

    if (wanted && !rendered && isVisible()) {
      rendered = wanted;
      addOpacitySlider(details.viewId, sliderSlot);
      addLegend(details.legendLayer, legendSlot);
    }
  }

  // ── Full rows: source widget and external controls ────────────────────

  /**
   * Build the source switcher for a compound layer. A pick resolves to the
   * source the layer ends up on once every pick in flight has settled, so the
   * widget shows the last pick, or the source kept after a failure.
   */
  function renderSourceWidget(sourceIdx) {
    widgetSlot.innerHTML = "";
    shownSourceIdx = sourceIdx;
    const widgetEl = buildWidget(
      layer.widget,
      layer.sources,
      sourceIdx,
      async (newIdx) => {
        // Destroyed: keep showing the current source.
        if (destroyed || !controller) return shownSourceIdx;
        shownSourceIdx = newIdx;
        pendingSelections++;
        try {
          const record = await controller.setSource(layer.key, newIdx);
          shownSourceIdx = record.sourceIdx;
          return record.sourceIdx;
        } finally {
          pendingSelections--;
        }
      },
      { signal },
    );
    if (widgetEl) widgetSlot.appendChild(widgetEl);
  }

  /** Build an external layer's provider controls (e.g. crop, scenario). */
  function renderExternalControls(settings) {
    widgetSlot.innerHTML = "";
    shownSettings = settings;
    const controls = buildExternalControls(
      getExternalLayerDefinition(layer),
      settings,
      async (wanted) => {
        // Destroyed: keep showing the current settings.
        if (destroyed || !controller) return { settings: shownSettings };
        shownSettings = wanted;
        pendingSelections++;
        try {
          const record = await controller.setSettings(layer.key, wanted);
          shownSettings = record.appliedSettings;
          // The controls show their own error and revert to the settings on the map.
          if (record.status === "error" && !settingsMatch(record.appliedSettings, wanted)) {
            throw record.error ?? new Error(`Could not update ${layer.label}`);
          }
          return { settings: record.appliedSettings };
        } finally {
          pendingSelections--;
        }
      },
      { signal },
    );
    widgetSlot.appendChild(controls);
  }

  /**
   * After a change settles, rebuild the source widget or external controls if
   * they show something else than the record, e.g. after back/forward. Changes
   * made through the controls themselves correct their own display.
   */
  function syncSelectors(record) {
    if (pendingSelections > 0) return;
    if (isCompound(layer) && layer.widget && shownSourceIdx !== record.sourceIdx) {
      renderSourceWidget(record.sourceIdx);
    } else if (external && !settingsMatch(shownSettings, record.appliedSettings)) {
      renderExternalControls(record.appliedSettings);
    }
  }

  return {
    element,
    update,
    hasPendingSelection: () => pendingSelections > 0,
    destroy() {
      destroyed = true;
      listeners.abort();
    },
  };
}
