import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDownloadDialog, DOWNLOAD_WAIT_HINT_MS } from "./download-dialog.js";

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

  afterEach(() => {
    dialog.destroy();
    vi.useRealTimers();
  });

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
    expect(el.querySelector("progress").hasAttribute("value")).toBe(false);
    expect(el.querySelector('[data-part="value"]').textContent).toBe("Step 1 of 3");
  });

  it("explains a slow fetch once and clears the hint when the stage changes", async () => {
    vi.useFakeTimers();
    let stepper;
    dialog.open({
      title: "Download CSV",
      run: (next) => {
        stepper = next;
        return new Promise(() => {});
      },
    });
    const notice = dialog.element.querySelector('[data-part="notice"]');
    await vi.advanceTimersByTimeAsync(DOWNLOAD_WAIT_HINT_MS - 1);
    expect(notice.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("choose Cancel");
    expect(live().textContent).toBe(notice.textContent);
    stepper.step("processing");
    expect(notice.hidden).toBe(true);
    expect(dialog.element.querySelector("progress").hasAttribute("value")).toBe(false);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_WAIT_HINT_MS);
    expect(notice.hidden).toBe(true);
  });

  it("cancels the delayed hint on close and starts a fresh wait on reopen", async () => {
    vi.useFakeTimers();
    const run = () => new Promise(() => {});
    dialog.open({ title: "Download CSV", run });
    await vi.advanceTimersByTimeAsync(DOWNLOAD_WAIT_HINT_MS - 1);
    dialog.close();
    await vi.advanceTimersByTimeAsync(DOWNLOAD_WAIT_HINT_MS);
    expect(live().textContent).toBe("");
    dialog.open({ title: "Download CSV", run });
    expect(dialog.element.querySelector('[data-part="notice"]').hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_WAIT_HINT_MS);
    expect(dialog.element.querySelector('[data-part="notice"]').hidden).toBe(false);
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
    expect(footerClose().textContent).toBe("Done");
    // Distinct names: the header control says what it does.
    expect(dialog.element.querySelector(".download-dialog__close").getAttribute("aria-label")).toBe(
      "Close dialog",
    );
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

  it("shows a quiet notice without Try again when nothing could be retried", async () => {
    dialog.open({
      title: "T",
      run: async () => ({
        message: "Download started: f.csv (243 regions).",
        notice: "7 of 243 regions have no name in the map service, so their region_name is blank.",
      }),
    });
    await flush();
    const notice = dialog.element.querySelector('[data-part="notice"]');
    expect(dialog.state).toBe("done");
    expect(notice.hidden).toBe(false);
    expect(notice.classList.contains("mg-form-error")).toBe(false);
    expect(dialog.element.querySelector('[data-part="status"]').classList.contains("mg-form-error")).toBe(
      false,
    );
    expect(retry().hidden).toBe(true);
    expect(document.activeElement).toBe(footerClose());
    expect(live().textContent).toContain("7 of 243 regions have no name");
  });

  it("shows a notice under a finished download, with Try again, and announces both", async () => {
    let attempts = 0;
    dialog.open({
      title: "T",
      run: async () => {
        attempts++;
        return {
          message: "Download started: f.csv (2 regions).",
          notice: "Region names could not be loaded.",
          retry: true,
        };
      },
    });
    await flush();
    const notice = dialog.element.querySelector('[data-part="notice"]');
    expect(dialog.state).toBe("done");
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe("Region names could not be loaded.");
    expect(live().textContent).toBe("Download started: f.csv (2 regions). Region names could not be loaded.");
    expect(retry().hidden).toBe(false);
    expect(document.activeElement).toBe(retry());
    retry().click();
    await flush();
    expect(attempts).toBe(2);
  });

  it("offers an error's action, which closes the dialog and runs it", async () => {
    const run = vi.fn();
    const error = Object.assign(new Error("The map has not started yet."), {
      action: { label: "Open the map", run },
    });
    dialog.open({ title: "T", opener, run: async () => Promise.reject(error) });
    await flush();
    const extra = dialog.element.querySelector('[data-action="extra"]');
    expect(extra.hidden).toBe(false);
    expect(extra.textContent).toBe("Open the map");
    expect(document.activeElement).toBe(extra);
    extra.click();
    expect(dialog.element.hasAttribute("open")).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  describe("confirm", () => {
    const extra = () => dialog.element.querySelector('[data-action="extra"]');
    const ask = () =>
      dialog.confirm({
        title: "Download a large file?",
        message: "big.tif is 3.6 GB.",
        confirmLabel: "Download (3.6 GB)",
        opener,
      });

    it("shows the message with a confirm button and Cancel, without the progress bar", () => {
      void ask();
      const el = dialog.element;
      expect(el.hasAttribute("open")).toBe(true);
      expect(el.getAttribute("aria-label")).toBe("Download a large file?");
      expect(dialog.state).toBe("confirm");
      expect(el.querySelector(".download-dialog__progress").hidden).toBe(true);
      expect(status().textContent).toBe("big.tif is 3.6 GB.");
      expect(live().textContent).toBe("big.tif is 3.6 GB.");
      expect(extra().hidden).toBe(false);
      expect(extra().textContent).toBe("Download (3.6 GB)");
      expect(footerClose().textContent).toBe("Cancel");
      expect(retry().hidden).toBe(true);
    });

    it("shows a selectable hosted URL only for the file confirmation that supplied it", () => {
      void dialog.confirm({
        title: "Download a large file?",
        message: "big.tif is 3.6 GB.",
        confirmLabel: "Download",
        fileUrl: "https://files.example/big.tif",
      });
      const field = dialog.element.querySelector(".download-dialog__url");
      const box = dialog.element.querySelector(".download-dialog__file");
      expect(box.hidden).toBe(false);
      expect(field.readOnly).toBe(true);
      field.select();
      expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe(
        "https://files.example/big.tif",
      );
      dialog.open({ title: "Download CSV", run: () => new Promise(() => {}) });
      expect(box.hidden).toBe(true);
      expect(field.value).toBe("");
      void ask();
      expect(box.hidden).toBe(true);
    });

    it("resolves true on the confirm button, closes and returns focus", async () => {
      const answer = ask();
      extra().click();
      await expect(answer).resolves.toBe(true);
      expect(dialog.element.hasAttribute("open")).toBe(false);
      expect(document.activeElement).toBe(opener);
    });

    it("resolves false on Cancel, the close button and Escape", async () => {
      let answer = ask();
      footerClose().click();
      await expect(answer).resolves.toBe(false);

      answer = ask();
      dialog.element.querySelector('.download-dialog__header [data-action="close"]').click();
      await expect(answer).resolves.toBe(false);

      answer = ask();
      key(dialog.element, "Escape");
      await expect(answer).resolves.toBe(false);
      expect(document.activeElement).toBe(opener);
    });

    it("resolves false when another dialog replaces it or it is destroyed", async () => {
      let answer = ask();
      dialog.open({ title: "Download CSV: Layer", run: () => new Promise(() => {}) });
      await expect(answer).resolves.toBe(false);
      expect(dialog.state).toBe("fetching");

      answer = ask();
      dialog.destroy();
      await expect(answer).resolves.toBe(false);
    });
  });
});
