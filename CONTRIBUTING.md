# Contributing

> Keep this document updated as the project evolves.

## Workflow

- Feature and fix changes go through **pull requests** — branch, PR, review, merge.
- Dependency bumps, doc-only changes, and chore commits may go directly to `main` when no code review is needed.
- PRs should be reviewed before merging.

## Tests

- `yarn test` — unit tests (vitest + jsdom). Fast; run these constantly.
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

## Commits

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>[optional scope]: <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`.

Do not add AI-assistant attribution trailers (`Co-Authored-By: Claude …`, `Claude-Session: …`). A `commit-msg` hook in `.githooks/` rejects them; `yarn install` enables it via `core.hooksPath`. To enable it by hand, run `git config core.hooksPath .githooks`.

## Changelog

The [CHANGELOG.md](CHANGELOG.md) follows the [Common Changelog](https://common-changelog.org/) format. Update it as part of any PR that introduces user-facing changes.

## Releasing

A release is a `vX.Y.Z` tag on `main`. Tags are what reach www.undrr.org: [undrr/drupal-microsites](https://gitlab.com/undrr/drupal-microsites) builds the highest `vX.Y.Z` tag into `/m/risk-and-resilience-maps/`. Merging to `main` only updates the GitHub Pages preview. See [README § Deployment](README.md#deployment).

1. Open a `chore: release vX.Y.Z` PR that turns `## [Unreleased]` in the CHANGELOG into `## [X.Y.Z] - YYYY-MM-DD` and sets `version` in `package.json`. Merge it.
2. Tag the merge commit on `main` with an annotated tag and push it:

   ```bash
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Creating a GitHub release for the tag is optional; the tag is what counts.

3. The tag goes live on www.undrr.org the next time the drupal-microsites `main` pipeline runs. To publish straight away, run that pipeline by hand (CI/CD → Pipelines → Run pipeline, branch `main`). Check <https://www.undrr.org/m/risk-and-resilience-maps/maps-ref.txt> for the tag and commit that are live.

Only plain `vX.Y.Z` tags are picked up. A tag like `v1.0.0-rc.1` is ignored, so pre-release tags are safe to push. A tag on a commit that isn't on `main` fails the drupal-microsites build.

To hold back or roll back, drupal-microsites can pin `MAPS_VERSION` to an earlier tag; see its `AGENTS.md`. Don't move or delete a published tag to roll back.

## Documentation

Keep project docs updated alongside code changes. See the [README](README.md#project-documentation) for the full list of documentation files and what each one covers.

When adding new work items, use [TODO.md](TODO.md). When discovering SDK quirks, design constraints, or non-obvious decisions, record them in [LEARNINGS.md](LEARNINGS.md).
