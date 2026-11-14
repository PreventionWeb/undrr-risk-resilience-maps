# Mangrove candidates from the layer workspace

Working notes, 7 November 2026. These are proposals for consideration; no trackers
have been opened and no Mangrove implementation is requested yet.

The reference is [the local interaction preview](../layer-workspace.html), with
[its implementation notes](layer-workspace-preview.md). Source selectors below
refer to `src/preview/layer-workspace.css` and `src/preview/layer-workspace.js`.
The visual treatment is provisional: capture the reusable need before adopting
its exact spacing, colours or markup.

## What was checked

Compared against the local Mangrove checkout `undrr-mangrove-1448` at
`2558b80b` (7 November 2026), specifically PageHeader, SegmentedControl, Dialog,
Cards, Chips, Tag and StatusLabel documentation and the component inventory.
This is a source comparison, not an exhaustive audit of every branch, Figma
component, published bundle or open issue. The preview loads Mangrove CSS 2.3.0;
that version and the inspected source do not necessarily expose the same features.

Existing components are linked to their published manifests. The source comparison
above is retained for provenance; release availability is governed by those manifests
and the pinned stylesheet. See [the alignment record](mangrove-alignment.md). Proposed names below are descriptive,
not agreed component names or APIs.

## Shortlist

| Priority | Candidate                                         | Recommended home                                               | Existing foundation                                                                           |
| -------- | ------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| First    | Application variant of the UNDRR black bar        | PageHeader extension, with app-shell example                   | PageHeader already owns branding and language/account controls                                |
| First    | Reorderable collection and grab handle            | Reusable behaviour + collection-row styling                    | Buttons, icons and focus treatments; validate existing collection experiments before building |
| First    | Configurable item in a working collection         | Composition pattern before a generic component                 | Cards, disclosure, Range, buttons and StatusLabel                                             |
| Next     | Workspace shell with inspector sidebar and canvas | Layout pattern                                                 | Existing layout and surface tokens                                                            |
| Next     | Catalog that adds several independent variants    | Composition recipe using Dialog                                | Dialog, Search, Chips, buttons and selection semantics                                        |
| Next     | Mode selector placement and context               | SegmentedControl usage guidance; possible quiet visual variant | SegmentedControl already exists                                                               |
| Later    | Selected-item download review                     | Dialog recipe                                                  | Existing Dialog, file links and progress components                                           |
| Later    | Canvas label and contextual legend surface        | Overlay-surface recipe if another product needs it             | Cards and existing surface tokens                                                             |

## 1. Application black bar

**Observed:** the original `.workspace-brand` put organizational identity, application name,
an environment label and a return link on one dark horizontal bar. It gives a
focused tool an identity without requiring a full website navigation header.

