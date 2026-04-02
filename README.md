# UNDRR Risk to Resilience Maps

A MapX-based geospatial explorer for UNDRR. Replicates the [GRI Risk Viewer](https://global.infrastructureresilience.org) interaction model with UNDRR branding, tied to the Risk & Resilience Metrics framework. Builds on the [mapx-demo-embed](../mapx-demo-embed/) proof of concept (a sibling repo; MapX SDK iframe bridge, Mangrove UI, Vite toolchain). See [PRD.md](PRD.md) for requirements, scope, and timeline.

## Developing

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow conventions (PRs, conventional commits, changelog).

### Claude Code

When working in this repo with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), use the **MapX SDK skill** (`/mapx-sdk-dev`) for MapX embedding, view management, or SDK integration. It has current reference material for the SDK's postMessage bridge, view queries, and map controls.

### Project documentation

Keep these files updated as the project evolves:

- [PRD.md](PRD.md) -- product requirements, scope, blockers, and timeline
- [ARCHITECTURE.md](ARCHITECTURE.md) -- system design and technical decisions
- [METHODOLOGY.md](METHODOLOGY.md) -- approach and rationale (stub; will be populated at build phase)
- [CHANGELOG.md](CHANGELOG.md) -- notable changes ([Common Changelog](https://common-changelog.org/) format)
- [research/](research/) -- GRI UX analysis, layer inventory, MapX crosswalk, implementation patterns

## Status

**Planning** -- no code yet. Requirements gathering and research in progress. Dev setup instructions will be added when the build phase starts.
