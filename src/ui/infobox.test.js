import { describe, it, expect, beforeEach } from "vitest";
import { showInfobox } from "./infobox.js";

function setupDOM() {
  document.body.innerHTML = `
    <div id="infobox" style="display:none">
      <div class="infobox-title"></div>
      <div class="infobox-body"></div>
      <button class="infobox-close"></button>
    </div>
  `;
}

describe("showInfobox", () => {
  beforeEach(setupDOM);

  // --- hiding cases ---

  it("hides the box for null data", () => {
    const box = document.getElementById("infobox");
    box.style.display = "block";
    showInfobox(null);
    expect(box.style.display).toBe("none");
  });

  it("hides the box for non-object data (string)", () => {
    showInfobox("a string");
    expect(document.getElementById("infobox").style.display).toBe("none");
  });

  it("hides the box when attributes is an empty object", () => {
    showInfobox({ attributes: {} });
    expect(document.getElementById("infobox").style.display).toBe("none");
  });

  it("hides the box when all attribute entries are null or empty", () => {
    showInfobox({ attributes: { name: null, label: "" } });
    expect(document.getElementById("infobox").style.display).toBe("none");
  });

  it("hides the box when all entries are SKIP_KEYS only", () => {
    showInfobox({ attributes: { gid: 1, geom: "POINT(0 0)", mx_t0: "2020", mx_t1: "2021" } });
    expect(document.getElementById("infobox").style.display).toBe("none");
  });

  // --- showing cases ---

  it("shows the box for a valid plain-object attributes payload", () => {
    showInfobox({ attributes: { name: "Test Feature", value: 42 } });
    expect(document.getElementById("infobox").style.display).toBe("block");
  });

  it("shows the box for an array attributes payload (vector views)", () => {
    showInfobox({ attributes: [{ name: "Feature A", area: "100" }] });
    expect(document.getElementById("infobox").style.display).toBe("block");
  });

  // --- title ---

  it("uses the 'name' attribute as the title", () => {
    showInfobox({ attributes: { name: "My Feature" } });
    expect(document.querySelector(".infobox-title").textContent).toBe("My Feature");
  });

  it("uses the 'title' attribute as the title", () => {
    showInfobox({ attributes: { title: "My Title", value: "x" } });
    expect(document.querySelector(".infobox-title").textContent).toBe("My Title");
  });

  it("falls back to 'Feature' when no name/title/label key exists", () => {
    showInfobox({ attributes: { count: 5 } });
    expect(document.querySelector(".infobox-title").textContent).toBe("Feature");
  });

  // --- SKIP_KEYS filtering ---

  it("filters out gid, geom, mx_t0, mx_t1 from the body", () => {
    showInfobox({
      attributes: { gid: 1, name: "x", geom: "POINT(0 0)", mx_t0: "2020", mx_t1: "2021", value: "10" },
    });
    const body = document.querySelector(".infobox-body").innerHTML;
    expect(body).not.toMatch(/\bgid\b/i);
    expect(body).not.toMatch(/\bgeom\b/i);
    expect(body).not.toMatch(/\bmx_t0\b/i);
    expect(body).toContain("Value"); // infobox capitalises the key
  });

  // --- keyboard + close button ---

  it("closes on Escape key", () => {
    showInfobox({ attributes: { name: "X" } });
    expect(document.getElementById("infobox").style.display).toBe("block");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("infobox").style.display).toBe("none");
  });

  it("does not close on other keys", () => {
    showInfobox({ attributes: { name: "X" } });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(document.getElementById("infobox").style.display).toBe("block");
  });

  it("closes on close button click", () => {
    showInfobox({ attributes: { name: "X" } });
    document.querySelector(".infobox-close").click();
    expect(document.getElementById("infobox").style.display).toBe("none");
  });

  it("removes the Escape handler after close, so a second Escape does nothing", () => {
    showInfobox({ attributes: { name: "X" } });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // Re-show and close via button, then Escape should not error
    showInfobox({ attributes: { name: "Y" } });
    document.querySelector(".infobox-close").click();
    // No throw = pass
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("replaces the Escape handler when shown a second time (no duplicate handlers)", () => {
    showInfobox({ attributes: { name: "First" } });
    showInfobox({ attributes: { name: "Second" } });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("infobox").style.display).toBe("none");
    // Firing Escape again should not cause a double-close error
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  // --- HTML escaping ---

  it("escapes HTML-special characters in attribute values", () => {
    showInfobox({ attributes: { name: "safe", xss: '<script>alert("x")</script>' } });
    const body = document.querySelector(".infobox-body").innerHTML;
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });
});
