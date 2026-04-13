/**
 * Layer publication/status helpers.
 *
 * The prototype keeps some layers in config for tracking and attribution even
 * when they are not currently published in the map explorer. Those layers can
 * carry a richer unpublished status so review surfaces can distinguish between
 * content that is awaiting data and content that is pending removal.
 */

const STATUS_LABELS = {
  active: "Active",
  placeholder: "Placeholder",
  disabled: "Disabled",
  "disabled-awaiting-data": "Awaiting data",
  "disabled-pending-removal": "Pending removal",
};

const UNPUBLISHED_STATUSES = new Set([
  "disabled",
  "disabled-awaiting-data",
  "disabled-pending-removal",
]);

export function getLayerPublicationState(layer) {
  if (layer.status) return layer.status;
  if (layer.disabled) return "disabled";
  return "active";
}

export function getLayerStatus(layer, source = null) {
  const publicationState = getLayerPublicationState(layer);
  if (UNPUBLISHED_STATUSES.has(publicationState)) {
    return STATUS_LABELS[publicationState];
  }

  const viewId = source ? source.id : layer.id;
  return viewId ? STATUS_LABELS.active : STATUS_LABELS.placeholder;
}

export function isLayerPublished(layer) {
  return !UNPUBLISHED_STATUSES.has(getLayerPublicationState(layer));
}
