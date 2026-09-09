/**
 * UNDRR global footer visibility.
 *
 * The footer itself is Mangrove's documented Footer embed: markup plus the
 * PreventionWeb syndication widget, both in index.html. The widget fetches and
 * injects the global footer content on its own, so nothing here loads it — this
 * module only decides which views show it.
 *
 * Content pages (Home, Sources, About) carry the footer; the map view is
 * full-bleed and omits it.
 */

/** Show the global footer on content pages only. */
export function setGlobalFooterVisible(visible, container) {
  const el = container ?? document.getElementById("global-footer");
  if (el) el.hidden = !visible;
}
