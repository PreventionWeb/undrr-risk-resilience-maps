# Resourcing Plan — UNDRR Risk & Resilience Map Viewer

> Version: 1.0 · Date: July 2026  
> Based on: [Product Specification](product-spec.md) v1.0  
> Methodology: Prince2 Lite — work packages, effort ranges, risk register, tolerances

**Important:** Effort estimates assume the scope defined in the Product Spec. Changes to that spec — particularly answers to the open questions in §5 — may materially change estimates. This is noted per work package where relevant.

---

## Effort scale

| Code | Meaning |
|---|---|
| XS | < 1 day |
| S | 1–3 days |
| M | 3–8 days (1–2 weeks) |
| L | 2–4 weeks |
| XL | 4–8 weeks |
| ? | Cannot estimate — open question blocks scoping |

## Resource types

| Code | Role |
|---|---|
| KH | UNDRR digital lead (Ken) — can handle JS/HTML/CSS, config, content pipeline, light SDK work |
| FE | Front-end developer — needed for significant new UI, complex SDK integration, or mobile layout |
| MX | MapX / UNEP/GRID-Geneva — SDK support, legend API, platform changes |
| CE | Content editor — UNDRR programme team; layer inventory, metadata, descriptions |
| UX | UX/accessibility specialist — if a formal audit or mobile redesign is required |

---

## Work packages

### WP-1 · Decisions & governance
*These are not development tasks but must be resolved before downstream work can proceed. Each is a blocker for one or more other packages.*

| Decision | Owner | Blocks |
|---|---|---|
| Hosting path (subdomain / CMS-embedded / syndication) | UNDRR digital lead + IT | WP-3, WP-5 |
| Final tool name | Programme + comms | WP-6 |
| Access control model (public / SSO / IP) | UNDRR digital lead | WP-5 |
| Mobile scope (in / out at launch) | Programme | WP-8 |
| Country profile URL pattern | Programme | WP-4 |
| MapX commercial terms (confirm resolved or still open) | UNDRR digital lead | WP-7 |

**Effort:** 0 dev days — but delays here create cascading blocks. Recommend time-boxing these decisions to 2 weeks.

---

### WP-2 · MapX legend integration
*The highest-risk technical item. Current state: legend per layer is a static image (or absent). Dynamic legend would show the actual colour-ramp + value labels from the MapX view, which is essential for data literacy.*

**What's needed:** MapX SDK to expose legend data (colour steps, labels, units) as a JavaScript object so the app can render it natively rather than embed an image.

**Effort:** ?  
**Resource:** MX (primary) + KH (integration)

**Paths:**
1. *MapX adds a legend API* — KH integrates it; est. S–M dev effort on our side, unknown MapX timeline.
2. *MapX exposes raw style config* — KH builds a legend renderer from it; est. M–L.
3. *Static images per layer* — CE provides images; KH adds to config; est. S but ongoing maintenance burden.
4. *No legend at launch* — acceptable for prototype, not for production.

**Action:** Open a formal conversation with MapX now. Ask specifically: "What is the current and planned SDK support for extracting legend data? What would it take?" Their answer determines which path and what timeline applies.

**Scope sensitivity:** High. If MapX cannot support this, we need a content decision about static images, which has ongoing maintenance cost.

---

### WP-3 · Hosting & deployment
*Moving from GitHub Pages (manual deploy) to UNDRR infrastructure.*

**Effort:** S–M (KH) if standalone static host; M–L (KH + IT) if CMS-embedded or syndication.

**Resource:** KH + UNDRR IT

