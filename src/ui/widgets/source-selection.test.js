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

  it("shows the in-flight index when a later click is rejected meanwhile", async () => {
    const slow = deferred();
    const onChange = vi.fn((index) => (index === 1 ? slow.promise : false));
    const select = createSourceSelection(0, onChange);

    const first = select(1);
    await expect(select(2)).resolves.toBe(1);

    slow.resolve(true);
    await expect(first).resolves.toBe(1);
  });
});
