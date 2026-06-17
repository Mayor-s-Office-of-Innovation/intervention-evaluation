// ──────────────────────────────────────────────────────────────────────
// Data layer — loads the pre-baked JSON the Python build emits (no live
// queries; see ../plan.md D1). aggregates.json is small and always loaded;
// each signal's point file is lazy-loaded on first use and cached.
// ──────────────────────────────────────────────────────────────────────

let aggregatesPromise = null;
let provenancePromise = null;
let transitionMetaPromise = null;
const pointCache = new Map();
const transitionCache = new Map();

const fetchJSON = (path) => fetch(path).then(r => {
  if (!r.ok) throw new Error(`Failed to load ${path} (HTTP ${r.status})`);
  return r.json();
});

export function loadAggregates() {
  if (!aggregatesPromise) aggregatesPromise = fetchJSON('./data/aggregates.json');
  return aggregatesPromise;
}

export function loadProvenance() {
  if (!provenancePromise) provenancePromise = fetchJSON('./data/provenance.json');
  return provenancePromise;
}

export function loadTransitionMeta() {
  if (!transitionMetaPromise) transitionMetaPromise = fetchJSON('./data/transitions/_meta.json');
  return transitionMetaPromise;
}

/** Lazy-load a transition signal's classified hotspot cells (persistent/cooled/emerged). */
export function loadTransitions(key) {
  if (!transitionCache.has(key)) transitionCache.set(key, fetchJSON(`./data/transitions/${key}.json`));
  return transitionCache.get(key);
}

const markerCache = new Map();
/** Lazy-load a map signal's individual report markers (with detail fields) for the zoom-in view. */
export function loadMarkers(key) {
  if (!markerCache.has(key)) markerCache.set(key, fetchJSON(`./data/markers/${key}.json`));
  return markerCache.get(key);
}

/**
 * Lazy-load a signal's points: compact [latE5, lngE5, dayIndex, districtIdx] tuples.
 * dayIndex = days since `epoch` (in aggregates.json). Returns decoded objects.
 */
export async function loadPoints(signalKey, epochISO) {
  if (pointCache.has(signalKey)) return pointCache.get(signalKey);
  const p = fetch(`./data/points/${signalKey}.json`)
    .then(r => {
      if (!r.ok) throw new Error(`Failed to load points/${signalKey}.json (HTTP ${r.status})`);
      return r.json();
    })
    .then(rows => {
      const epoch = new Date(epochISO + 'T00:00:00');
      return rows.map(([lat, lng, day, di]) => ({
        lat, lng, districtIdx: di,
        day, // days since epoch
        date: new Date(epoch.getTime() + day * 86400000),
      }));
    });
  pointCache.set(signalKey, p);
  return p;
}
