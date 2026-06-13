// Data layer — loads the pre-baked JSON the Python build emits (no live queries;
// see ../plan.md §7.1 / D1). aggregates.json is small (~5 KB) and always loaded.

function loadJSON(path) {
  return fetch(path).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${path} (HTTP ${r.status})`);
    return r.json();
  });
}

let aggregatesPromise = null;
export function loadAggregates() {
  if (!aggregatesPromise) aggregatesPromise = loadJSON('./data/aggregates.json');
  return aggregatesPromise;
}

// provenance.json carries the exact filters, runnable Socrata query links, and the
// per-signal/per-axis rationale used to build the dashboard's source footnotes.
let provenancePromise = null;
export function loadProvenance() {
  if (!provenancePromise) provenancePromise = loadJSON('./data/provenance.json');
  return provenancePromise;
}
