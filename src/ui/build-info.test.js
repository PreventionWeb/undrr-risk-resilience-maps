import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, initBuildInfo } from "./build-info.js";

describe("build info", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <a id="build-info-link"><time id="build-updated-at"></time></a>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats recent code updates as relative time", () => {
    const now = new Date("2026-08-25T12:00:00Z");

    expect(formatRelativeTime(new Date("2026-08-25T10:00:00Z"), now)).toBe("2 hours ago");
    expect(formatRelativeTime(new Date("2026-08-22T12:00:00Z"), now)).toBe("3 days ago");
  });

  it("renders the build timestamp and repository link", () => {
    initBuildInfo({
      timestamp: "2026-08-25T10:00:00Z",
      commitHash: "abc1234",
      now: () => new Date("2026-08-25T12:00:00Z"),
    });

    const time = document.getElementById("build-updated-at");
    const link = document.getElementById("build-info-link");
    expect(time.textContent).toBe("Updated 2 hours ago");
    expect(time.dateTime).toBe("2026-08-25T10:00:00.000Z");
    expect(link.href).toBe("https://github.com/unisdr/undrr-risk-resilience-maps");
    expect(link.title).toContain("abc1234");
  });

  it("refreshes the relative time while the page remains open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T10:01:00Z"));
    const stop = initBuildInfo({
      timestamp: "2026-08-25T10:00:00Z",
      commitHash: "abc1234",
    });
    const time = document.getElementById("build-updated-at");
    expect(time.textContent).toBe("Updated 1 minute ago");

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(time.textContent).toBe("Updated 1 hour ago");
    stop();
  });
});
