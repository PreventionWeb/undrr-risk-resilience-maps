# Map viewer UX prototype handoff

Draft work parked on 14 November 2026. Start here when resuming. This branch
preserves two working experiments and the design-system notes; it is not a
proposal to replace the production viewer without further evaluation.

## Run and compare

Use the repository's Node version and installation instructions, then `yarn dev`.

| Route                           | Purpose                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/`                             | Existing viewer, retained as the baseline                                                                            |
| `/map-first.html`               | Latest proposed direction: open a featured map immediately, browse compact dataset rows and save variants separately |
| `/layer-workspace.html`         | Earlier stepper experiment: choose layers, then explore a map, compare or manage an explicit overlay stack           |
| `/layer-workspace.html?start=1` | Review the stepper's first-visit flow without changing its saved workspace                                           |

Each prototype has its own localStorage key. No prototype state should be migrated
into the production viewer as part of this draft. Explicit map-first links use
`?map=aal-to-gdp-2025:3`, for example.

## Working direction

The user's latest preference was to preserve the live viewer's immediate appeal:
a map loads and exploration can begin without understanding a catalogue first.
Astra reviewed the interaction code and configuration as a geospatial product
adviser. Its recommendation was map-first exploration with progressively revealed
analytical controls, rather than mandatory initial setup. That recommendation is
implemented at `/map-first.html`, alongside the earlier experiment for comparison.
It has not been validated with the intended audience.

Keep these distinctions when continuing:

- Viewing a map replaces the current indicator without saving it.
- Saving keeps an exact variant without changing the displayed indicator.
- My maps manages saved variants; comparison and downloads can use those variants.
- Country-level colour maps compare side by side with independent legends; alpha
  blending does not establish a meaningful analytical intersection.
- A new visitor should get a useful map and an understandable country/location
  result before needing stack ordering, opacity or scenario management.

## What is preserved

- The two standalone HTML entries and their isolated scripts/styles.
- Live MapX setup, legends, country/location inspection and source metadata.
- Variant selection, independent saving, linked comparison and download review.
- The earlier prototype's ordering, opacity and Escape-safe step navigation.
- Three real-map thumbnail captures, with source/provenance notes.
- Mangrove/UNDRR alignment records and potential upstream patterns. No upstream
  issue trackers were opened for these design ideas.
- Browser regression tests with the shared MapX stub.

## Read next

- [Map-first implementation and limits](map-first-prototype.md).
- [Layer-workspace implementation and limits](layer-workspace-preview.md).
- [Mangrove and UNDRR alignment](mangrove-alignment.md).
- [Mangrove upstream candidates](mangrove-upstream-candidates.md).
- [Thumbnail provenance and refresh instructions](../public/preview-thumbnails/README.md).

## Before treating this as a production change

1. Test the three core tasks with likely audiences: find and interpret a country
   value; compare two named variants; save maps and download a variant not shown.
2. Verify featured-indicator selection and explanatory copy with the provider.
   The map-first default is modelled earthquake average annual loss as a share of
   GDP, with the configured 2025 baseline. It is not an overall risk score or a
   record of observed losses in 2025. Early-warning coverage was deliberately not
   chosen as the default because its local status/description needed review.
3. Reconcile the experiments with current production behaviour. Recent main
   changes include structured legend APIs, resource/share modals, interaction
   policy and inventory updates. The parked draft updates both previews to the current structured-legend
   contract through a small manager-specific adapter, with image fallback. The
   prototypes still use their own orchestration and do not automatically inherit
   every other production feature or fix.
4. Review data inspection beyond the default GDP family. The map-first prototype
   recognizes a small set of primary value attributes; it does not infer arbitrary
   country aggregates. Country lookup is limited to reviewed regional CSV sources.
5. Define production compatibility rules and external-provider support. Dynamic
   EDRA layers are omitted. The map-first experiment deliberately omits overlay
   stacking, while the earlier prototype retains it for evaluation.
6. Replace the comparison camera polling with a supported event-driven integration
   if available. Audit focus, responsive layouts, third-party frame accessibility,
   localization, failure recovery and network behaviour before adopting either UI.
7. Decide whether experimental pages should remain build entries. They currently
   ship in `dist` when built, but the default viewer route is unchanged. No
   deployment is part of this draft.

## Checks

Run the repository-required lint, unit suite and build. For the experiment-specific
browser guarantees:

```sh
E2E_PORT=3054 yarn test:e2e tests/e2e/map-first.spec.js tests/e2e/layer-workspace.spec.js --workers=2
```

The browser suite stubs MapX and must not contact upstream map/data services.
Previous live inspection checked the default map, Kenya lookup, legends and
comparison; those checks do not substitute for current provider or audience review.
The draft PR records the validation performed when parking this work.
