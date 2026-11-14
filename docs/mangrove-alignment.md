# Mangrove and UNDRR alignment

Checked 7 November 2026 for the isolated layer-workspace preview. The default
viewer, registry, scientific values, legend colours and source attribution remain
outside this change. No upstream trackers have been opened.

## Reference and release boundary

The preview pins CSS to **Mangrove 2.3.0**. Component discovery used the published
[index](https://mangrove.undrr.org/ai-components/index.json), following its actual
`detailsUrl` values rather than guessing component identifiers. Markup and CSS
availability were checked against the pinned stylesheet. Current documentation
can describe features that are not present in that release.

Sources:

- [Mangrove guide](https://mangrove.undrr.org/llms.txt), including component selection, token wrapping, font roles and icon-button contracts.
- [UNDRR asset library guidance](https://assets.undrr.org/AGENTS.md) and [static shell recipe](https://assets.undrr.org/mangrove/static-shell.md).
- [Theme token dictionary](https://mangrove.undrr.org/tokens.json) and [utility inventory](https://mangrove.undrr.org/ai-components/utilities.json).
- [Editorial manual](https://mangrove.undrr.org/llms-editorial-manual.txt), [writing guide index](https://assets.undrr.org/docs/editorial-guides/README.md) and [writing assistant instructions](https://assets.undrr.org/docs/editorial-guides/ai-agent-instructions.md).

This is a vanilla application preview. Drupal block markup, syndicated search
configuration and taxonomy IDs are not involved; the existing layer registry
supplies the data categories.

## Section-to-component map

| Preview section                                 | Contract adopted                                                                                                                                                | Local responsibility                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Organization header                             | [PageHeader](https://mangrove.undrr.org/ai-components/components-pageheader.json): four-colour decoration, toolbar wrapper, logo region and canonical logo link | App identity and return link sit in a separate bar; no invented PageHeader title slot         |
| Preview label                                   | [Tag](https://mangrove.undrr.org/ai-components/components-tag.json), outline variant                                                                            | Application environment wording                                                               |
| Primary actions and variant additions           | [Buttons](https://mangrove.undrr.org/ai-components/components-buttons-buttons.json), primary and outline variants                                               | Event handling and exact selected variant                                                     |
| Visibility, move and close controls             | Standalone `.mg-icon-button` from Buttons; official icon masks                                                                                                  | Accessible action names and reorder logic                                                     |
| Display choice                                  | [SegmentedControl](https://mangrove.undrr.org/ai-components/components-forms-segmented-control.json), native radio inputs in a labelled fieldset                | Map mode and placement beside the affected collection                                         |
| Opacity                                         | [Range](https://mangrove.undrr.org/ai-components/components-forms-range.json), native range input                                                               | Per-variant value, output and MapX update                                                     |
| Comparison selectors                            | [Select](https://mangrove.undrr.org/ai-components/components-forms-select.json)                                                                                 | Source options and camera coordination                                                        |
| Loading, visible and failed state               | [StatusLabel](https://mangrove.undrr.org/ai-components/components-status-label.json), indicator plus text                                                       | Honest operation state; indicators are decorative                                             |
| Empty workspace and no matching layers          | [EmptyState](https://mangrove.undrr.org/ai-components/components-empty-state.json), compact composition                                                         | Context and recovery copy                                                                     |
| Search and category filters                     | Published form input and outline buttons                                                                                                                        | Local catalogue search; this is not a syndicated search widget                                |
| Layer selection                                 | Inline catalogue and semantic ordered step navigation with published Buttons                                                                                    | Draft selections, current-step state, search and an explicit transition to the map            |
| Download review                                 | Native `<dialog>`                                                                                                                                               | Modal lifecycle, focus return and selected variants                                           |
| Starter map previews                            | Local image-card composition and published Buttons                                                                                                              | Full uncropped maps preserve the legend and attribution; no photo-crop or stretched card link |
| Sidebar, configurable cards and canvas surfaces | Custom application composition using theme tokens                                                                                                               | Collection state, ordering, canvas geometry and responsive layout                             |

**Dialog availability:** the [current Dialog manifest](https://mangrove.undrr.org/ai-components/components-dialog.json)
explicitly says the component is unreleased/build-only and not available in
published 2.3.0 CSS or JavaScript. The preview therefore retains a native dialog for download review
and the existing download progress flow. Layer selection is an inline page step,
not a modal. It does not invent a CDN Dialog import or
claim the library component has been adopted.

**Grip icon:** the pinned release has no six-dot reorder grip. The preview supplies
that SVG through the documented `--mg-icon-svg` artwork hook. Other icons use
verified names from [the icon inventory](https://mangrove.undrr.org/ai-components/components-icons.json)
and the pinned stylesheet. The hidden-eye slash is a local decorative treatment;
the button state and adjacent text carry its meaning.

## Tokens and presentation

- Interface colours come from Mangrove theme properties. sRGB channel tokens use
  `rgb(var(...))`; complete expressions, including the modal scrim, are used directly.
- UI, heading and text roles come from the published font roles. No face is named
  by the preview stylesheet; the theme owns script routing.
- Spacing, radius, surface emphasis, motion and focus use published tokens or
  component hooks. Custom workspace geometry remains application-specific.
- CSS uses logical padding, margins, sizes and placement. Compare panes identify
  left and right maps in the English UI; translating those labels remains product work.
- No forced uppercase styling or emoji controls remain. The canonical four-colour
  header replaces the original single red rule and custom black bar.
- Focus remains visible, targets remain usable without dragging and forced-colour
  styles identify selected cards. Native radios supply arrow-key navigation.
- Legend swatch colours come from the scientific source and are deliberately not
  replaced with interface palette colours.

## Editorial decisions

Headings and application-authored labels use sentence case. Actions name what they
do: Add layers, Download data, Settings, Remove and Clear all. The catalogue uses
British English and explanatory copy uses “colours” and “Licence”. The first-use
hint names the visibility button rather than relying on its pictogram alone.

The UI expands average annual loss and probable maximum loss in the GDP indicator
labels. These display aliases do not change registry identifiers, exported source
metadata or data attribution. Source-authored dataset titles and descriptions are
retained where no reviewed UI alias exists; they should be edited through the
inventory process if a broader editorial pass is requested.

The asset-library requirement for sentence case without forced uppercase styling
wins over the editorial manual's allowance for uppercase presentation.

## Remaining upstream candidates

See [Mangrove upstream candidates](mangrove-upstream-candidates.md). The clearest
unresolved needs are an approved application-header composition, an accessible
reorderable collection pattern and a documented step-navigation composition. SegmentedControl, buttons, status indicators and
empty states are existing primitives, not new library gaps.

This is an alignment pass on a prototype, not a claim of complete accessibility
conformance. Verification covers the preview's own UI. Third-party MapX frames,
source metadata and production integration need their own review.
