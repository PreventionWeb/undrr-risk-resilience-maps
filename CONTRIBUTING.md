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

## Documentation

Keep project docs updated alongside code changes. See the [README](README.md#project-documentation) for the full list of documentation files and what each one covers.

When adding new work items, use [TODO.md](TODO.md). When discovering SDK quirks, design constraints, or non-obvious decisions, record them in [LEARNINGS.md](LEARNINGS.md).
