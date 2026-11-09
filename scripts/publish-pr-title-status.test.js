import { describe, expect, it, vi } from "vitest";
import { publishTitleStatus } from "./publish-pr-title-status.mjs";

const repository = "owner/viewer";
const sha = "a".repeat(40);
const event = {
  workflow_run: {
    event: "pull_request",
    name: "PR title request",
    head_sha: sha,
    head_repository: { full_name: "contributor/viewer" },
  },
};
const pull = (title) => ({
  state: "open",
  title,
  base: { repo: { full_name: repository } },
  head: { sha, repo: { full_name: "contributor/viewer" } },
});
const options = (request) => ({
  repository,
  token: "test",
  apiUrl: "https://api.github.test",
  runUrl: "https://github.test/run",
  request,
});
const response = (data) => ({ ok: true, json: async () => data });

describe("trusted PR title status", () => {
  it.each([
    ["fix: keep zero", "success"],
    ["No conventional prefix", "failure"],
  ])("validates current API title %s", async (title, state) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response([pull(title)]))
      .mockResolvedValueOnce(response({}));
    expect(await publishTitleStatus(event, options(request))).toBe(state === "success");
    expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({
      context: "Conventional PR title",
      state,
    });
  });
  it.each(["head", "repository", "closed"])("ignores stale or unrelated PRs (%s)", async (kind) => {
    const other = pull("fix: valid");
    if (kind === "head") other.head.sha = "b".repeat(40);
    if (kind === "repository") other.base.repo.full_name = "different/repo";
    if (kind === "closed") other.state = "closed";
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response([other]));
    expect(await publishTitleStatus(event, options(request))).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not accept one valid PR as cover for an invalid PR on the same SHA", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response([pull("fix: valid"), pull("Invalid title")]))
      .mockResolvedValueOnce(response({}));
    expect(await publishTitleStatus(event, options(request))).toBe(false);
  });
  it("rejects events not originating from the PR metadata request", async () => {
    const request = vi.fn();
    await expect(
      publishTitleStatus({ workflow_run: { ...event.workflow_run, event: "push" } }, options(request)),
    ).rejects.toThrow("Unexpected");
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps same-SHA invalid titles blocked across different forks", async () => {
    const invalid = pull("Invalid title");
    invalid.head.repo.full_name = "different/fork";
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response([pull("fix: valid"), invalid]))
      .mockResolvedValueOnce(response({}));
    expect(await publishTitleStatus(event, options(request))).toBe(false);
    expect(JSON.parse(request.mock.calls[2][1].body).state).toBe("failure");
  });
  it("clears an existing green status before metadata retrieval can fail", async () => {
    let state = "success";
    const request = vi.fn(async (_url, init) => {
      if (init.method === "POST") {
        state = JSON.parse(init.body).state;
        return response({});
      }
      return { ok: false, status: 403 };
    });
    await expect(publishTitleStatus(event, options(request))).rejects.toThrow("403");
    expect(state).toBe("pending");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
