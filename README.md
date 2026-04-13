# UNDRR Risk to Resilience Maps

A MapX-based geospatial explorer for UNDRR. Replicates the [GRI Risk Viewer](https://global.infrastructureresilience.org) interaction model with UNDRR branding, tied to the Risk & Resilience Metrics framework. See [PRD.md](PRD.md) for requirements, scope, and timeline.

## Preview access

The app is protected by a PIN gate to keep out casual visitors and signal that this is a work-in-progress prototype.

**PIN: `5498`**

The gate stores auth state in `sessionStorage`, so it only asks once per browser tab session. This is not a security mechanism — it is purely a soft barrier to set expectations for reviewers.

## Developing

```bash
npm install
npm run dev        # Vite dev server at http://localhost:3001
npm run build      # Production build to dist/
npm run preview    # Preview production build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow conventions (PRs, conventional commits, changelog).

### Claude Code

When working in this repo with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), use the **MapX SDK skill** (`/mapx-sdk-dev`) for MapX embedding, view management, or SDK integration. It has current reference material for the SDK's postMessage bridge, view queries, and map controls.

### Project documentation

Keep these files updated as the project evolves:

- [PRD.md](PRD.md) -- product requirements, scope, blockers, and timeline
- [ARCHITECTURE.md](ARCHITECTURE.md) -- system design and technical decisions
- [METHODOLOGY.md](METHODOLOGY.md) -- MapX API/SDK discovery approach and research methods
- [CHANGELOG.md](CHANGELOG.md) -- notable changes ([Common Changelog](https://common-changelog.org/) format)
- [research/](research/) -- GRI UX analysis, layer inventory, MapX crosswalk, implementation patterns

## URL routing

The app uses hash-based routing (`#hazard`, `#exposure`, `#guide`, etc.) so that links are shareable and browser back/forward works. All tabs share a single page and MapX iframe -- this keeps navigation instant since the SDK stays connected.

Info pages (home, guide, sources, downloads) currently use the same hash routing. If SEO becomes a priority post-launch, those could be broken out into separate HTML pages via Vite MPA mode without affecting the map tabs.

## Status

**MVP scaffold** -- working app with MapX SDK integration, Mangrove nav bar with category tabs, floating layer panel with accordion controls, per-layer opacity sliders, legend rendering, and feature click popups. See [CHANGELOG.md](CHANGELOG.md) for details.

## Roadmap note

This repository currently focuses on the **map explorer**: category tabs, layer inventory, MapX integration, legends, and interaction patterns.

A future **indicator / chart surface** is expected to complement the map experience, especially for resilience-oriented content. That work is expected to live outside this repository. Where useful, this map app may later link out to related country pages, indicator views, or embedded summaries, but this repo remains the source of truth for the map layer experience itself.

During prototyping, some configured layers may carry unpublished states such as **Disabled**, **Awaiting data**, or **Pending removal**. These layers are not published in the map explorer, but they remain in the Sources page and CSV inventory so stakeholders can review, reinstate, or remove them later. A **Show disabled** control in the layer panel exposes those entries for review without turning them into active map layers.
