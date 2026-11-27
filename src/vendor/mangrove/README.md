# Mangrove CiteThis 2.6.0

Source: [unisdr/undrr-mangrove v2.5.0](https://github.com/unisdr/undrr-mangrove/blob/v2.5.0/stories/assets/js/cite-this.js), commit `71e4867`.
Downloaded from `https://assets.undrr.org/mangrove/2.5.0/js/cite-this.js`.
Original SHA-256: `2af482eb59b463b70da9d146467cfeae53a1613ceacb8c3570651d1847e56e6c`.

[v2.6.0](https://github.com/unisdr/undrr-mangrove/blob/v2.6.0/stories/assets/js/cite-this.js)
(commit `a4e1098e`) ships the same file: `https://assets.undrr.org/mangrove/2.6.0/js/cite-this.js`
has the identical SHA-256, so upstream has not yet fixed the clipboard continuations below.
Only the version metadata moved to 2.6.0, to stay aligned with the stylesheet.
Distributed under the [Apache 2.0 licence](LICENSE); original source comments are retained.

Local modifications: add exported version metadata and an instance `alive` flag,
and remove a redundant regex escape to satisfy the viewer’s lint rules.
Destroy marks the instance inactive; all six clipboard success/error continuations
check the flag before opening dialogs, changing feedback, dispatching events or
starting timers. This prevents a delayed clipboard result from acting after
resource-modal closure or replacement. Formatting remains upstream's to keep the
patch small and reviewable.

The viewer bundles this module lazily instead of using the unpatched CDN module.
CSS and the remaining vanilla enhancements still use the matching versioned CDN.
On a Mangrove upgrade, check whether upstream has fixed all clipboard continuation
paths. Prefer the matching upstream release once it passes the deferred-copy and
modal teardown tests; otherwise reapply these guards and update the version,
provenance/hash, licence, and regression checks together.
