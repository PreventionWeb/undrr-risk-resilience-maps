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
import { offRecord } from "../state/layers-store.js";

// MapX view types: cc = custom coded (live), rt = raster tile, vt = vector tile
const TYPE_LABELS = { cc: "live", rt: "raster", vt: "vector" };
const GEOMETRY_LABELS = { point: "points", polygon: "polygons", line: "lines" };

function layerBadgeLabel(layer) {
  return (layer.geometry && GEOMETRY_LABELS[layer.geometry]) || TYPE_LABELS[layer.type] || layer.type;
}

/**
 * Build the type/geometry badge shown next to a layer label. Mangrove's subtle
 * tag variant: the type is carried by the word, not by a colour, so the row's
 * only coloured control is its switch.
 *
 * An unpublished row (shown by "Show disabled") says so in the same tag
 * instead of naming its type. Its greying is done with colours that keep the
 * text readable rather than with an opacity on the row, so the wording is what
 * says why the row is greyed out — along with it having no switch.
 */
function buildLayerTypeTag(layer, published) {
  const tag = document.createElement("span");
  tag.className = "mg-tag mg-tag--subtle layer-type-tag";
  tag.textContent = published ? layerBadgeLabel(layer) : "not published";
  return tag;
}

/**
 * Build a layer's on/off control: Mangrove's `.mg-switch` (a native
 * `input[type=checkbox][role=switch]` with a track and thumb the stylesheet
 * animates). The label wraps the control so the whole track is one hit target;
 * the layer's name is the switch's accessible name, and its state comes from
 * the switch role rather than from wording that changes.
 */
function buildLayerSwitch(layer) {
  const wrapper = document.createElement("label");
  wrapper.className = "mg-switch layer-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "mg-switch__input layer-eye";
  // Redundant with type=checkbox for the state, but it is what makes assistive
  // technology announce the control as a switch rather than a checkbox.
  input.setAttribute("role", "switch");
  input.setAttribute("aria-label", layer.label);
  const track = document.createElement("span");
  track.className = "mg-switch__track";
  track.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("span");
  thumb.className = "mg-switch__thumb";
  track.appendChild(thumb);
  wrapper.append(input, track);
  return { wrapper, input };
}

/**
 * Show a switch's state. `checked` follows intent (`active`). While a MapX call
 * is in flight (`busy`) the switch is `aria-busy` — which Mangrove draws as a
 * pending ring on the thumb, static under `prefers-reduced-motion` — and its
 * label says what is happening, since the layer is not on (or off) the map yet.
 * A layer whose last call failed keeps an error outline until the next call,
 * and a switch is `aria-disabled` (still focusable, so it can be explained)
 * while the map cannot accept layer changes.
 *
 * The switch's description (`title` on the input, which assistive technology
 * reports as the control's description) only explains what the row cannot do:
 * the map is still starting up, or this is a compact row with no source
 * controls of its own. It never restates the on/off state. That state belongs
 * to the switch role, and the wording it replaces ("Turn layer on/off") sat on
 * the `<label>`, so it reached the accessibility tree as part of the switch's
 * name — the very thing this PR set out to remove.
 */
