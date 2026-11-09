import { pathToFileURL } from "node:url";

const TYPES = new Set([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]);

export function isConventionalTitle(title) {
  if (typeof title !== "string") return false;
  const match = /^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?: ([^\r\n]+)$/.exec(title);
  return (
    !!match &&
    TYPES.has(match[1]) &&
    (!match[2] || match[2].trim() === match[2]) &&
    match[4].trim().length > 0 &&
    match[4].trim() === match[4]
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!isConventionalTitle(process.env.PR_TITLE)) {
    console.error("PR title must use Conventional Commit format: type(scope)!: description");
    console.error("Examples: feat(mapx): add structured legends | fix: handle missing raster data");
    console.error("Received: " + JSON.stringify(process.env.PR_TITLE ?? ""));
    process.exitCode = 1;
  }
}
