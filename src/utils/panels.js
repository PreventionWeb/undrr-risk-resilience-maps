/**
 * Drag and resize utilities for floating panels.
 *
 * makeDraggable(el, handle, { signal }) — drag el by handle within its offsetParent.
 * makeResizable(el, { signal })         — add a bottom-right resize grip to el.
 * onPanelCollapse(el)                   — call before adding .is-collapsed; clears inline sizes.
 * onPanelExpand(el)                     — call after removing .is-collapsed; restores resized sizes.
 *
 * Both are idempotent while active. An optional AbortSignal removes every
 * listener they added (including those of a drag or resize in progress) and
 * undoes their markers (the handle's draggable flag and class, the grip), so
 * the same elements can be made draggable or resizable again afterwards.
 */

const MIN_W = 180;
const MIN_H = 80;

/**
 * Make `el` draggable by `handle` within its offsetParent.
 * Ignores pointerdown events that land on interactive children (buttons etc.).
 * @param {HTMLElement} el
 * @param {HTMLElement} handle
 * @param {{ signal?: AbortSignal }} [options] - aborting removes the drag behaviour
 */
export function makeDraggable(el, handle, { signal } = {}) {
  if (!el || !handle) return;
  if (signal?.aborted) return;
  if (handle.dataset.draggable) return;
  handle.dataset.draggable = "true";
  handle.classList.add("is-draggable-handle");
  signal?.addEventListener(
    "abort",
    () => {
      delete handle.dataset.draggable;
      handle.classList.remove("is-draggable-handle");
    },
    { once: true },
  );

  handle.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, select, a, [role="button"]')) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);

      const parent = el.offsetParent || document.body;
      const elRect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();

      let curLeft = elRect.left - parentRect.left;
      let curTop = elRect.top - parentRect.top;
      const startX = e.clientX - curLeft;
      const startY = e.clientY - curTop;

      // Lock in position as inline style so CSS rules are overridden during drag.
      el.style.transition = "none";
      el.style.left = curLeft + "px";
      el.style.top = curTop + "px";
      document.body.style.cursor = "grabbing";

      function onMove(e) {
        const maxLeft = parent.clientWidth - el.offsetWidth;
        const maxTop = parent.clientHeight - el.offsetHeight;
        curLeft = Math.max(0, Math.min(maxLeft, e.clientX - startX));
        curTop = Math.max(0, Math.min(maxTop, e.clientY - startY));
        el.style.left = curLeft + "px";
        el.style.top = curTop + "px";
      }

      // This drag's listeners, removed when it ends or when `signal` aborts.
      const drag = new AbortController();
      function cleanup() {
        drag.abort();
        document.body.style.cursor = "";
        el.style.transition = "";
      }
      signal?.addEventListener("abort", cleanup, { once: true, signal: drag.signal });

      handle.addEventListener("pointermove", onMove, { signal: drag.signal });
      handle.addEventListener("pointerup", cleanup, { once: true, signal: drag.signal });
      handle.addEventListener("pointercancel", cleanup, { once: true, signal: drag.signal });
      handle.addEventListener("lostpointercapture", cleanup, { once: true, signal: drag.signal });
    },
    { signal },
  );
}

/**
 * Add a bottom-right resize grip to `el`.
 * Resized dimensions are stored in el.dataset so collapse/expand can preserve them.
 * @param {HTMLElement} el
 * @param {{ signal?: AbortSignal }} [options] - aborting removes the grip and its listeners
 */
export function makeResizable(el, { signal } = {}) {
  if (!el) return;
  if (signal?.aborted) return;
  if (el.querySelector(".panel-resize-grip")) return;

  const grip = document.createElement("div");
  grip.className = "panel-resize-grip";
  grip.setAttribute("aria-hidden", "true");
  el.appendChild(grip);
  signal?.addEventListener("abort", () => grip.remove(), { once: true });

  grip.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);

      const parent = el.offsetParent || document.body;
      const startW = el.offsetWidth;
      const startH = el.offsetHeight;
      const startX = e.clientX;
      const startY = e.clientY;
      el.style.transition = "none";

      function onMove(e) {
        const maxW = parent.clientWidth - el.offsetLeft;
        const maxH = parent.clientHeight - el.offsetTop;
        const newW = Math.max(MIN_W, Math.min(maxW, startW + (e.clientX - startX)));
        const newH = Math.max(MIN_H, Math.min(maxH, startH + (e.clientY - startY)));
        el.style.width = newW + "px";
        el.style.height = newH + "px";
        el.style.maxHeight = newH + "px";
        el.dataset.resizedWidth = String(newW);
        el.dataset.resizedHeight = String(newH);
      }

      // This resize's listeners, removed when it ends or when `signal` aborts.
      const resize = new AbortController();
      function cleanup() {
        resize.abort();
        el.style.transition = "";
      }
      signal?.addEventListener("abort", cleanup, { once: true, signal: resize.signal });

      grip.addEventListener("pointermove", onMove, { signal: resize.signal });
      grip.addEventListener("pointerup", cleanup, { once: true, signal: resize.signal });
      grip.addEventListener("pointercancel", cleanup, { once: true, signal: resize.signal });
      grip.addEventListener("lostpointercapture", cleanup, { once: true, signal: resize.signal });
    },
    { signal },
  );
}

/**
 * Call before collapsing a resizable panel to prevent inline resize dimensions
 * from overriding the collapsed CSS width.
 */
export function onPanelCollapse(el) {
  el.style.width = "";
  el.style.height = "";
  el.style.maxHeight = "";
}

/**
 * Call after expanding a previously collapsed panel to restore any user-resized
 * dimensions stored in el.dataset.
 */
export function onPanelExpand(el) {
  if (el.dataset.resizedWidth) {
    el.style.width = el.dataset.resizedWidth + "px";
  }
  if (el.dataset.resizedHeight) {
    el.style.height = el.dataset.resizedHeight + "px";
    el.style.maxHeight = el.dataset.resizedHeight + "px";
  }
}
