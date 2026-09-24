/**
 * Home / About page — full-page view using UNDRR Mangrove design system classes.
 */

import { TABS } from "../config/layers.js";

/**
 * The category cards, from the tab config: `id` and `label` come from the tab,
 * the visual (`icon`, `color`, `desc`) from its `card` field, so adding a tab is
 * one edit in `src/config/layers/index.js` and nothing here has to change.
 * A tab without a `card` gets no card.
 */
const categoriesFrom = (tabs) =>
  tabs.filter((tab) => tab.card?.icon).map((tab) => ({ id: tab.id, label: tab.label, ...tab.card }));

/**
 * Build the home page.
 * @param {object} [options]
 * @param {object[]} [options.tabs] - the data tabs to show cards for (default: TABS)
 * @param {(tabId: string) => void} [options.onNavigate] - a category card was
 *   clicked; open that data tab
 * @param {AbortSignal} [options.signal] - removes the cards' listeners
 * @returns {HTMLElement}
 */
export function buildHomePanel({ tabs = TABS, onNavigate = () => {}, signal } = {}) {
  const categories = categoriesFrom(tabs);
  const el = document.createElement("div");
  el.className = "info-page-panel";
  el.dataset.tabPanel = "home";

  el.innerHTML = `
    <!--
    <div class="info-page-breadcrumb">
      <nav aria-label="breadcrumbs" class="mg-breadcrumb">
        <ul>
          <li><a href="https://www.undrr.org" target="_blank" rel="noopener">UNDRR.org</a></li>
          <li><a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener">Risk &amp; Resilience</a></li>
          <li aria-current="page">Global Risk Analytics &amp; Resilience Map Viewer</li>
        </ul>
      </nav>
    </div>
    -->

    <div class="info-page-hero">
      <div class="mg-container">
        <p class="info-page-hero__eyebrow">Prototype · Interaction review only</p>
        <h1 class="info-page-hero__title"><a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener" class="info-page-hero__link">GRAR Metrics Facility</a></h1>
        <p class="info-page-hero__intro">The Risk and Resilience Metrics Facility helps close the resilience gap by providing cutting-edge analytics that empower decision-makers and communities to make more informed decisions to protect against a risky future. It translates disaster risk science into clear signals that decision-makers can use to not only understand current but also potential future risk. More information on the core Metrics Framework is available on the <a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener" class="info-page-hero__link">Risk and Resilience Metrics website</a>.</p>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">Explore by category</h2>
        <div class="info-category-grid">
          ${categories
            .map(
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
            )
            .join("")}
        </div>
      </div>
    </div>

  `;

  // Wire category card buttons to navigate to the matching data tab
  for (const btn of el.querySelectorAll(".info-category-card[data-tab]")) {
    btn.addEventListener("click", () => onNavigate(btn.dataset.tab), { signal });
  }

  return el;
}
