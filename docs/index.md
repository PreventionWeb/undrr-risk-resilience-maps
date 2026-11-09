# Documentation

Start with the [README](../README.md) to open the viewer or run it locally.
Choose a guide below for the task you need to complete.

## Use and maintain the viewer

| Task                                            | Guide                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Update layer metadata and MapX IDs              | [Layer inventory](inventory.md)                                                       |
| Put a map on another website                    | [Embedding: snippet, parameters and message API](embedding.md#8-how-to-embed-phase-1) |
| Download map data or maintain download metadata | [Data downloads](downloads.md)                                                        |
| Build and host a release                        | [Deployment](deployment.md) and [release steps](../CONTRIBUTING.md#releasing)         |
| Run checks or submit a change                   | [Contributing](../CONTRIBUTING.md)                                                    |

## Understand the implementation

- [Architecture](../ARCHITECTURE.md): module boundaries, state, routing, UI, build and testing.
- [Legends](legends.md): adapters, upstream contracts, fallback behavior and regression QA.
- [External runtime layers](external-layers.md): source tracker, governance and production acceptance.
- [Performance](performance.md): measured bottlenecks and improvements, with their test conditions.
- [Embedding design and roadmap](embedding.md#design-history-and-roadmap): the original proposal,
  refactor constraints and conditional future modes. The current host instructions come first.
- [ADR 0001](adr/0001-structured-legends.md): the structured-legend decision and review triggers.
- [Learnings](../LEARNINGS.md): SDK quirks and dated integration findings.

## Review scope and future work

[Product specification](product-spec.md) defines the proposed V1 scope and still requires
stakeholder review. [Resourcing](resourcing-plan.md) holds work packages, estimates and risks;
[TODO](../TODO.md) holds deferred technical work. Implemented prototype behavior does not
establish scope approval. [CHANGELOG](../CHANGELOG.md) records notable shipped changes.

## Discovery and evidence

- [Archived PRD](../PRD.md): original discovery/build requirements, superseded by the product specification.
- [Methodology](../METHODOLOGY.md): view-ID discovery methods and research-phase API observations.
- Archived GRI research: [UX analysis](../research/gri-ux-analysis.md),
  [layer inventory](../research/gri-layer-inventory.md),
  [MapX crosswalk](../research/gri-mapx-crosswalk.csv) and
  [implementation patterns](../research/implementation-patterns.md).

The maintained layer inventory is [data/inventory.csv](../data/inventory.csv).
Research dumps and dated findings retain their original conditions; they are not current
setup instructions. Keep raw research and sanitized fixtures intact when editing guidance.
