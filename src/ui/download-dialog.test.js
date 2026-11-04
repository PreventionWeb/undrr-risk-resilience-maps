import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloadDialog } from "./download-dialog.js";

/** A promise with its resolve/reject exposed. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function key(target, keyName, init = {}) {
  const event = new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("createDownloadDialog", () => {
  let dialog;
  let opener;

  beforeEach(() => {
    document.body.innerHTML = '<button type="button" id="opener">Download CSV</button>';
    opener = document.getElementById("opener");
    opener.focus();
    dialog = createDownloadDialog();
  });

  afterEach(() => dialog.destroy());

  const live = () => dialog.element.querySelector('[role="status"]');
  const status = () => dialog.element.querySelector('[data-part="status"]');
  const retry = () => dialog.element.querySelector('[data-action="retry"]');
  const footerClose = () => dialog.element.querySelector('.download-dialog__actions [data-action="close"]');

  it("opens as a modal named by its title, focuses the heading and announces fetching", () => {
    dialog.open({ title: "Download CSV: Layer", run: () => new Promise(() => {}) });
    const el = dialog.element;
    expect(el.isConnected).toBe(true);
    expect(el.hasAttribute("open")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Download CSV: Layer");
    expect(document.activeElement).toBe(el.querySelector(".download-dialog__title"));
    expect(dialog.state).toBe("fetching");
    expect(live().textContent).toBe("Fetching data from the map service…");
    expect(el.querySelector("progress").value).toBe(1);
    expect(el.querySelector('[data-part="value"]').textContent).toBe("Step 1 of 3");
  });

  it("walks through processing and downloading to done, and announces each", async () => {
    const gate = deferred();
    const said = [];
    const observer = new MutationObserver(() => said.push(live().textContent));
    observer.observe(live(), { childList: true, characterData: true, subtree: true });
    dialog.open({
      title: "Download CSV: Layer",
      run: async (stepper) => {
        await gate.promise;
        stepper.step("processing");
        await flush();
        stepper.step("downloading");
        await flush();
        return "Download started: layer_MX-1.csv (3 regions).";
      },
    });
    gate.resolve();
    await flush();
    await flush();
    await flush();
    observer.disconnect();
    expect(dialog.state).toBe("done");
    expect(said).toEqual([
      "Fetching data from the map service…",
      "Preparing the CSV file…",
      "Starting the download…",
      "Download started: layer_MX-1.csv (3 regions).",
    ]);
    expect(status().textContent).toBe("Download started: layer_MX-1.csv (3 regions).");
    expect(dialog.element.querySelector(".download-dialog__progress").hidden).toBe(true);
    expect(footerClose().textContent).toBe("Close");
    expect(document.activeElement).toBe(footerClose());
  });

  it("shows an error with Try again, which runs the work again", async () => {
    let attempts = 0;
    dialog.open({
      title: "Download CSV: Layer",
      run: async () => {
        attempts++;
        if (attempts === 1) throw new Error("The map service took too long to answer.");
        return "Download started.";
      },
    });
    await flush();
    expect(dialog.state).toBe("error");
    expect(status().textContent).toBe("The map service took too long to answer.");
    expect(status().classList.contains("mg-form-error")).toBe(true);
    expect(retry().hidden).toBe(false);
    expect(document.activeElement).toBe(retry());
    expect(live().textContent).toBe("The map service took too long to answer.");

    retry().click();
    await flush();
    expect(attempts).toBe(2);
    expect(dialog.state).toBe("done");
    expect(retry().hidden).toBe(true);
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    dialog.open({ title: "T", run: () => new Promise(() => {}) });
    const el = dialog.element;
    const headerClose = el.querySelector(".download-dialog__close");
    // Retry is hidden while fetching: the focusable controls are the two closes.
    footerClose().focus();
    expect(key(footerClose(), "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(headerClose);
    expect(key(headerClose, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(footerClose());
    // From the heading (focused on open), Shift+Tab wraps to the last control.
    el.querySelector(".download-dialog__title").focus();
    key(el, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(footerClose());
  });

  it("closes on Escape, abandons the work and returns focus to the opener", async () => {
    const gate = deferred();
    let saved = false;
    dialog.open({
      title: "T",
      opener,
      run: async () => {
        await gate.promise;
        saved = true;
        return "done";
      },
    });
    key(dialog.element, "Escape");
    expect(dialog.element.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(live().textContent).toBe("");
    gate.resolve();
    await flush();
    // The run finished, but the closed dialog shows and says nothing about it.
    expect(saved).toBe(true);
    expect(dialog.state).toBe(null);
    expect(status().textContent).toBe("");
  });

  it("tells a run it was cancelled, so it can skip its download", async () => {
    const gate = deferred();
    let cancelled = null;
    dialog.open({
      title: "T",
      run: async (stepper) => {
        await gate.promise;
        cancelled = stepper.isCancelled();
        return "";
      },
    });
    footerClose().click();
    gate.resolve();
    await flush();
    expect(cancelled).toBe(true);
  });

  it("closes from either close button and restores focus", () => {
    dialog.open({ title: "T", opener, run: () => new Promise(() => {}) });
    dialog.element.querySelector(".download-dialog__close").click();
    expect(dialog.element.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("is removed from the page on destroy", () => {
    dialog.open({ title: "T", run: () => new Promise(() => {}) });
    dialog.destroy();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
