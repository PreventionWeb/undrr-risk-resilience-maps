/**
 * Home / About page — full-page view using UNDRR Mangrove design system classes.
 */

import { TABS } from "../config/layers.js";

/**
 * Visual properties for each category card. id/label come from TABS so
 * these never get out of sync with the navigation bar.
 */
const CARD_VISUAL = {
  hazard:        { icon: "01", color: "#c72236", desc: "Natural hazards including river and coastal floods, droughts, earthquakes, and tropical cyclones." },
  exposure:      { icon: "02", color: "#ed833f", desc: "Infrastructure and population elements at risk: roads, railways, power networks, and cropland." },
  vulnerability: { icon: "03", color: "#f0b429", desc: "Socioeconomic and structural factors that amplify harm when hazards strike." },
  risk:          { icon: "04", color: "#004f91", desc: "Combined assessment showing where hazard, exposure, and vulnerability converge." },
};

// Derive categories from TABS so id and label are never duplicated
const CATEGORIES = TABS.map((tab) => ({
  id: tab.id,
  label: tab.label,
  ...CARD_VISUAL[tab.id],
})).filter((c) => c.icon); // skip any tabs that have no card visual defined

const ROADMAP = [
  "Subnational vulnerability indices",
  "Early warning system layers",
  "Country-level risk profiles",
  "Side-by-side map comparison",
];

export function buildHomePanel() {
  const el = document.createElement("div");
  el.className = "info-page-panel";
  el.id = "tab-home";

  el.innerHTML = `
    <div class="info-page-hero">
      <div class="mg-container">
        <p class="info-page-hero__eyebrow">Prototype · Interaction review only</p>
        <h1 class="info-page-hero__title">UNDRR Risk to Resilience Maps</h1>
        <p class="info-page-hero__intro">A geospatial explorer organised around the risk&#8209;to&#8209;resilience framework. Select a category below or in the navigation bar to explore datasets across Hazard, Exposure, Vulnerability, and Risk.</p>
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
          <h3>Coming soon</h3>
          <ul>
            ${ROADMAP.map((item) => `<li>${item}</li>`).join("")}
          </ul>
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

