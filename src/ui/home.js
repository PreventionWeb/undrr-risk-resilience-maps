/**
 * Home / About page — full-page view using UNDRR Mangrove design system classes.
 */

import { TABS } from "../config/layers.js";

/**
 * Visual properties for each category card. id/label come from TABS so
 * these never get out of sync with the navigation bar.
 */
const CARD_VISUAL = {
  "risk-resilience": { icon: "01", color: "#004f91", desc: "Combined risk and resilience assessment showing where hazard, exposure, and vulnerability converge, alongside planned resilience indicators." },
  hazard:        { icon: "02", color: "#c72236", desc: "Natural hazards including river and coastal floods, droughts, earthquakes, and tropical cyclones." },
  exposure:      { icon: "03", color: "#ed833f", desc: "Infrastructure and population elements at risk: roads, railways, power networks, and cropland." },
  vulnerability: { icon: "04", color: "#f0b429", desc: "Socioeconomic and structural factors that amplify harm when hazards strike." },
};

// Derive categories from TABS so id and label are never duplicated
const CATEGORIES = TABS.map((tab) => ({
  id: tab.id,
  label: tab.label,
  ...CARD_VISUAL[tab.id],
})).filter((c) => c.icon); // skip any tabs that have no card visual defined

export function buildHomePanel() {
  const el = document.createElement("div");
  el.className = "info-page-panel";
  el.id = "tab-home";

  el.innerHTML = `
    <div class="info-page-breadcrumb">
      <div class="mg-container">
        <nav aria-label="breadcrumbs" class="mg-breadcrumb">
          <ul>
            <li><a href="https://www.undrr.org" target="_blank" rel="noopener">UNDRR.org</a></li>
            <li><a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener">Risk &amp; Resilience</a></li>
            <li aria-current="page">Global Risk Analytics &amp; Resilience Map Viewer</li>
          </ul>
        </nav>
      </div>
    </div>

    <div class="info-page-hero">
      <div class="mg-container">
        <p class="info-page-hero__eyebrow">Prototype · Interaction review only</p>
        <h1 class="info-page-hero__title">GRAR Metrics Facility</h1>
        <p class="info-page-hero__intro">Explore interactive global risk and resilience data layers — hazard exposure, economic impacts, and resilience benchmarks — all in one visualization platform. Part of UNDRR's <a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener" class="info-page-hero__link">Risk &amp; Resilience Metrics</a> initiative.</p>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">Explore by category</h2>
        <div class="info-category-grid">
          ${CATEGORIES.map((c) => `
            <button class="mg-card mg-card__icon mg-card__icon--bordered info-category-card" data-tab="${c.id}" style="--mg-card-border: ${c.color}" aria-label="Explore ${c.label}">
              <div class="mg-card__visual">
                <div class="mg-card__icon-wrap mg-card__icon-wrap--small">
                  <span class="info-category-card__num" style="color: ${c.color}">${c.icon}</span>
                </div>
              </div>
              <div class="mg-card__content">
                <header class="mg-card__title" style="color: ${c.color}">${c.label}</header>
                <div class="mg-card__summary">${c.desc}</div>
              </div>
            </button>
          `).join("")}
        </div>
      </div>
    </div>

    <div class="info-page-section info-page-section--grey">
      <div class="mg-container">
        <div class="mg-highlight-box mg-highlight-box--secondary">
          <h3>In progress</h3>
          <p>This prototype is currently focused on building out the interaction layer. Right now, the main goal is to support clear switching and comparison across multiple map layers while the source inventory is still being confirmed.</p>
          <p>Next steps may include pulling related maps across category boundaries, such as showing a risk layer while reviewing vulnerability context, or introducing simple data visualisation patterns that help compare risk and vulnerability together. The exact mechanics are still to be determined, but first the priority is to lock down the map sources.</p>
        </div>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container info-page-credits">
        <h2 class="info-page-section__title">Credits</h2>
        <p>Built on the interaction model of the <a href="https://global.infrastructureresilience.org" target="_blank" rel="noopener">GRI Risk Viewer</a> by Oxford OPSIS. Map data hosted on <a href="https://app.mapx.org/" target="_blank" rel="noopener">MapX</a> by UNEP/GRID&#8209;Geneva.</p>
      </div>
    </div>
  `;

  // Wire category card buttons to navigate to the matching data tab
  for (const btn of el.querySelectorAll(".info-category-card[data-tab]")) {
    btn.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("navigate-tab", { detail: btn.dataset.tab }));
    });
  }

  return el;
}
