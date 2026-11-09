import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { isConventionalTitle } from "./check-pr-title.mjs";

const script = resolve("scripts/check-pr-title.mjs");

describe("squash merge PR titles", () => {
  it.each([
    "feat(mapx): adopt official legends and fix no-data indicators",
    "fix: prevent accidental map rotation",
    "chore: release v0.0.13",
    "feat(embed)!: change the host API",
    "refactor(UI): simplify controls",
    "ci: require conventional PR titles",
  ])("accepts %s", (title) => expect(isConventionalTitle(title)).toBe(true));

  it.each([
    "Adopt official legends",
    "Feat: add a legend",
    "feature: add a legend",
    "fix: ",
    "fix:  ",
    "fix:",
    "fix(): empty scope",
    "fix( ): blank scope",
    "fix:  leading whitespace",
    "fix: trailing whitespace ",
    "fix: first\nsecond",
    "fix: first\rsecond",
    "fix(scope: broken syntax",
    undefined,
  ])("rejects %s", (title) => expect(isConventionalTitle(title)).toBe(false));

  it("fails the command on invalid metadata and accepts a conventional title", () => {
    const invalid = spawnSync(process.execPath, [script], {
      env: { ...process.env, PR_TITLE: "Unprefixed title" },
      encoding: "utf8",
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Conventional Commit format");
    expect(() =>
      execFileSync(process.execPath, [script], {
        env: { ...process.env, PR_TITLE: "fix: preserve zero values" },
      }),
    ).not.toThrow();
  });
});
