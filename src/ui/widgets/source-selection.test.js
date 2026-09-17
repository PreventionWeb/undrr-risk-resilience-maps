import { describe, expect, it, vi } from "vitest";
import { createSourceSelection } from "./source-selection.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createSourceSelection", () => {
  it("shows the new index when the switch succeeds", async () => {
    const select = createSourceSelection(0, vi.fn().mockResolvedValue(true));
    await expect(select(2)).resolves.toBe(2);
  });

  it("treats an undefined result as accepted", async () => {
    const select = createSourceSelection(0, () => {});
    await expect(select(1)).resolves.toBe(1);
  });

  it("shows the index the callback reports the layer ended up on", async () => {
    // e.g. the switch failed and the previous source was kept
    const select = createSourceSelection(0, vi.fn().mockResolvedValue(0));
    await expect(select(2)).resolves.toBe(0);
  });

  it("falls back to the last confirmed index when rejected or failed", async () => {
    const onChange = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("x"));
    const select = createSourceSelection(0, onChange);
    await select(1);
    await expect(select(2)).resolves.toBe(1);
    await expect(select(0)).resolves.toBe(1);
  });

  it("shows the latest pick when an earlier pick settles first", async () => {
    // Both picks settle together once the last one is applied (as the layer controller does).
    const applied = deferred();
    const select = createSourceSelection(0, () => applied.promise);

    const first = select(1);
    const second = select(2);
    applied.resolve(2);

    await expect(first).resolves.toBe(2);
    await expect(second).resolves.toBe(2);
  });

  it("shows a newer pick still in flight when an older one settles", async () => {
    const slow = deferred();
    const onChange = vi.fn((index) => (index === 1 ? Promise.resolve(1) : slow.promise));
    const select = createSourceSelection(0, onChange);

    const second = select(2);
    // An older-style race: a pick made after 2 but settling first.
    const first = select(1);
    await expect(first).resolves.toBe(1);

    slow.resolve(2);
    // 2 settled after 1 was picked, so it shows the newest pick's outcome.
    await expect(second).resolves.toBe(1);
  });
});
