/**
 * Home / About page — full-page view using UNDRR Mangrove design system classes.
 */

import { TABS } from "../config/layers.js";

/**
 * Visual properties for each category card. id/label come from TABS so
 * these never get out of sync with the navigation bar.
 */
const CARD_VISUAL = {
  "risk-resilience": {
    icon: "01",
    color: "#004f91",
    desc: "Analytics insights through approximately 20 metrics across 8 hazards highlighting key risks now up to 2050.",
  },
  hazard: {
    icon: "02",
    color: "#c72236",
    desc: "Aims to provide current global hazard analysis for the 8 key hazards that cause more than 90% of economic costs.",
  },
  exposure: {
    icon: "03",
    color: "#ed833f",
    desc: "Demographic, infrastructure, housing, transport, cropland at risk.",
  },
  vulnerability: {
    icon: "04",
    color: "#f0b429",
    desc: "Social, economic and structural factors that amplify harm when hazards strike.",
  },
  resilience: {
    icon: "05",
    color: "#2d7d46",
    desc: "Indicative metrics that help measure the movement from risk towards greater resilience in social, economic and planetary systems.",
  },
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
        <h1 class="info-page-hero__title"><a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener" class="info-page-hero__link">GRAR Metrics Facility</a></h1>
        <p class="info-page-hero__intro">The Risk & Resilience Metrics Facility helps close this resilience gap by providing cutting‑edge analytics that empower decision makers and communities to make more informed decisions to protect against a risky future. It translates disaster risk science into clear signals that decision makers can use to not only understand current but also potential future risk. More information on the core Metrics Framework is available on the <a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener" class="info-page-hero__link">Risk & Resilience Metrics website</a>.</p>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">Explore by category</h2>
        <div class="info-category-grid">
          ${CATEGORIES.map(
            (c) => `
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
          `,
          ).join("")}
        </div>
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
