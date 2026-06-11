// ──────────────────────────────────────────────────────────────────────
// Data layer — loads the pre-baked JSON the Python build emits (no live
// queries; see ../plan.md D1). aggregates.json is small and always loaded;
// each signal's point file is lazy-loaded on first use and cached.
// ──────────────────────────────────────────────────────────────────────

let aggregatesPromise = null;
const pointCache = new Map();

export function loadAggregates() {
  if (!aggregatesPromise) {
    aggregatesPromise = fetch('./data/aggregates.json').then(r => {
      if (!r.ok) throw new Error(`Failed to load aggregates.json (HTTP ${r.status})`);
      return r.json();
    });
  }
  return aggregatesPromise;
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
