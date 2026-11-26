# Contributing

Start with the [README setup](README.md#developing) for Node, Yarn and the local viewer.

## Workflow

- Changes go through **pull requests** — branch, PR, review, squash merge.
- `main` requires the Conventional PR title check; the repository uses squash merges with the PR title as the default commit subject.
- PRs should be reviewed before merging.

## Checks and tests

Before submitting code or inventory changes, run the checks used by
[CI](.github/workflows/ci.yml):

```bash
yarn lint
yarn test
yarn build
```

CI also runs the browser suite in a separate job. For documentation changes, verify affected
links, anchors, commands and claims; choose executable checks for the instructions changed.
Check formatting on edited files with `yarn prettier --check <files>`.

- `yarn test` — unit tests (vitest + jsdom).
- `yarn test:e2e` — the Chromium smoke suite (Playwright). It starts its own Vite
  dev server on port 3040, so nothing needs launching first. First run only:
  `npx playwright install chromium`.
- `yarn test:all` — both.

### Running the tests next to other checkouts

Several people (and agents) work on this repo through git worktrees, sometimes
nested inside the main checkout. Two things there used to make a test run lie,
and both are now handled by the configuration:

- **`yarn test` only ever collects this checkout's tests.** `vite.config.js`
  anchors vitest's `include` at `{src,scripts}/**` and excludes `.claude/**`,
  so a worktree with its own full `src/` is not swept into the run. Unit tests
  in a new top-level directory have to be added to that `include`.
- **`yarn test:e2e` checks whose dev server it is talking to.** It reuses a
  server already listening on its port (fast local iteration), so the dev server
  exposes `/__dev-server-identity` and `tests/e2e/global-setup.js` refuses the
  run when the answer is not this checkout. If you see that refusal, either stop
  the other server, or follow the message: `E2E_PORT=3041 yarn test:e2e` runs on
  a port of your own, and adding `E2E_REUSE_SERVER=0` never reuses a server at
  all (which then requires the port to be free). CI never reuses a server.

CI runs them as two jobs. Add a case to the unit suite by default; the E2E suite
is only for guarantees that need a real browser (URL and history, focus and
keys, what actually renders). MapX is stubbed there and must stay stubbed — no
test may reach MapX, GeoServer or EDRA. See
[ARCHITECTURE.md](ARCHITECTURE.md#testing) for the split and the stub.

### Live upstream checks

These optional commands contact real services and are separate from the stubbed suites:

| Command                          | Runbook                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `yarn test:edra-contract`        | [External runtime layers](docs/external-layers.md)               |
| `yarn test:mapx-raster-contract` | [Legend contracts and QA](docs/legends.md#tests-and-comparisons) |
| `yarn test:downloads-contract`   | [Download maintenance](docs/downloads.md#maintenance)            |

Run them when the relevant source contract changes or its runbook calls for a release check.

### Agent guidance

When working with Claude Code, use the **MapX SDK skill** (`/mapx-sdk-dev`) if available
for embedding, view management or SDK integration. It covers the postMessage bridge,
view queries and map controls. Repository setup and contribution rules remain here and
in the README.

## Commits

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

Pull requests are squash-merged. Their titles are the default squash commit subjects, so
use the same Conventional Commit format for PR titles. The required **Conventional
PR title** check runs when a PR opens, its title changes, or new commits arrive.
An optional scope and breaking-change `!` are supported, for example
`feat(mapx): add structured legends` or `feat(embed)!: change the host API`.
Allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, and `revert`. Keep review-history commits on a branch as
needed; keep the checked PR title as the squash subject. Do not override it with a nonconventional subject.
The title check runs trusted default-branch code in a `workflow_run` workflow. It reads current PR metadata
and publishes only the **Conventional PR title** status; it never executes PR head code.

```
<type>[optional scope]: <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`.

Do not add AI-assistant attribution trailers (`Co-Authored-By: Claude …`, `Claude-Session: …`). A `commit-msg` hook in `.githooks/` rejects them; `yarn install` enables it via `core.hooksPath`. To enable it by hand, run `git config core.hooksPath .githooks`.

## Changelog

The [CHANGELOG.md](CHANGELOG.md) follows the [Common Changelog](https://common-changelog.org/) format. Update it as part of any PR that introduces user-facing changes.

## Releasing

A release is a `vX.Y.Z` tag on `main`. Tags are what reach www.undrr.org: [undrr/drupal-microsites](https://gitlab.com/undrr/drupal-microsites) builds the highest `vX.Y.Z` tag into `/m/risk-and-resilience-maps/`. Merging to `main` only updates the GitHub Pages preview. See [deployment requirements](docs/deployment.md).

1. Open a `chore: release vX.Y.Z` PR that turns `## [Unreleased]` in the CHANGELOG into `## [X.Y.Z] - YYYY-MM-DD` and sets `version` in `package.json`. Merge it.
2. Tag the merge commit on `main` with an annotated tag and push it:

   ```bash
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Creating a GitHub release for the tag is optional; the tag is what counts.

3. The tag ships with the next drupal-microsites `main` pipeline, which runs on any push to that repo. To ship it straight away, run that pipeline by hand (CI/CD → Pipelines → Run pipeline, branch `main`). Dev updates when the pipeline finishes; staging and production within the hour. Check <https://www.undrr.org/m/risk-and-resilience-maps/maps-ref.txt> for the tag and commit that are live.

Only the highest plain `vX.Y.Z` tag is deployed. A pre-release tag like `v1.0.0-rc.1` is ignored, and so is a hotfix tag on an older line (`v0.0.7` after `v0.1.0`). A tag on a commit that isn't on `main` fails the drupal-microsites build, and that blocks every microsite deploy until it's fixed.

To hold back or roll back, set the `MAPS_VERSION` CI/CD variable in drupal-microsites to an earlier tag; see its `AGENTS.md`. Don't move or delete a published tag to roll back.

## Documentation

Keep project docs updated alongside code changes. Use the [documentation index](docs/index.md)
to find the maintained guide for each task. Update that guide and link to it rather than
copying detailed instructions into the README, architecture, learnings and scope documents.
The README should keep orientation, first use, adoption limits and routes to deeper guides.

Update the index when adding a guide. Keep proposals, dated findings and archived research
distinct from current instructions; prototype implementation does not approve V1 scope.
Preserve required credits and the conditions attached to recorded measurements.

When adding new work items, use [TODO.md](TODO.md). When discovering SDK quirks, design constraints, or non-obvious decisions, record them in [LEARNINGS.md](LEARNINGS.md).
