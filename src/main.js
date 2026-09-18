/**
 * App entry point (standalone site).
 *
 * The standalone app is the first consumer of `createRiskMap()` (see
 * docs/embedding.md §3 and src/app/create-risk-map.js): this module only says
 * which document the instance owns and which options the standalone profile
 * uses — the whole config, a URL-hash state adapter, the build-info footer and
 * `location.reload()` as the map-service retry. `embed.html` is the second
 * consumer and differs only in those options.
 *
 * The instance lives as long as the page, so nothing here calls `destroy()`.
 */
import { createRiskMap } from "./app/create-risk-map.js";
import "./styles/shared.css";

createRiskMap(document.body);
