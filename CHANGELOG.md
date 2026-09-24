# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

## [Unreleased]

### Changed

- Upgraded the UNDRR Mangrove component library from `2.0.0-rc.3` to `2.0.0` stable across the stylesheet, `preview-access.js`, `tabs.js`, and `copy-button.js` CDN loaders.
- Adopted Mangrove 2.0's native `--mg-switch-size` token for the layer panel review toggle, eliminating bespoke switch geometry overrides.
- Applied Mangrove 2.0's `.mg-content` pattern to editorial and information reading panels.
- Aligned user-facing copy and punctuation with the Mangrove Editorial Manual and UN style:
  - Renamed the "Show disabled" toggle to "Show unpublished" for clarity and alignment with UN disability-inclusive terminology guidelines.
  - Removed serial (Oxford) commas in running text across information panels.
  - Replaced em dashes (`—`) with colons or spaced en dashes (`–`) per UN editorial standards.
  - Spelled out "Risk and Resilience" in body prose while retaining ampersand in UI chrome and proper titles.
  - Standardized "decision-makers" and hero intro copy.

## [0.0.5] - 2026-09-21

### Added

- A dedicated **GAR (Global Assessment Report)** tab and category. The September 2026 layer inventory adds five Global Assessment Report layers to the map under the UNDRR project, accessible via the new GAR navigation tab and an explore card on the home page:
  - _Water scarcity and child nutrition_ (`water-scarcity-child-nutrition`, custom-coded live view)
  - _Human Fatalities Global seismic risk_ (`fatalities-gem`, vector polygon view)
  - _Economic Losses Global seismic risk_ (`ecolosses-gem`, vector polygon view)
  - _Disasters and IDP_ (`disasters-idp`, custom-coded live view)
  - _SDG15.3.1 and Drought frequency_ (`sdg-drought`, raster view)

  In the layer panel, GAR maps are organized into collapsible sections by publication year (e.g. _GAR 2025_) rather than thematic groups ([#36](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/36)).

- **Layer collection isolation**: GAR maps and the Risk & Resilience (R2R) map sets are completely separated and cannot be combined on screen or in shared links. Turning on a GAR map automatically deactivates and removes all active R2R layers before the new layer mounts; opening an R2R map does the same in reverse. In the layer panel, cross-tab sections show other categories only from within the same collection. In shared links and embedded maps, layers from an incompatible collection are cleanly rejected with a console notice, and back/forward navigation safely transitions between collections without leaving orphaned views ([#36](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/36)).

### Changed

- Upgraded the UNDRR Mangrove component library from `2.0.0-rc.2` to `2.0.0-rc.3` across the stylesheet, `preview-access.js`, `tabs.js`, and `copy-button.js` CDN loaders ([#36](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/36)).
- The layer registry and layer controller track collection membership as a first-class property (`r2r` or `gar`), ensuring consistent collection scoping across the layer panel, the router, and the embed bridge ([#36](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/36)).

## [0.0.4] - 2026-09-18

### Added

- The map can be placed inside another site. `embed.html` is a version of the viewer built for an iframe: the same map, layer panel and category tabs, without the page header, the information pages or the syndicated footer, and with a small attribution line and a link that opens the full viewer on whatever is on screen. A host pastes one `<iframe>`; which category, which layers, which sources, which categories and layers are offered at all, and whether the layer panel starts collapsed, are all set in the embed's address. Names the map does not know are dropped, source numbers out of range are clamped, and the browser console lists what was not recognised — except where dropping everything would silently do the opposite of what the address asked: an address that offers a list of categories or layers and names nothing the map knows shows a short notice saying so, instead of falling back to offering all of them. Nothing a visitor does inside the frame reaches the host page's address or its Back button ([#31](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/31)).
- While this is a prototype, an embedded map asks for the same PIN as the viewer itself. The embed is published to the open web and the hosting cannot yet tell browsers which sites may frame it, so without the PIN any site could have put the prototype, UNDRR logo and all, on its own pages. Someone reading a host page enters the PIN inside the frame, and the unlock lasts for that browser tab. Whether unlocking the full viewer also unlocks an embed of it depends on how the browser separates a framed page's storage, so the same person may be asked in both places. Until the PIN is entered the map and the layer panel cannot be seen, clicked or reached by keyboard, and the host page is told the map is locked but is refused everything else — it cannot drive a map its visitor has not been let into. The "Open the full viewer" link lands on the viewer, which asks for the same PIN ([#31](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/31)).
- A host page can talk to an embedded map, and only its own host page can: it is told when the map is ready and whenever what is shown changes, it can ask for a category or a set of layers, ask what is currently shown, and be told if a layer or the map service fails. Every message says which version of that conversation it speaks, and an embed accepts instructions only from the page that frames it — another widget on the same page cannot drive it. A host that names the framing site in the embed's address and gets it wrong leaves the embed silent in both directions rather than falling back to a looser rule; an instruction to show something that is not a list of layers is refused rather than read as "turn everything off"; and a host talking a version the embed does not know is told so once rather than once per message ([#31](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/31)).
- An embed records that it loaded and which site it is running in, so we can see where the map is being used. There is no analytics platform in the project yet, so the event is written to the browser console until one is chosen ([#31](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/31)).

### Fixed

- An embedded map no longer carries a "This embed has no layers to show" warning above it. The notice is meant for an embed whose address names nothing the map knows; it is marked hidden, but the design system gives that kind of notice a layout of its own, which overrode the browser's rule for hidden things, so every embed showed the warning over its own map and tabs ([#33](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/33)).
- A host page is no longer told an embedded map has been unlocked while it is still asking for its PIN. The message that says the map is ready assumed the PIN had been entered rather than asking the gate, so a host that framed a locked embed could be told otherwise. Nothing was drivable either way — a locked embed refuses every instruction — but what the host was told is now read from the gate ([#33](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/33)).
- "The map is temporarily unavailable" no longer appears on a working map service. MapX loads in a cross-origin iframe, and a browser stops that iframe making any progress while it is not being painted — which is what happens behind the preview PIN gate and while the tab is in the background. The map also keeps loading out of sight behind the home, Sources and About pages, and that is the reader's time rather than the map's. The 30-second limit counted all of it, so leaving the page open for half a minute was enough to be told the map had failed, and on a slow connection the warning was already waiting the first time a data tab was opened, for a map that was still loading perfectly well (measured on a 400 kbps link: the warning armed at 78s for a map that became ready at 174s). The limit now counts only the time in which the map is the view you are on, which is 1-4 seconds for a real cold load. The automatic retry countdown pauses for the same reason, and never reloads the page while you are reading one of the information pages ([#24](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/24), [#30](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/30)).
- The map's loading limit is counted in real elapsed time rather than in timer ticks, which a busy browser coalesces, and it stops judging a load it has been counting for a quarter of an hour ([#30](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/30)).
- A page with no map in it can no longer reload itself on the map service's retry countdown ([#30](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/30)).
- A screen reader now hears a layer's loading or failure message once. A layer appears in its own category and in every other category's cross-tab list, and each of those rows said the same thing, so the message was read out several times ([#25](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/25)).
- When two layers have something to say at the same time — both failing, or a shared link opening both while the map service is down — a screen reader now hears both. The second message replaced the first, and one layer finishing could also take another layer's "Loading…" away before it was read ([#25](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/25)).
- The opacity slider under a layer had no name a screen reader could use: it sat next to the word "Opacity" but nothing tied the two together (axe reported a critical `label` violation on every layer that was on). It is now named "Opacity" and reads its value as a percentage ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- The category navigation is announced as links again. It claimed to be a menu bar, which promises arrow-key navigation the app does not implement and stops the eight links being announced as links. The link for the page you are on now says so ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- The map itself had no name, so a screen reader listed it as an unnamed frame ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- The "Show MapX view IDs" switch on the Sources page was almost invisible when off: neither its own knob nor its outline against the blue banner reached the minimum contrast a control needs ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- The site inspector's "no data" dot was too faint to see (1.9:1 where 3:1 is the minimum). It is now a ring rather than a filled dot, so the two states differ in shape as well as colour ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- Links inside the text on the About and Sources pages are underlined. Colour alone marked them, and UNDRR blue against the body text is 2.1:1 ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- The smaller switch in the layer panel header would have moved its knob the wrong way in a right-to-left language. In Windows High Contrast mode it also pushed the knob flush with the edge of its track, because the mode adds a border the knob's travel did not allow for ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- Layers shown by "Show disabled" are readable again: the whole row used to be dimmed with a transparency, which took its name and badge below the minimum text contrast (axe reported `color-contrast` on four more rows). The row is greyed with colours instead, and its badge says "not published" rather than the layer type ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- The "Show disabled" switch's off state, the type badge's size, and the focus ring on a switch whose last load failed all met less than the minimum contrast, size or visibility they needed ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- A screen reader is told when a layer starts and stops loading. The switch says so in its name, but the same attribute that draws the spinner also stops assistive technology reporting changes there, so the row's live region says it instead ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- An external layer such as EDRA that fails to load after being opened from the row's expand control now shows the failure in the row, instead of only speaking it ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- A layer's switch is no longer nested inside the row's expand control, which meant screen readers and other assistive technology could not present either of them reliably (axe reported `nested-interactive`). The row now has an expand button and a switch side by side; Enter and Space act on whichever one is focused ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- The layer type badge for raster layers no longer falls below the minimum text contrast (axe reported `color-contrast` on six rows in the Hazard tab) ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- Dragging the layer panel by its header no longer swallows clicks on controls that are labelled rather than clicked directly, such as a switch's track ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- Moving a layer's opacity slider while the same layer's slider in another tab is still loading no longer gets overwritten when that slider finishes loading ([#19](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/19)).
- Rapid clicks now honour the last action for every kind of layer: double-clicking a switch leaves the layer off, clicking a source and then another quickly ends on the second one (the switcher, map, legend and link agree), and an external layer such as EDRA can be turned off while it is still loading ([#18](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/18)).
- "Clear all" now also turns off layers that are still loading, and is shown as soon as a layer starts loading ([#18](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/18)).
- Enter and Space on a layer's switch in the layer list now turn the layer on or off. Before, the key press opened or closed the layer's row instead, so keyboard users could not turn a layer off from its switch ([#18](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/18)).
- Screen readers now hear when a layer fails to load, turn off or change source, and a switch whose layer is still loading is announced as busy ("Loading …") ([#18](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/18)).
- A source switcher (sub-tabs, dropdown or stepped slider) now snaps back to the source shown on the map when a switch fails ([#14](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/14), [#18](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/18)).
- Clicking "Citation and methodology details", the Acknowledgements "Sources" link, or any link to an in-page anchor no longer turns off every active layer ([#16](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/16)).
- If MapX fails to remove a layer, its switch now stays on (and it stays in the shareable link) instead of showing as off while the layer is still on the map ([#16](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/16)).
- Opening a shared link, pressing Back/Forward, or clicking "Clear all" no longer adds extra browser history entries, so Back returns to the previous view instead of an intermediate state ([#14](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/14)).

### Changed

- The map is ready as soon as you open a category tab. It now loads quietly behind the home, Sources and About pages instead of waiting for the first tab click, so the two to three seconds that used to follow that click are gone. That happens only where it is worth its cost — the warm-up adds 47 requests and 4.3 MB to every visit, including a bounce — so it is skipped when the browser asks for reduced data, on a 2g connection, and on a narrow or touch screen, and it waits for an idle moment elsewhere. While it is out of sight the map is also out of reach: nothing inside it can be clicked, tabbed to or read by a screen reader, including panels the app adds after the page has loaded such as the site inspector, and in browsers that cannot make a region inert — Safari before 15.5, Firefox before April 2023 — it is hidden outright rather than left invisible. The bypass link at the top of the page says "Skip to content" and takes you to the page you are reading while there is no map to skip to, so it still skips the header and the category navigation. Opening a data tab works the same either way ([#24](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/24), [#30](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/30)).
- The "copy coordinates" control in the site inspector is Mangrove's copy button. It now says "Copied!" in a small tooltip when it works, tells a screen reader the same thing, and says so if the copy fails instead of doing nothing visible. It copies the same "latitude, longitude" text as before, and it keeps working when the design system's script cannot be fetched or has not arrived yet. The button is also a 36 × 36 px target where the old clipboard glyph was 27 × 18 px, below the 24 px minimum a control needs ([#27](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/27)).
- The group headings in the layer panel and the collapsed sections for other tabs use Mangrove's accordion. The heading is now a full-width row with a chevron on the right that turns as the section opens (the sections for other tabs had no chevron at all), it is 44 px tall (up from 36 px for a group heading and 42 px for another tab's section), and it shows a clear focus outline when you reach it with the keyboard ([#27](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/27)).
- The "map is temporarily unavailable" message is Mangrove's service-notice component: a soft wash over the map with the warning symbol, an "Offline" badge, the retry countdown and the two actions, without the component's hairline border, which framed the whole map rather than the message. It retries and recovers exactly as before ([#27](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/27)).
- The Sources tables are Mangrove's data-table styling: a compact grey header band in small caps in place of the dark blue one, quieter row dividers, and MapX view IDs in a monospaced column. A long table now scrolls inside its own region with the column headings pinned to the top, so you can still tell which column you are reading. Printing or saving the page to PDF still gives you the whole table, not the part that fitted on screen. (The blue band was the reason the MapX-ID heading needed a colour fix of its own; there is no band left to fix.) ([#27](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/27))
- The page header now matches Mangrove's own markup, including the logo's canonical address and a preload so it paints without waiting for the stylesheet. The close buttons on the infobox and site inspector, and the map-service notice's warning symbol, use Mangrove's icons instead of hand-drawn shapes and the `×` character ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- Every colour in the app's own stylesheets now comes from a Mangrove token rather than a hard-coded hex value, so a palette change reaches the whole app ([#22](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/22)).
- A layer that is slow to come on or go off now says so in writing: "Turning on" or "Turning off" appears under the row, in the wording Mangrove uses for a pending switch. It waits until the layer has been loading for almost half a second, so quick layers show only the spinner and nothing flickers, and a row that already shows its own loading message (an EDRA layer) is left as it is ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- Upgraded the UNDRR Mangrove component library from `2.0.0-rc.1` to `2.0.0-rc.2` across the stylesheet, `preview-access.js`, and `tabs.js` modules. rc.2 adds the `.mg-switch` pending and `aria-disabled` states, forced-colours support and `--mg-switch-*` custom properties; no classes or tokens we use were renamed or removed ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- Rebuilt every on/off control on Mangrove's switch component, so the layer switches, "Show disabled" and the Sources MapX-ID switch look and behave alike: a clear on/off track, a spinner ring while a layer loads (static when the browser asks for reduced motion), a red outline and message after a failed load, a dimmed state while the map is still starting up, and a 46 × 40 px hit target (44 px tall on touch) that is the same in the home tab and in cross-tab rows ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- A layer's switch is now announced by the layer's name, with its on/off state coming from the control instead of from wording that changed ("Turn on …" / "Turn off …"). It still says "Loading …" or "Turning off …" while the map is working ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- "Show disabled" is a switch instead of a button whose label flipped to "Hide disabled", and the layer panel's collapse button now says whether the panel is open and what the button will do next ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- The layer panel's remaining controls follow Mangrove too: the empty-category message uses the empty-state component, the source switcher uses the form label and select styles, layer type badges use the quieter subtle tag variant, and group headings, cross-tab sections and descriptions take their colours from Mangrove tokens instead of hard-coded greys ([#21](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/21)).
- An external layer such as EDRA now reopens with the crop or scenario it last showed when it is turned back on, as compound layers keep their last source. It used to reset to the provider defaults ([#18](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/18)).
- Load the EDRA external-layer adapter and its `proj4` dependency only when an EDRA layer is turned on, keeping 137 KB (46 KB gzipped) out of the JavaScript every visitor downloads, which is now 129 KB (40 KB gzipped) ([#14](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/14)).
- Request each MapX legend image once per view, and keep cross-tab row controls rendered while their tab is hidden instead of re-requesting them on every tab switch ([#14](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/14)).
- Turning a layer on from another tab's section of the layer panel no longer also loads its opacity and legend into its hidden home tab. They load when that tab is opened, saving a MapX transparency and legend request per activation ([#19](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/19)).
- The sidebar test suites no longer fail at random on a machine under load. Setting `location.hash` in the setup made jsdom queue a `hashchange` that could land in the middle of a later test and reconcile the sidebar back to an empty URL; tests waited a fixed number of event-loop turns for work whose cost depends on how busy the machine is; and vitest's 5 s default timeout was too tight for suites that chain dozens of turns per test. No production code changed ([#28](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/28)).

## [0.0.3] - 2026-09-17

### Fixed

- Show the description, opacity slider and legend for layers turned on from another pillar's section of the layer panel. Previously these rendered only in the layer's home tab, which is hidden, so nothing appeared ([#10](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/10)).
- Render a cross-tab row's legend and opacity slider only in the visible tab, instead of in every tab, to cut repeated MapX legend and transparency requests ([#12](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/12)).
- Show an external layer's loading and error messages in the cross-tab row it was turned on from ([#12](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/12)).
- Keep opacity sliders for the same layer in sync, and drop sliders whose slot was cleared before they finished loading ([#12](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/12)).
- Turning a compound layer off while it is switching source (for example with "Clear all" or Back) now turns it off once the switch settles, instead of leaving the new source on the map ([#12](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/12)).

### Added

- Add a `commit-msg` hook that rejects AI-assistant attribution trailers, enabled on `yarn install` ([#11](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/11)).

## [0.0.2] - 2026-09-17

### Changed

- Upgraded the UNDRR Mangrove component library from `2.0.0-alpha.4` to `2.0.0-rc.1` (via `2.0.0-beta.3`) across the stylesheet, `preview-access.js`, and `tabs.js` modules.
- Replaced custom `.skip-to-content` CSS with Mangrove's `.mg-skip-link` utility component, targeting `#app-map` with `tabindex="-1"`.
- Aligned Sources data table with Mangrove's accessible scroll pattern using `.mg-table-scroll-region` with `role="region"`, `aria-label="Dataset sources table"`, and `tabindex="0"`.
- Enhanced feature infobox attribute table with `<th scope="row">` for semantic key-value accessibility under `mg-table`.
- Derived local neutral tokens (`--color-text`, `--color-text-muted`, `--color-border`, `--color-border-light`) directly from Mangrove's `--mg-color-neutral-*` channels.
- Aligned layer panel focus rings and hover/active states with Mangrove tokens (`--mg-color-focus-ring`, `--mg-focus-ring-width`, and `rgb(var(--mg-color-blue-900) / 0.08)`).
- Separated hover and focus-visible states on Home category cards so focus outlines use Mangrove's high-contrast `--mg-color-focus-ring`.
- Adopted Mangrove's new `.mg-switch` pure CSS component (`.mg-switch__input`, `.mg-switch__track`, `.mg-switch__thumb`, `.mg-switch__label`) for the Sources page MapX view ID toggle, and aligned the layer accordion `.layer-eye` switch button styling with Mangrove's switch geometry and tokens.
- Adopted `.mg-range` and `.mg-range__ticks` across the layer opacity slider and compound-layer stepped return-period slider.
- Adopted `.mg-details` on the Sources page "Metrics under development" section. The compact layer-panel legend comparison keeps its local styling.
- Adopted `.mg-status-label` (`--waiting-information`, `--negative`, `--draft`) for planned-dataset status in the Sources data table.
- Inverted the `.mg-switch` checked track and focus ring on the blue Sources hero so both meet 3:1 contrast.
- Anchored stepped-slider tick labels to each slider stop so marks line up with the `.mg-range` thumb.
- Moved map toolbar buttons (panel collapse, site inspection, "Show disabled") onto Mangrove's `mg-button-primary mg-button-outline` variant, with `.mg-button--icon` / `.mg-button--icon--small` for the icon tools. Local CSS now only handles position, compact sizing, and the pressed/active state.
- Switched the map outage "Try again" action to `mg-button mg-button-primary`.

## [0.0.1] - 2026-09-09

### Added

- The UNDRR global footer now appears on the content pages (Home, Sources, About), syndicated from PreventionWeb via Mangrove's documented Footer embed so it stays current centrally. The map view stays full-bleed without it.
- The Sources page groups its five data categories into Mangrove 2.0 horizontal tabs, which collapse into stacked disclosures below 480px. This loads Mangrove's `js/tabs.js` behaviour script — the first JavaScript we take from the library. Without it the panels render in sequence, as before.

- MapX startup failures now produce an accessible in-page service notice with manual retry, a visible 60-second automatic-retry countdown, and an availability link. Separate bounded checks cover SDK download or construction failures and an embedded map that never becomes ready. Countdown updates are silent to screen readers and pause while the tab is hidden or an information page is active, leaving non-map content usable without disruptive reloads.
- A compact global build-freshness footer now shows the latest Git commit as a dynamically updating relative time and links to the project repository.
- Layer summaries now lead with the programme inventory's R-R Initiative before the layer-specific description, including while switching compound-map variants.
- Compound-layer source labels now mirror the inventory Sub-source value directly, removing the competing inventory-label override from selectors and exports.
- Compound layers use compact tabs for up to three sources and automatically switch to a full-width select control for larger option sets, preventing hidden or clipped choices in narrow panels.
- In-development layers automatically become available when all required MapX view IDs exist while retaining their editorial status in Sources and exports; public cross-project views are allowed with a startup warning rather than blocking the application.
- Inventory imports now filter a durable retired-layer key list, preventing obsolete rows retained in colleague exports from being reintroduced.
- Inventory Layer name and Description fields are now authoritative for UI copy; the importer reports and applies both simple-layer and compound-source copy changes.
- Expanding a published layer now activates it automatically; collapsing the accordion leaves the map layer active, while turning its accessible on/off switch off also folds the details closed. Eye icons have been replaced with larger, touch-friendly switch controls across primary and cross-tab layer lists, whose headings now share the panel's standard content inset.
- **August 2026 map inventory import**: reconciled 103 retained programme spreadsheet rows with the runtime registry, including eight World Bank recovery-speed views, PML public infrastructure views, crop placeholders, the ecosystem-loss and early-warning MapX IDs, richer source metadata, and new Risk/Resilience placeholders. Entries marked for removal were deleted from both sources. The inventory importer now supports repeated sub-source labels and status-only updates.
- **External EDRA crop-risk prototype**: the Hazard group can now fetch European Drought Risk Atlas NUTS-2 boundaries and drought-related crop-yield reductions directly from Copernicus CEMS, reproject the source geometry from EPSG:3035, and inject it into MapX as a temporary GeoJSON view. The layer includes barley/maize/wheat and historical/current/+1.5 °C/+2 °C/+3 °C controls, opacity, a local legend, URL restore, and site-inspection attributes.
- External-layer runtime registry and provider adapter pattern, allowing non-MapX sources to participate in the existing `openViews`, inspection, clear-all, and layer-control workflows without a permanent MapX view ID.
- External-runtime governance guide covering the programme source-tracker row, ownership workflow, measured EDRA payload/reprojection costs, reliability and privacy dependencies, production trade-offs, and migration triggers.
- **Drag + resize for panels**: both the layer panel and the Site Details panel are now draggable (drag by their header bar) and resizable (bottom-right grip). Inline dimensions are cleared on collapse and restored on expand so the layer panel's collapsed state is not broken by a prior resize. Implemented in `src/utils/panels.js` (`makeDraggable`, `makeResizable`, `onPanelCollapse`, `onPanelExpand`) and `src/styles/components/panels.css`.
- **Dev-mode MapX native inspector**: in development builds (`import.meta.env.DEV`), the `set_features_click_sdk_only` suppression call is skipped so MapX's native feature popup appears alongside our custom Site Details panel, enabling data cross-checking during development.
- Site inspection mode: an **Inspect** button in the sidebar header activates click-to-inspect on the map. Clicking any location fires MapX `click_attributes` events (one per active vector layer); the app batches them and shows a floating **Site Details** panel with geographic coordinates, per-layer feature attributes, data-presence indicators, and a download button for each layer. Raster layers are shown as "not queryable at point". The panel closes on ✕ click or Escape. A generation counter prevents stale events from appearing after inspection is toggled off.
- `LEARNINGS.md`: project-level knowledge base documenting the confirmed `click_attributes` payload shape, batching pattern, RT layer limitations, `set_features_click_sdk_only` usage, the Mangrove `<details>` convention, and the view-index pattern.
- `closeInfobox()` exported from `src/ui/infobox.js` so the infobox can be explicitly dismissed when entering inspection mode.

- Cross-tab layer sections: each tab panel now shows collapsed `<details>` sections for all other tabs, letting users toggle layers from any category without switching tabs. Secondary eye buttons delegate to the canonical toggle; state (active indicator, auto-expand) stays in sync. Rapid/concurrent clicks are guarded by an in-flight Set per layer key.
- Risk & Resilience MapX view IDs wired for AAL Public, AAL/PML Housing, AAL/PML to GDP 2025, PML to GDP 2025, Current Fiscal Gap (all five hazards including Floods), and Change in Fiscal Gap.
- Risk & Resilience tab now renders Risk Maps and Resilience Maps as distinct labelled subgroups in the sidebar; group headings hide automatically when disabled layers are not shown
- Canonical Risk and Resilience layer inventory sourced from the programme planning spreadsheet, with incomplete entries retained as development placeholders.
- Config validator now checks for duplicate layer `key` values (previously only checked view IDs)
- Resilience tab with planned placeholder entries for future resilience-linked content
- Broader CDRI risk placeholders (AAL and 1:100 PML review entries) added to the Risk inventory
- Public roadmap note clarifying that future indicator/chart content will live outside this repository and be cross-linked into the map experience later
- Empty-state copy for categories that currently have no published layers
- Layer-panel review toggle for showing disabled layers without publishing them
- "Clear all" button in the layer panel header — hides when no layers are active
- Compound layer system: one accordion item can switch between multiple MapX views
- Sub-tabs widget for switching data metrics (depth / frequency / exposure)
- Stepped slider widget for return period selection (earthquake PGA: 250-2475yr)
- Widget registry (`src/ui/widgets/`) -- add new types without touching sidebar code
- Earthquake PGA layer with 5 return period sources
- River Flooding compound layer (depth, frequency, exposure sub-tabs)
- Tropical Cyclone, Landslide, Tsunami compound layers (exposure/frequency)
- Home / About panel, Guide, Sources, Downloads info pages
- Preview PIN gate for prototype access control
- Hash-based URL routing: active layers and active tab encoded in the URL so links are shareable and browser back/forward works
- GitHub Actions workflow for GitHub Pages deployment
- Startup config validation catches typos, missing IDs, bad legend entries, and duplicate view IDs, and warns about cross-project dependencies.
- Mangrove `mg-mega-topbar` navigation bar with category tabs and info links
- Floating layer panel over full-width map (collapsible, scrollable)
- Accordion layer items with expand arrow, type tags, and eye toggle
- Per-layer opacity sliders (inverted to MapX SDK transparency)
- Accessible structured HTML legends for supported MapX vector styles and approved discrete GeoServer raster colormaps, with bounded/allowlisted MapX mirror retry, lazy image comparison, labelled diagnostics, stale-render protection, and automatic image fallback for unsupported styles
- Local legend override system (HTML swatches) with SDK PNG as diagnostic fallback
- Feature click popup (infobox) from MapX `click_attributes` events
- MapX SDK wrapper modules (`src/sdk/client.js`, `views.js`, `filters.js`, `map-control.js`)
- CSS split into design tokens + per-component files
- Accessibility: focus-visible, aria attributes, keyboard nav, prefers-reduced-motion
- Layer config split into per-category files under `src/config/layers/`

### Fixed

- Removed the low-value Guide and Downloads navigation tabs and their hash routes; inventory download remains available from Sources. Removed the redundant Platform block from Sources and the In progress and Credits blocks from Home. Sources tables now use the full content width instead of inheriting the standard prose measure.
- Refreshed patch/minor Node dependencies and security resolutions; `yarn audit` now reports zero known vulnerabilities.
- EDRA value requests now cover all available regions, including the Azores and Madeira; strict schema, duplicate-key, feature/vertex/value-count, and minimum join-coverage checks fail visibly instead of silently rendering a plausible no-data map.
- EDRA crop colours, thresholds, and no-data styling now come from the live configuration used by the source explorer. The MapX paint expression and HTML legend share that validated definition, preventing independent upstream-style drift.
- External-view deletion failures now keep the prior runtime registration and UI state authoritative; failed replacements clean up the candidate view instead of risking a hidden or duplicated MapX layer.
- `buildLayerAccordion` was checking `!layer.disabled` (legacy flag) for the eye toggle, so layers with `status: "disabled-awaiting-data"` would receive an eye button that called `viewAdd(null)`; now uses `isLayerPublished()` consistently
- Config validator was requiring non-null source IDs for all compound layers regardless of publication state; unpublished compound layers may now have `null` source IDs (IDs are assigned once views are uploaded)
- Duplicate MapX view IDs between hazard and risk layers caused incorrect layer state; affected risk layers temporarily disabled with TODOs
- Cross-project public views such as Land Cover no longer fail startup validation; they can be added by ID while project consolidation remains the preferred long-term setup
- Hash `sourceIdx` out-of-bounds read crashing compound layer restore on back/forward navigation
- Back/forward navigation not reconciling which layers to turn off (only turned layers on)
- UI built inside the SDK `ready` handler, so sidebar appeared blank until the map loaded
- Infobox ESC key listener leaked on every open, accumulating handlers; replaced with a single managed module-level handler
- Category cards on the home page were non-interactive `<article>` elements; replaced with focusable `<button>` elements dispatching `navigate-tab` events

### Changed

- Home page category cards now render with their per-category coloured border and internal padding. The markup always asked for this via `mg-card__icon--bordered` and `--mg-card-border`, but a `<button>` reset was overriding the border and padding; Mangrove 2.0 added a card shadow, which exposed the result as content flush against a box edge.
- The home page category grid is three across, so the five categories wrap to two rows instead of one row of narrow, tall cards.
- Sources tables now keep a minimum width and scroll inside their container on narrow screens instead of collapsing to roughly one character per line.

- Upgraded the UNDRR Mangrove component library from v1.8.0 to v2.0.0-alpha.4. Mangrove 2.0 restyles `mg-card` with a background, radius, shadow and padding, so the home page category cards now render as bordered cards.
- App chrome z-index moved out of Mangrove 2.0's frozen navigation band (10-22): `--z-panel` 10 → 30 and `--z-infobox` 20 → 40, so the site header can no longer paint over the layer panel or infobox.
- Focus rings now use Mangrove's tokens (`rgb(var(--mg-color-focus-ring))` at `--mg-focus-ring-width`) in place of a hand-rolled `2px solid var(--color-primary)` repeated across eleven declarations, and the site inspector's coordinate readout uses the `--mg-font-family-code` role token instead of a bare `monospace`.
- Removed the no-op `mg-page-header--default` modifier, which matched no rules in either Mangrove version.
- EDRA geometry, crop, and style-configuration responses are cached per page session, failed requests remain retryable, and source requests now time out after 30 seconds. Scenario switches no longer repeat the values request.
- External crop/scenario settings are encoded in shared URLs and reconciled on browser back/forward navigation.
- Layer inventory distinguishes externally delivered layers with a blank MapX ID and `External runtime` status instead of describing them as MapX uploads.
- Layout from fixed sidebar to floating panel over full-width map
- Hazard layers reorganised into compound layers where data pairs exist
- Layer toggles guarded by SDK readiness flag so they cannot fire before the map is connected
- Inventory lifecycle status is preserved independently from prototype availability; awaiting-data layers with complete IDs can be reviewed on the map without being exported as Uploaded.
- Primary category order now leads with Risk and Resilience
- Entries explicitly marked Pending removal, including Coral Reefs and Well-being, were removed from the application configuration and canonical inventory
- Terminology updated from "risk to resilience" to "risk and resilience" throughout the project
- Disabled layer accordions are now expandable so descriptions and metadata remain readable during review (previously `pointer-events: none` blocked interaction)

### Removed

- The custom preview PIN gate (`src/pin-gate.js`, `pin-gate.css` and its markup) in favour of Mangrove's `preview-access` component, which is configured entirely from `data-mg-preview-*` attributes. Behaviour is unchanged: same PIN, same soft barrier, unlock still persisted in `sessionStorage`.
- Custom underlines beneath section and hero titles, and the duplicated font size and weight declarations on those headings — Mangrove's own `h1`/`h2` rules now supply them.
- The `mg-mega-wrapper` class on the category navigation, replaced by `mg-container`.
