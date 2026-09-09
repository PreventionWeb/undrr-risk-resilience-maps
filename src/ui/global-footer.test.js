import { describe, it, expect, beforeEach } from "vitest";
import {
  footerSyndicationUrl,
  fetchGlobalFooterHtml,
  initGlobalFooter,
  setGlobalFooterVisible,
} from "./global-footer.js";

const FOOTER_HTML = '<footer class="mg-footer"><a href="/">UNDRR</a></footer>';

function jsonResponse(payload, { ok = true } = {}) {
  return { ok, json: async () => payload };
}

function container() {
  const el = document.createElement("div");
  el.id = "global-footer";
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("footerSyndicationUrl", () => {
  it("targets the undrr.org syndication endpoint with the footer page id", () => {
    const url = footerSyndicationUrl();
    expect(url).toContain("https://www.undrr.org/api/v2/content/landingpage");
    expect(url).toContain("id=83835");
    expect(url).toContain("suffixid=footer");
  });
});

describe("fetchGlobalFooterHtml", () => {
  it("returns the syndicated body", async () => {
    const fetchImpl = async () => jsonResponse({ results: [{ body: FOOTER_HTML }] });
    expect(await fetchGlobalFooterHtml({ fetchImpl })).toBe(FOOTER_HTML);
  });

  it("returns null on a non-OK response", async () => {
    const fetchImpl = async () => jsonResponse({}, { ok: false });
    expect(await fetchGlobalFooterHtml({ fetchImpl })).toBeNull();
  });

  it("returns null when the request throws", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    expect(await fetchGlobalFooterHtml({ fetchImpl })).toBeNull();
  });

  it("rejects a payload that is not the footer", async () => {
    const fetchImpl = async () => jsonResponse({ results: [{ body: "<div>not a footer</div>" }] });
    expect(await fetchGlobalFooterHtml({ fetchImpl })).toBeNull();
  });
});

describe("initGlobalFooter", () => {
  it("injects the syndicated markup once", async () => {
    const el = container();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ results: [{ body: FOOTER_HTML }] });
    };

    expect(await initGlobalFooter({ fetchImpl })).toBe(true);
    expect(el.querySelector("footer.mg-footer")).not.toBeNull();

    // Second call is a no-op, so a tab switch cannot refetch or duplicate it.
    expect(await initGlobalFooter({ fetchImpl })).toBe(false);
    expect(calls).toBe(1);
    expect(el.querySelectorAll("footer.mg-footer")).toHaveLength(1);
  });

  it("leaves the container empty when syndication fails", async () => {
    const el = container();
    const fetchImpl = async () => jsonResponse({}, { ok: false });
    expect(await initGlobalFooter({ fetchImpl })).toBe(false);
    expect(el.innerHTML).toBe("");
  });

  it("does not throw when the container is absent", async () => {
    const fetchImpl = async () => jsonResponse({ results: [{ body: FOOTER_HTML }] });
    expect(await initGlobalFooter({ fetchImpl })).toBe(false);
  });
});

describe("setGlobalFooterVisible", () => {
  it("shows the footer on content pages and hides it on the map", () => {
    const el = container();
    el.hidden = true;
    setGlobalFooterVisible(true);
    expect(el.hidden).toBe(false);
    setGlobalFooterVisible(false);
    expect(el.hidden).toBe(true);
  });
});