**Existing foundation:** [PageHeader](https://mangrove.undrr.org/ai-components/components-pageheader.json)
already supplies the dark branded toolbar, logo, language/account controls,
responsive behaviour and four-colour decoration. Its inspected public API does not
have explicit application-title, environment-label or application-action slots.

**Candidate:** extend PageHeader with a documented application composition and
well-defined content slots. Establish where language/account controls belong when
an application action is present. Give long application names and narrow containers
a deliberate wrapping/priority policy; avoid hard-coded logo dimensions.

**Alignment update:** the published PageHeader contract requires the canonical
structure and four-colour signature. The preview now uses that header unchanged
and places the application identity in a separate `.workspace-app-bar`. The
original single-red-rule treatment is retired. Any combined application variant
would need an explicit upstream extension of the branding contract. Keep navigation, logo links, localization,
RTL, zoom and skip-link behaviour consistent with the existing header contract.

## 2. Grab handle and reorderable collection

**Observed:** `.drag-handle`, `.is-dragging`, `.is-drop-target` and the up/down
buttons make list position directly manipulable. In this product, top of list
means top of map. The same behaviour could serve dashboard widgets, selected
resources, slides or ordered form sections.

**Candidate:** one coherent reorder pattern, not just a six-dot icon. Specify:

- Resting, hover, focus, grabbed, valid target, invalid target and disabled states.
- A sufficient pointer/touch target, clear insertion position and auto-scroll.
- Keyboard and single-pointer alternatives to dragging; visible move actions or
  an accessible move menu. Do not require dragging to complete the task.
- Focus preservation after a move and an announcement identifying the item and
  its new position, including boundaries such as first/last item.
- Logical direction, touch scrolling and operation in long collections.

Keep the ordering callback and data model independent of MapX. Check any existing
React Aria/collection experiments before choosing an implementation. The preview's
native HTML drag behaviour and up/down buttons are a proof of the interaction;
they do not establish a finished touch or keyboard-drag contract.

## 3. Configurable collection item

**Observed:** `.layer-card` combines category, item title, exact variant, visibility,
status, ordering actions and a Settings disclosure. Its expanded area adds a range
control, explanation, attribution, another-variant action and removal.

**Candidate:** a composition recipe for an item in a working collection, useful
beyond maps. Start by composing existing components, then extract a shared component
only if repeated implementations need a stable API.

The reusable contract should distinguish **collected**, **displayed**, **focused**,
**loading** and **failed**. A highlighted border alone should not carry the state.
The preview currently uses different actions in different modes; document stable
accessible names and an explicit policy for disabled/selected actions. Keep row
selection separate from buttons inside the row; avoid a clickable card enclosing
other interactive controls. Disclosure should preserve input and focus state.

Do not upstream the geography, hazard, scenario or layer-engine model with it.

## 4. Application workspace layout

**Observed:** `.workspace-shell`, `.workspace-sidebar`, `.workspace-stage` and
`.workspace-bottom` provide a scrollable working collection, flexible canvas and
persistent secondary action. The canvas can hold one or two views.

**Candidate:** an application-shell layout example with defined scrolling ownership,
minimum canvas size, persistent-action placement and responsive behaviour. It should
work for maps, editors and analysis tools without prescribing their business logic.

The preview uses a fixed desktop sidebar and custom breakpoints. Before adoption,
check long lists, translations, 200% zoom, small screens, RTL and whether the footer
remains available when settings expand. Do not standardize these exact dimensions.

## 5. Add-from-catalogue dialog

**Observed:** `.catalog-dialog` has search, category filters, dataset descriptions,
independent variant-add buttons and a running collection count. A user can add
several items without repeatedly opening and closing the dialog. New visitors
now start with an empty workspace and a suggested-map gallery using static
screenshots. The gallery is a catalogue composition, not a proposed new thumbnail
component. Images must show the exact variant, preserve source attribution and
remain optional: search and the complete list are available alongside them.

**Existing foundation:** [Dialog](https://mangrove.undrr.org/ai-components/components-dialog.json)
defines bounded modal scrolling, dismissal, focus restoration and native
HTML/vanilla enhancement behaviour. Its published manifest explicitly marks it
unreleased/build-only and unavailable in pinned 2.3.0 CSS and JavaScript. Retain
the local native dialog until a released version can supply it. Search, Chips and buttons are also existing
building blocks.

**Candidate:** a recipe for adding resources to a persistent collection. Specify
immediate-add versus staged selection, duplicate prevention, confirmation feedback,
empty/no-match states and preservation of search, scroll and keyboard focus.
An already-added variant needs a clear state and action policy.

The gap is the composition and interaction contract, not a new modal, search input
or filter-chip component. Reuse their existing contracts instead of copying the
preview's custom dialog and button markup wholesale.

## 6. Mode selector: existing control, new placement lesson

**Observed:** `.view-switch` originally sat above the map, detached from the list.
The user, who knows this application well, reported taking roughly ten seconds
to understand what “View one” controlled. A pleasant default appearance did not
make the relationship apparent.

**Local revision:** move the choices directly above the layer list, visibly label
them **Map display**, rename the first choice **One layer** and put contextual
instructions immediately below. On narrow screens place that group immediately
above the canvas so it remains available before the scrollable collection.
This is a proposed response to the feedback, not yet a validated usability result.

**Existing foundation:** [SegmentedControl](https://mangrove.undrr.org/ai-components/components-forms-segmented-control.json)
already covers mutually exclusive changes to one view, with native radio-group
semantics. The aligned preview now uses the shipped native radio markup, a visible legend
and native arrow-key selection. The earlier pressed-button implementation is retired.

**Candidate:** guidance and a workspace example showing the control next to the
objects/view it affects, with a visible group label and explicit selected state.
Consider a quiet, inset treatment only if the existing visual variants cannot
cover the use case. This does not justify another tabs or button-group component.

## 7. Download-review dialog

**Observed:** `.download-results` names exact variants and offers individual
reviewed downloads, even when a variant is hidden on the map.

**Candidate:** a selected-resource review recipe with identity, variant, availability,
format/size and per-item action. Keep selected-for-export and displayed-on-canvas
as independent concepts. Batch archives, job progress, cancellation and partial
failure should be designed only if a consuming product needs them; this preview
provides individual downloads, not a batch-export implementation.

Reuse Dialog and established progress/error components. Keep CSV eligibility,
source-specific licensing and MapX download preparation in the application.

## 8. Canvas labels and legend surfaces

**Observed:** `.map-label` and `.map-legend` provide named, readable surfaces on a
busy map, with a selector and separate legend for each comparison pane.

**Candidate:** document placement, surface contrast, maximum width/height, scrolling,
and pointer behaviour for contextual controls on canvases. Keep attribution and
native navigation available. Test a second consumer before creating an overlay API.

The label/legend surface may generalize; geographic legends, alpha compositing,
camera synchronization and spatial intersection remain product/domain concerns.

## Existing pieces to reuse

Range, Select, buttons and icon buttons, Tag/StatusLabel, Chips, Dialog and
SegmentedControl are foundations, not newly discovered library gaps. The preview's
counts, environment tag, status dots, settings disclosure and opacity controls
should be mapped onto those contracts where they fit. Use official icons instead
of the prototype's Unicode symbols.

The aligned preview now uses Mangrove theme tokens, font roles, logical CSS
properties and official icon masks. The six-dot grip uses the documented
`--mg-icon-svg` hook because that artwork is absent from the pinned icon set.
A future upstream contribution should preserve these contracts and include vanilla
HTML as well as any React examples. Document the state contract and responsive behaviour in
Storybook and keep the AI manifest/Figma library aligned with the agreed scope.

The strongest starting pair is the application-header extension and the accessible
reorder pattern. Prove those independently before proposing the whole workspace as
a single large component.

## Follow-up: inline selection and map steps

The first-visit catalogue was initially a modal. Pressing Escape exposed a blank
workspace before any layer had been chosen. Blocking Escape would preserve the
wrong abstraction: choosing data is the start of the task, not an interruption.

The preview now uses **Choose layers → Explore map** as ordinary page steps. The
stepper is a labelled navigation landmark with an ordered list and native buttons.
The current button carries `aria-current="step"`; Explore map is disabled until
at least one layer is selected. Returning to Choose layers preserves the selection.
Draft selections and the current step survive reloads. Clearing all layers returns
to the chooser. No dialog is involved in layer selection; download review remains
a modal operation.

This is another composition candidate for Mangrove: document state, completion
requirements, focus placement, revisiting earlier steps and narrow layouts. The
current index lists ProgressBar, which represents measured progress and is not a
step-navigation component. Do not substitute it or invent a shipped Stepper API.
