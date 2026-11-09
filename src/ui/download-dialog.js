/**
 * The progress dialog for a generated download (prototype, #64).
 *
 * A native `<dialog>` opened with `showModal()`: the browser makes the rest of
 * the page inert and puts the dialog in the top layer. On top of that, the
 * dialog keeps Tab and Shift+Tab inside itself, closes on Escape, and returns
 * focus to the control that opened it. Where `showModal` is missing (old
 * browsers, jsdom) it falls back to the `open` attribute with `aria-modal`,
 * and the same key handling.
 *
 * States, in order: `fetching` → `processing` → `downloading` → `done`, or
 * `error` (with Retry) from any of the first three. Each state change is
 * spoken through a live region built by the app's announcer
 * (createLayerAnnouncer). The region lives *inside* the dialog: a modal dialog
 * makes everything outside it inert, which takes the sidebar's own region out
 * of the accessibility tree while the dialog is open, so it could not speak.
 * The visible status line is not live, so nothing is read twice.
 *
 * `confirm(...)` reuses the same dialog to ask before something costly (a very
 * large file): no progress bar, a message, and a confirm button beside Cancel.
 * It resolves `true` only when the confirm button is pressed.
 *
 * Closing while work is in flight abandons it: the run is not cancelled (a
 * MapX call cannot be), but its result is ignored and nothing is downloaded.
 */
import { createLayerAnnouncer } from "./announcer.js";

const STEPS = ["fetching", "processing", "downloading"];
// A one-off hint for a slow fetch, not a duration estimate or a stall detector.
export const DOWNLOAD_WAIT_HINT_MS = 10_000;
const WAIT_HINT =
  "Large datasets can take a while. Keep this dialog open, or choose Cancel to stop this download.";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @typedef {object} DialogStepper
 * @property {(state: "fetching"|"processing"|"downloading", message?: string) => void} step
 *   move to a progress state
 * @property {() => boolean} isCancelled - the dialog was closed or retried meanwhile
 */

/**
 * @param {{ doc?: Document }} [options]
 * @returns {{
 *   open(options: { title: string, run: (stepper: DialogStepper) => Promise<string>, opener?: Element|null }): void,
 *   confirm(options: { title: string, message: string, confirmLabel: string, fileUrl?: string, opener?: Element|null }): Promise<boolean>,
 *   close(): void,
 *   readonly element: HTMLDialogElement,
 *   readonly state: string|null,
 *   destroy(): void,
 * }}
 */
