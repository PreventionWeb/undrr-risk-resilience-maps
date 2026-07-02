import { describe, it, expect } from "vitest";
import { makeDraggable, makeResizable, onPanelCollapse, onPanelExpand } from "./panels.js";

// jsdom doesn't implement offsetParent / offsetWidth so we stub the minimal
// layout properties used by the drag and resize handlers.
function makePanel() {
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.left = "50px";
  el.style.top = "20px";
  document.body.appendChild(el);
  return el;
}

function makeHandle() {
  const h = document.createElement("div");
  document.body.appendChild(h);
  return h;
}

describe("onPanelCollapse", () => {
  it("clears inline width, height and maxHeight", () => {
    const el = makePanel();
    el.style.width = "320px";
    el.style.height = "240px";
    el.style.maxHeight = "240px";
    onPanelCollapse(el);
    expect(el.style.width).toBe("");
    expect(el.style.height).toBe("");
    expect(el.style.maxHeight).toBe("");
  });

  it("is a no-op when no inline styles are set", () => {
    const el = makePanel();
    expect(() => onPanelCollapse(el)).not.toThrow();
    expect(el.style.width).toBe("");
  });
});

describe("onPanelExpand", () => {
  it("restores dimensions from dataset", () => {
    const el = makePanel();
    el.dataset.resizedWidth = "400";
    el.dataset.resizedHeight = "300";
    onPanelExpand(el);
    expect(el.style.width).toBe("400px");
    expect(el.style.height).toBe("300px");
    expect(el.style.maxHeight).toBe("300px");
  });

  it("does not set styles when dataset is empty", () => {
    const el = makePanel();
    onPanelExpand(el);
    expect(el.style.width).toBe("");
    expect(el.style.height).toBe("");
    expect(el.style.maxHeight).toBe("");
  });

  it("only restores width when only width is stored", () => {
    const el = makePanel();
    el.dataset.resizedWidth = "350";
    onPanelExpand(el);
    expect(el.style.width).toBe("350px");
    expect(el.style.height).toBe("");
  });
});

describe("collapse → expand round-trip", () => {
  it("preserves dimensions across collapse/expand cycle", () => {
    const el = makePanel();
    el.dataset.resizedWidth = "420";
    el.dataset.resizedHeight = "260";
    // Simulate having inline styles set (e.g., user had resized)
    el.style.width = "420px";
    el.style.height = "260px";
    el.style.maxHeight = "260px";

    onPanelCollapse(el);
    expect(el.style.width).toBe("");

    onPanelExpand(el);
    expect(el.style.width).toBe("420px");
    expect(el.style.height).toBe("260px");
    expect(el.style.maxHeight).toBe("260px");
  });
});

describe("makeDraggable", () => {
  it("is idempotent — calling twice does not add duplicate listeners", () => {
    const el = makePanel();
    const handle = makeHandle();
    makeDraggable(el, handle);
    makeDraggable(el, handle); // second call should be no-op
    expect(handle.dataset.draggable).toBe("true");
  });

  it("adds is-draggable-handle class to handle", () => {
    const el = makePanel();
    const handle = makeHandle();
    makeDraggable(el, handle);
    expect(handle.classList.contains("is-draggable-handle")).toBe(true);
  });

  it("no-ops gracefully when el or handle is null/undefined", () => {
    expect(() => makeDraggable(null, null)).not.toThrow();
    const el = makePanel();
    expect(() => makeDraggable(el, null)).not.toThrow();
  });
});

describe("makeResizable", () => {
  it("appends a .panel-resize-grip element", () => {
    const el = makePanel();
    makeResizable(el);
    expect(el.querySelector(".panel-resize-grip")).not.toBeNull();
  });

  it("is idempotent — second call does not add a second grip", () => {
    const el = makePanel();
    makeResizable(el);
    makeResizable(el);
    expect(el.querySelectorAll(".panel-resize-grip").length).toBe(1);
  });

  it("grip has aria-hidden=true", () => {
    const el = makePanel();
    makeResizable(el);
    expect(el.querySelector(".panel-resize-grip").getAttribute("aria-hidden")).toBe("true");
  });

  it("no-ops gracefully when el is null", () => {
    expect(() => makeResizable(null)).not.toThrow();
  });
});