function setLayerToggleState(
  layer,
  input,
  { active, busy = false, ready = true, failed = false, hint = "" },
) {
  input.checked = active;
  input.setAttribute("aria-busy", String(busy));
  if (ready) input.removeAttribute("aria-disabled");
  else input.setAttribute("aria-disabled", "true");
  input.setAttribute(
    "aria-label",
    busy ? `${active ? "Loading" : "Turning off"} ${layer.label}…` : layer.label,
  );
  const wrapper = input.parentElement;
  setClass(wrapper, "is-error", failed);
  const description = ready ? hint : "The map is still loading";
  if (description) input.title = description;
  else input.removeAttribute("title");
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

/**
 * The seen half of a failure: the same sentence the announcer speaks, as a
 * Mangrove form error under the row's head. `aria-hidden`, so a screen reader
 * hears it once, from the live region. Layers with controls of their own (an
 * external layer's status line) show their message there instead.
 */
function buildErrorLine() {
  const error = document.createElement("p");
  error.className = "layer-error mg-form-error";
  error.setAttribute("aria-hidden", "true");
  return error;
}

/**
 * What to announce while a MapX call for a layer is in flight. The switch's
 * own name says the same thing, but it is inside an `aria-busy` subtree, which
 * assistive technology is told not to report changes from.
 */
function busyMessage(layer, record) {
  return record.desired ? `Loading ${layer.label}…` : `Turning off ${layer.label}…`;
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
  // Compact rows have no sub-source controls of their own; the switch's
  // description says where to find them. A full row's switch needs no
  // description, so it gets none.
  const titleHint = variant === "full" ? "" : "Switch to this layer's own tab for source options";
  const published = isLayerAvailable(layer);
  const external = isExternalLayer(layer);
  const listeners = new AbortController();
  const { signal } = listeners;
  let destroyed = false;

  // Last record rendered (before the first: the store's "off" record), and
  // what the switch shows.
  let last = offRecord(layer.key);
  let shownDesired = false;
  let shownBusy = false;
  let shownReady = null;
  let shownFailed = false;
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

  // The row's head. In a full row the expand control is its own button, next
  // to (not around) the switch: two sibling controls instead of a switch
  // nested inside a role="button", which no assistive technology can present.
  const header = document.createElement("div");
  header.className = full ? "layer-header" : "cross-tab-row";

  let arrow = null;
  let expandBtn = null;
  const labelHost = full ? document.createElement("button") : header;
  if (full) {
    expandBtn = labelHost;
    expandBtn.type = "button";
    expandBtn.className = "layer-expand";
    // All layers support expand/collapse so reviewers can read descriptions.
    expandBtn.setAttribute("aria-expanded", "false");
    arrow = document.createElement("span");
    arrow.className = "layer-arrow";
    arrow.textContent = "▶"; // ▶
    arrow.setAttribute("aria-hidden", "true");
    expandBtn.appendChild(arrow);
  }

  const label = document.createElement("span");
  label.className = full ? "layer-label" : "cross-tab-label";
  label.textContent = layer.label;
  labelHost.appendChild(label);
  labelHost.appendChild(buildLayerTypeTag(layer, published));
  if (full) header.appendChild(expandBtn);

  let eyeBtn = null;
  if (published) {
    const { wrapper, input } = buildLayerSwitch(layer);
    eyeBtn = input;
    setLayerToggleState(layer, eyeBtn, { active: false, ready: isReady(), hint: titleHint });
    shownReady = isReady();
    // A checkbox toggles itself before the handler runs, so the record stays
    // the source of truth: a rejected change is written back by syncSwitch.
    eyeBtn.addEventListener(
      "click",
      (e) => {
        // No stopPropagation: the switch is a sibling of the expand control,
        // not nested inside it, so a click that reaches the row's head or root
        // activates nothing. (It would not have helped either — on a label,
        // the event that bubbles from the input is the original one, and only
        // the label's synthetic re-dispatch could be stopped.)
        if (isReady()) return;
        // Cancelling the click restores the checkbox's previous state.
        e.preventDefault();
        console.warn(`${layer.label} cannot be toggled yet — map is still loading.`);
      },
      { signal },
    );
    eyeBtn.addEventListener(
      "change",
      () => {
        toggleLayer({ expand: true });
        syncSwitch();
      },
      { signal },
    );
    eyeBtn.addEventListener(
      "keydown",
      (e) => {
        // Space activates a checkbox on its own; Enter does not, and both are
        // expected to work on the panel's switches.
        if (e.key !== "Enter") return;
        e.preventDefault();
        eyeBtn.click();
      },
      { signal },
    );
    header.appendChild(wrapper);
  }
  element.appendChild(header);

  // Outside the header and the body (hidden while collapsed), so it can speak
  // (and, for rows without controls of their own, show) while the row is
  // collapsed.
  const announcer = published ? buildAnnouncer() : null;
  if (announcer) element.appendChild(announcer);
  // Every published row has one. An external layer normally shows its message
  // on its own status line, and only falls back to this when that line was
  // never rendered (see showExternalStatus).
  const errorLine = published ? buildErrorLine() : null;
  if (errorLine) element.appendChild(errorLine);

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

  // A native button: Enter and Space activate it, and nothing has to guess
  // which control a key press was meant for.
  if (full) expandBtn.addEventListener("click", toggleAccordion, { signal });

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
    expandBtn.setAttribute("aria-expanded", String(value));
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

  /**
   * Bring the switch in line with a record: intent, whether a call is in
   * flight, whether the last one failed, and whether the map can accept
   * changes at all. Writes only what differs, so re-rendering the same record
   * mutates nothing.
   */
  function renderToggle(record, busy = isBusyStatus(record.status)) {
    if (!eyeBtn) return;
    const ready = isReady();
    const failed = record.status === "error";
    if (
      record.desired === shownDesired &&
      busy === shownBusy &&
      ready === shownReady &&
      failed === shownFailed &&
      eyeBtn.checked === record.desired
    ) {
      return;
    }
    setLayerToggleState(layer, eyeBtn, {
      active: record.desired,
      busy,
      ready,
      failed,
      hint: titleHint,
    });
    shownDesired = record.desired;
    shownBusy = busy;
    shownReady = ready;
    shownFailed = failed;
  }

  /**
   * Write the record back onto the switch after the user toggled it, so a
   * change the controller refused (or that the store has not changed) cannot
   * leave the checkbox showing something the map is not doing.
   */
  function syncSwitch() {
    if (destroyed || !eyeBtn || !store) return;
    renderToggle(store.get(layer.key));
  }

  function update(next) {
    if (destroyed) return;
    const prev = last;
    last = next;
    const busy = isBusyStatus(next.status);
    const wasBusy = isBusyStatus(prev.status);

    renderToggle(next, busy);
    // Every new activation expands on apply unless the header starts it.
    if (!next.desired && prev.desired) expandOnApply = true;

    if (announcer) {
      // Failures are announced in the row for every kind of layer (a failed
      // turn-on otherwise only flips the switch back). A new call replaces the
      // message, so the same failure is announced again if it happens again.
      if (busy && !wasBusy) {
        // `aria-busy` is what Mangrove draws the pending ring from, but it
        // also tells assistive technology to stop reporting changes inside the
        // switch's subtree, so the "Loading X…" name may never be spoken. Say
        // it from the row's live region instead, as rc.2's own
        // switch-pending.js does.
        setText(announcer, busyMessage(layer, next));
        if (errorLine) setText(errorLine, "");
      } else if (!busy && wasBusy) {
        // The call settled: drop the busy sentence rather than leave it
        // standing. A failure replaces it just below, so it is not announced
        // twice.
        setText(announcer, "");
      }
      // External controls announce the failures of changes made through them.
      const announcedByControls = external && (pendingSelections > 0 || selectionPending());
      if (
        next.status === "error" &&
        (prev.status !== "error" || next.error !== prev.error) &&
        !announcedByControls
      ) {
        announcer.textContent = failureMessage(layer, next);
        if (errorLine && !external) setText(errorLine, failureMessage(layer, next));
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
      return;
    }
    // No status line was rendered: the loading branch above returns early when
    // the activation came from the expand control (`expandOnApply === false`),
    // which manages expansion itself. Without this the failure of a full
    // external row was only spoken, never shown.
    if (errorLine) setText(errorLine, text);
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
