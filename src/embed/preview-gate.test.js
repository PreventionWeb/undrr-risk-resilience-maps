import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "../../tests/support/async.js";
import { UNLOCKED_CLASS, watchPreviewGate } from "./preview-gate.js";

/** Put a gate element in the document, locked or already unlocked. */
function gateMarkup({ unlocked = false } = {}) {
  document.body.innerHTML = `<div data-mg-preview-access class="${unlocked ? UNLOCKED_CLASS : ""}"></div>`;
  return document.querySelector("[data-mg-preview-access]");
}

describe("watchPreviewGate", () => {
  let gate;

  afterEach(() => {
    gate?.destroy();
    gate = null;
    document.body.innerHTML = "";
  });

  it("is not locked on a page with no gate", () => {
    document.body.innerHTML = "<div></div>";
    gate = watchPreviewGate(document);
    expect(gate.locked).toBe(false);
  });

  it("is not locked when the gate is already unlocked (a sessionStorage unlock)", () => {
    gateMarkup({ unlocked: true });
    gate = watchPreviewGate(document);
    expect(gate.locked).toBe(false);
  });

  it("is locked while the gate element carries no unlocked class", () => {
    gateMarkup();
    gate = watchPreviewGate(document);
    expect(gate.locked).toBe(true);
  });

  it("opens, once, when Mangrove's script marks the gate unlocked", async () => {
    const element = gateMarkup();
    gate = watchPreviewGate(document);
    const unlocked = vi.fn();
    gate.onUnlock(unlocked);

    element.classList.add(UNLOCKED_CLASS);
    element.classList.add("something-else");

    await waitFor(() => expect(unlocked).toHaveBeenCalled());
    expect(gate.locked).toBe(false);
    expect(unlocked).toHaveBeenCalledTimes(1);
  });

  it("never calls a listener added after the gate opened", async () => {
    const element = gateMarkup();
    gate = watchPreviewGate(document);
    element.classList.add(UNLOCKED_CLASS);
    await waitFor(() => expect(gate.locked).toBe(false));

    const late = vi.fn();
    gate.onUnlock(late);
    expect(late).not.toHaveBeenCalled();
  });

  it("keeps going when one listener throws", async () => {
    const element = gateMarkup();
    gate = watchPreviewGate(document);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    gate.onUnlock(() => {
      throw new Error("boom");
    });
    gate.onUnlock(second);

    element.classList.add(UNLOCKED_CLASS);

    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("stops watching after destroy", async () => {
    const element = gateMarkup();
    gate = watchPreviewGate(document);
    const unlocked = vi.fn();
    gate.onUnlock(unlocked);

    gate.destroy();
    element.classList.add(UNLOCKED_CLASS);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unlocked).not.toHaveBeenCalled();
    expect(gate.locked).toBe(true);
  });
});
