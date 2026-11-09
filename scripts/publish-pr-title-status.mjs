import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isConventionalTitle } from "./check-pr-title.mjs";

export function matchingPullRequests(pulls, run, repository) {
  return pulls.filter(
    (pull) =>
      pull.state === "open" && pull.base?.repo?.full_name === repository && pull.head?.sha === run.head_sha,
  );
}

export async function publishTitleStatus(event, { repository, token, apiUrl, runUrl, request = fetch }) {
  const run = event.workflow_run;
  if (
    run?.event !== "pull_request" ||
    run.name !== "PR title request" ||
    !/^[a-f0-9]{40}$/.test(run.head_sha ?? "")
  )
    throw new Error("Unexpected title-request event");

  async function api(path, body) {
    const response = await request(`${apiUrl}/repos/${repository}/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    return response.json();
  }

  // A title edit keeps the same SHA. Clear a prior green result before reading
  // current metadata so a lookup failure leaves the required status pending.
  await api(`statuses/${run.head_sha}`, {
    context: "Conventional PR title",
    state: "pending",
    description: "Checking current PR title",
    target_url: runUrl,
  });

  const pulls = [];
  for (let page = 1; ; page++) {
    const batch = await api(`commits/${run.head_sha}/pulls?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Invalid PR metadata response");
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  const current = matchingPullRequests(pulls, run, repository);
  // An old request must not publish a result for a replacement PR head.
  if (!current.length) return null;
  const valid = current.every((pull) => isConventionalTitle(pull.title));
  await api(`statuses/${run.head_sha}`, {
    context: "Conventional PR title",
    state: valid ? "success" : "failure",
    description: valid
      ? "PR title uses Conventional Commit format"
      : "Use type(scope)!: description in the PR title",
    target_url: runUrl,
  });
  return valid;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const valid = await publishTitleStatus(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), {
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  });
  if (valid === false) process.exitCode = 1;
}