**Tasks:**
- Confirm hosting target (output of WP-1)
- Set up CI/CD pipeline (GitHub Actions → host)
- Configure domain / reverse proxy if subdomain
- If CMS-embedded: resolve Mangrove header conflict (app's nav vs CMS nav), iframe or include strategy

**Note:** The `server.js` in the repo is a lightweight static file server for local testing of the `dist/` build — it is not a production server and should not be deployed as-is.

**Scope sensitivity:** High. CMS embedding or content syndication is significantly more work than a standalone URL.

---

### WP-4 · Country profile click-through
*Was in original PRD scope; deferred from prototype. Clicking a country on the map should link to the UNDRR Risk & Resilience country profile page.*

**Effort:** S (KH)  
**Resource:** KH  
**Dependency:** Country profile URL pattern confirmed (WP-1)

**Tasks:**
- Add click handler in site-inspector to detect country-level features
- Construct URL from country ISO code → country profile page
- Add country link to Site Details panel

**Note:** This only works for vector layers where the clicked feature includes a country code attribute. Raster layers cannot provide this data. Inspect event already fires for vector features — this is wiring, not new infrastructure.

---

### WP-5 · Access control
*Replace the hardcoded 4-digit PIN with production-appropriate access control.*

**Effort:** XS–S (KH) for public URL (just remove the gate); M–L (KH + IT) for SSO integration  
**Resource:** KH (+ IT if SSO)  
**Dependency:** Access control model decision (WP-1)

**Options:**
1. *Public URL* — remove `src/pin-gate.js` and the gate overlay. Simplest.
2. *IP allowlist* — handled at the CDN/proxy layer; no app code change.
3. *UNDRR SSO* — requires backend token validation; significant new work and a backend component, which breaks the current static-site architecture.

---

### WP-6 · Branding & copy finalisation
*"GRAR Metrics Facility Map Viewer" appears in `<title>`, nav, About page, Guide page, and the PIN gate overlay. Needs replacement once the final name is confirmed.*

**Effort:** XS (KH) — search-and-replace plus light copy edit  
**Resource:** KH + CE  
**Dependency:** Final tool name (WP-1)

**Also includes:**
- Social / OG metadata tags (`og:title`, `og:description`, `og:image`) — XS
- `index.html` `<title>` and favicon review

---

### WP-7 · MapX SDK hardening
*Low-risk items that should be done before production regardless of other decisions.*

**Effort:** S (KH)  
**Resource:** KH (MX for version tag)

**Tasks:**
- Pin MapX SDK to a stable version (`mxsdk.umd.js?v=X.Y.Z` or a hash) — prevents silent breakage on MapX deployments
- Add a map load / error state: if the SDK fails to initialise, show a user-facing message rather than a blank panel
- Add layer loading indicator: between eye-toggle click and tiles appearing, show a brief loading state
- Document the SDK version in `package.json` or a comment so it's tracked

---

### WP-8 · Mobile & accessibility
*Current state: not designed or tested for mobile. Accessibility has Mangrove baseline but custom components need a pass.*

**Effort:** M–L (KH or FE + UX) for mobile layout; S–M (KH) for accessibility audit and fixes  
**Resource:** KH or FE; UX if formal audit required  
**Dependency:** Mobile scope decision (WP-1)

**Accessibility tasks (desktop, always required):**
- Layer accordion keyboard navigation (expand/collapse, eye toggle focus trap)
- `<details>/<summary>` R2R category groups — screen reader / Safari consistency check
- Focus management on tab switch
- Colour contrast on disabled-layer opacity (0.45 may fail WCAG AA)
- Alt text and ARIA labels audit

**Mobile tasks (if in scope):**
- Floating sidebar panel: not usable at phone width — needs either a drawer/bottom-sheet pattern or a separate mobile layout
- Five-column card grid: handled, but the wider nav bar collapses awkwardly
- Touch target sizes on eye toggles and accordion headers

**Note:** Mobile is a significant UX redesign, not a CSS tweak. If required at launch, budget FE resource.

---

### WP-9 · Content pipeline & editorial workflow
*Making it possible for non-developers to update layer metadata without a code change.*

**Effort:** S–M (KH + CE) for process definition; ongoing XS per update cycle  
**Resource:** KH + CE

**Current state:** `scripts/import-inventory.mjs` handles MapX view ID and status updates from CSV. Description, source, citation, license still require direct JS edits.

**Tasks:**
- Extend `import-inventory.mjs --apply` to patch description and source fields (M — KH)
- Document the editorial workflow: who owns the CSV, how changes get into the repo, who reviews (XS — KH + CE)
- Define a cadence for content reviews (new layers, retired layers, updated view IDs)
- Consider: can the CSV live in SharePoint and sync to the repo automatically? (Webhook or manual export step)

---

### WP-10 · Ongoing content maintenance
*Layer inventory updates, new data arriving from programme team, MapX view ID changes.*

**Effort:** XS–S per update cycle (CE + KH)  
**Resource:** CE (primary), KH (review + merge)

**Recurring tasks:**
- Programme team provides updated inventory → CE edits `data/inventory.csv` → KH runs import → PR review → deploy
- New data uploaded to MapX by programme team → MapX view ID captured in CSV → import
- Coming-soon layers activated when data is ready
- Source citations and licenses confirmed per layer

---

### WP-11 · Analytics & monitoring
*Currently zero observability into usage or errors.*

**Effort:** S (KH)  
**Resource:** KH

**Tasks:**
- Add UNDRR-approved analytics (Matomo or equivalent — check UNDRR's existing analytics platform before adding anything new)
- Instrument key events: tab switch, layer toggle, inspect activation, CSV download
- Add error reporting for SDK failures (simple `window.onerror` → log service, or just console for now)

---

### WP-12 · Deferred / post-launch (do not estimate now)

| Feature | Why deferred | Trigger to revisit |
|---|---|---|
| Side-by-side dual map panels | MapX multi-view support needs validation; significant layout work | Explicit stakeholder request + MapX confirmation |
| Geographic / attribute filtering | Data model and UI complexity | Stakeholder feedback post-launch |
| Time slider / temporal layers | Data availability and MapX temporal API | When temporal datasets are ready |
| Multilingual interface | Significant i18n effort; no current requirement | Formal UNDRR language policy decision |
| Print / PDF export | Not requested | Post-launch feedback |
| Country profile deep integration | Beyond click-through (e.g. embedded profile data) | Programme team decision |

---

## Summary view

| WP | Name | Effort | Resource | Dependency | Risk |
|---|---|---|---|---|---|
| WP-1 | Decisions | 0 dev days | KH + stakeholders | — | High — blocks everything |
| WP-2 | MapX legend | ? (S–L) | MX + KH | MX response | High — unknown ceiling |
| WP-3 | Hosting | S–L | KH + IT | WP-1 hosting decision | Medium |
| WP-4 | Country links | S | KH | WP-1 URL pattern | Low |
| WP-5 | Access control | XS–M | KH (+ IT) | WP-1 auth decision | Low–Medium |
| WP-6 | Branding/copy | XS | KH + CE | WP-1 name decision | Low |
| WP-7 | SDK hardening | S | KH | — | Low |
| WP-8 | Mobile/a11y | S–L | KH or FE + UX | WP-1 mobile decision | Medium |
| WP-9 | Content pipeline | S–M | KH + CE | — | Low |
| WP-10 | Content maintenance | XS/cycle | CE + KH | — | Low |
| WP-11 | Analytics | S | KH | WP-3 hosting | Low |

**Without mobile and MapX legend:** total remaining effort is approximately **3–6 weeks** of KH time, largely sequential on decisions being made.

**With mobile:** add **2–4 weeks** FE resource.

**MapX legend:** add **unknown weeks** of MX time + **S–M** KH integration.

---

## Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | MapX SDK does not expose legend data and has no near-term plan to do so | Medium | High | Start conversation immediately; agree fallback (static images) so launch is not blocked |
| R2 | Hosting decision takes > 4 weeks to resolve | Medium | High | Time-box: escalate to decision-maker if unresolved by [date] |
| R3 | Stakeholder behavior spec expands post-prototype (country links, filtering, dual panels all reinstated) | Medium | High | Product Spec sign-off before further development; change-control note in spec |
| R4 | MapX SDK breaking change before version pinning is in place (WP-7) | Low | High | WP-7 is cheap — do it first |
| R5 | Content team lacks capacity for ongoing inventory updates | Medium | Medium | Define editorial SLA; automate CSV sync from SharePoint if needed |
| R6 | UNDRR SSO required for access control (makes static-site architecture insufficient) | Low | Very high | Clarify early; if SSO needed, architecture changes significantly |
| R7 | Mobile required at launch but not scoped or resourced | Low | High | Confirm mobile scope in WP-1 decisions before any WP-8 work begins |

---

## Recommended sequencing

**Week 1–2 (now):**
- WP-1: Run down all decisions in parallel; time-box to 2 weeks
- WP-7: SDK hardening (independent, low-risk, do it now)
- WP-2: Open formal MapX legend conversation

**Week 3–4 (once decisions land):**
- WP-6: Branding/copy (quick win)
- WP-4: Country links (quick win)
- WP-5: Access control (depends on model chosen)
- WP-9: Content pipeline extension

**Week 5–8:**
- WP-3: Hosting/deployment (longest lead time, needs IT)
- WP-8: Accessibility audit (always) + mobile if in scope
- WP-11: Analytics (once hosting is confirmed)
- WP-2: Legend integration (if MapX timeline allows)

**Ongoing:**
- WP-10: Content maintenance cycle

---

## What KH cannot do solo — FE developer trigger points

A dedicated front-end developer would be needed if:

1. **Mobile layout is required** — the floating sidebar panel is a fundamental UX pattern change at phone width; not a CSS patch.
2. **MapX legend renderer** — if MapX exposes raw style data rather than a formatted legend, building a colour-ramp renderer from scratch is non-trivial.
3. **UNDRR SSO integration** — requires a backend component and auth flow work outside the current static-site model.
4. **Dual map panel** — significant new state management and MapX SDK multi-instance work.
5. **Workload exceeds bandwidth** — if WP-3 through WP-8 all land simultaneously, a second pair of hands would reduce the critical path.

For everything else on this list, KH can drive with MapX SDK support where needed.