export function createDownloadDialog({ doc = document } = {}) {
  const dialog = doc.createElement("dialog");
  dialog.className = "download-dialog";
  dialog.innerHTML = `
    <div class="download-dialog__header">
      <h2 class="download-dialog__title" tabindex="-1"></h2>
      <button type="button" class="download-dialog__close" data-action="close" aria-label="Close dialog">
        <span class="mg-icon mg-icon-close" aria-hidden="true"></span>
      </button>
    </div>
    <div class="download-dialog__progress mg-progress-bar">
      <span class="mg-progress-bar__label" data-part="label" aria-hidden="true"></span>
      <div class="mg-progress-bar__track">
        <progress class="mg-progress-bar__native"></progress>
      </div>
      <span class="mg-progress-bar__value" data-part="value" aria-hidden="true"></span>
    </div>
    <p class="download-dialog__status" data-part="status"></p>
    <p class="download-dialog__notice mg-form-help" data-part="notice" hidden></p>
    <div class="download-dialog__file" hidden>
      <label class="download-dialog__url-label">File URL
        <textarea class="download-dialog__url" rows="2" readonly spellcheck="false"></textarea>
      </label>
      <p class="download-dialog__hint">Copy this URL to use a download manager.</p>
    </div>
    <div class="download-dialog__actions mg-buttons">
      <button type="button" class="mg-button mg-button-primary" data-action="extra" hidden></button>
      <button type="button" class="mg-button mg-button-primary" data-action="retry" hidden>Try again</button>
      <button type="button" class="mg-button mg-button-secondary" data-action="close">Cancel</button>
    </div>
  `;
  // The dialog is named by aria-label, set to the heading's text on open:
  // aria-labelledby would need an id, and the app's generated markup has none
  // (see ARCHITECTURE.md, "Labelling controls").
  const title = dialog.querySelector(".download-dialog__title");
  const progressBox = dialog.querySelector(".download-dialog__progress");
  const progress = dialog.querySelector("progress");
  const label = dialog.querySelector('[data-part="label"]');
  const value = dialog.querySelector('[data-part="value"]');
  const status = dialog.querySelector('[data-part="status"]');
  const notice = dialog.querySelector('[data-part="notice"]');
  const fileBox = dialog.querySelector(".download-dialog__file");
  const fileUrlField = dialog.querySelector(".download-dialog__url");
  const retryBtn = dialog.querySelector('[data-action="retry"]');
  const extraBtn = dialog.querySelector('[data-action="extra"]');
  const closeBtn = dialog.querySelector('.download-dialog__actions [data-action="close"]');

  const announcer = createLayerAnnouncer(doc);
  dialog.appendChild(announcer.element);

  const listeners = new AbortController();
  const { signal } = listeners;
  let state = null;
  let current = null; // { title, run, opener }
  let extraAction = null;
  let generation = 0;
  let settleConfirm = null; // resolves a pending confirm(), once
  let confirmAccepted = false;
  let destroyed = false;
  let waitHintTimer = null;

  function say(message) {
    // No record: every state change is a new event for the region.
    announcer.announce("download", message);
  }

  /**
   * @param {string} next
   * @param {string} message
   * @param {{ notice?: string, retry?: boolean, action?: { label: string, run: () => void }|null }} [extra] -
   *   a notice under a finished download (with Try again only when `retry`),
   *   or an action button for an error (e.g. "Open the map")
   */
  function setState(next, message, { notice: noticeText = "", retry = false, action = null } = {}) {
    clearTimeout(waitHintTimer);
    waitHintTimer = null;
    state = next;
    dialog.dataset.state = next;
    const index = STEPS.indexOf(next);
    progressBox.hidden = index < 0;
    if (index >= 0) {
      // These are stages, not equal portions of time or bytes. A MapX call
      // reports no incremental progress, so never imply 33%/67% completion.
      progress.setAttribute("aria-label", `Step ${index + 1} of ${STEPS.length}: ${message}`);
      label.textContent = message;
      value.textContent = `Step ${index + 1} of ${STEPS.length}`;
    }
    status.textContent = index >= 0 ? "" : message;
    status.classList.toggle("mg-form-error", next === "error");
    notice.textContent = noticeText;
    notice.hidden = !noticeText;
    retryBtn.hidden = !(next === "error" || (next === "done" && retry));
    extraAction = action;
    extraBtn.hidden = !action;
    extraBtn.textContent = action?.label ?? "";
    closeBtn.textContent = index >= 0 || next === "confirm" ? "Cancel" : next === "done" ? "Done" : "Close";
    say(noticeText ? `${message} ${noticeText}` : message);
    if (next === "fetching") {
      waitHintTimer = setTimeout(() => {
        waitHintTimer = null;
        notice.textContent = WAIT_HINT;
        notice.hidden = false;
        say(WAIT_HINT);
      }, DOWNLOAD_WAIT_HINT_MS);
    }
  }

  async function start() {
    const run = ++generation;
    const isCancelled = () => run !== generation || destroyed || !dialog.open;
    const stepper = {
      step(next, message) {
        if (isCancelled()) return;
        setState(next, message ?? DEFAULT_MESSAGES[next]);
      },
      isCancelled,
    };
    stepper.step("fetching");
    try {
      const result = await current.run(stepper);
      if (isCancelled()) return;
      const done = typeof result === "string" ? { message: result } : (result ?? {});
      setState("done", done.message || "Download started.", {
        notice: done.notice,
        retry: Boolean(done.retry),
      });
      (done.retry ? retryBtn : closeBtn).focus();
    } catch (error) {
      if (isCancelled()) return;
      setState("error", error?.message || "Something went wrong while preparing the download.", {
        action: error?.action ?? null,
      });
      (error?.action ? extraBtn : retryBtn).focus();
    }
  }

  /** Show the dialog (modal) with a title, remembering where focus returns. */
  function show(text, run, opener) {
    settle(false); // a confirm still open is answered "no"
    current = { run, opener };
    fileBox.hidden = true;
    fileUrlField.value = "";
    title.textContent = text;
    dialog.setAttribute("aria-label", text);
    if (!dialog.isConnected) doc.body.appendChild(dialog);
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else {
        dialog.setAttribute("open", "");
        dialog.setAttribute("aria-modal", "true");
      }
    }
    title.focus();
  }

  function open({ title: text, run, opener = doc.activeElement }) {
    if (destroyed) return;
    show(text, run, opener);
    void start();
  }

  /**
   * Ask before going on. Resolves true when the confirm button is pressed,
   * false on Cancel, Escape, ✕ or anything else that closes the dialog.
   * @param {{ title: string, message: string, confirmLabel: string, fileUrl?: string, opener?: Element|null }} options
   * @returns {Promise<boolean>}
   */
  function confirm({ title: text, message, confirmLabel, fileUrl = "", opener = doc.activeElement }) {
    if (destroyed) return Promise.resolve(false);
    show(text, null, opener);
    fileUrlField.value = fileUrl;
    fileBox.hidden = !fileUrl;
    generation++; // any earlier run is abandoned
    return new Promise((resolve) => {
      confirmAccepted = false;
      settleConfirm = resolve;
      setState("confirm", message, { action: { label: confirmLabel, run: () => {}, confirm: true } });
    });
  }

  function settle(value) {
    const resolve = settleConfirm;
    settleConfirm = null;
    resolve?.(value);
  }

  function close() {
    if (!dialog.open && !dialog.hasAttribute("open")) return;
    generation++;
    clearTimeout(waitHintTimer);
    waitHintTimer = null;
    if (typeof dialog.close === "function") dialog.close();
    dialog.removeAttribute("open");
    dialog.removeAttribute("aria-modal");
    announcer.announce("download", "");
    state = null;
    delete dialog.dataset.state;
    const opener = current?.opener;
    current = null;
    settle(confirmAccepted);
    confirmAccepted = false;
    // Back to the control that opened the dialog, if it is still on the page.
    if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
  }

  dialog.addEventListener(
    "click",
    (event) => {
      const action = event.target.closest?.("[data-action]")?.dataset.action;
      if (action === "close") close();
      else if (action === "extra" && extraAction) {
        const { run } = extraAction;
        if (extraAction.confirm) confirmAccepted = true;
        close();
        run();
      } else if (action === "retry" && current?.run) {
        title.focus();
        void start();
      }
    },
    { signal },
  );

  // Escape: the native dialog fires `cancel`; close through our path so focus
  // returns and the run is abandoned.
  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      close();
    },
    { signal },
  );

  dialog.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = doc.activeElement;
      if (event.shiftKey && (active === first || active === title || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    },
    { signal },
  );

  return {
    open,
    confirm,
    close,
    get element() {
      return dialog;
    },
    get state() {
      return state;
    },
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      listeners.abort();
      announcer.destroy();
      dialog.remove();
    },
  };
}

const DEFAULT_MESSAGES = {
  fetching: "Fetching data from the map service…",
  processing: "Preparing the CSV file…",
  downloading: "Starting the download…",
};
