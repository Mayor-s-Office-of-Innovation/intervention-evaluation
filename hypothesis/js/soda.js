// ──────────────────────────────────────────────────────────────────────
// Data layer — talks to the SF OpenData (Socrata SoDA) API directly from
// the browser. No backend, no key. Generic over any data point defined in
// datapoints.js. A data point is either single-source (dataset/geoCol/…
// directly on the object) or multi-source (a `sources` array). Each source
// is fetched, deduped within itself by record id, then concatenated.
// ──────────────────────────────────────────────────────────────────────

const SODA_BASE = 'https://data.sfgov.org/resource';

// Max rows fetched per source. A source that returns exactly this many was
// almost certainly truncated (ordered newest-first), so only the most recent
// records are present — app.js warns the user when their window predates them.
export const ROW_CAP = 5000;

const DATASET_LABEL = { '2zdj-bwza': '911 CFS', 'vw6y-z8j6': '311', 'wg3w-h783': 'SFPD incidents', 'nuek-vuh3': 'Fire/EMS' };
export const datasetLabel = id => DATASET_LABEL[id] || 'data.sfgov.org';

/** Build the live Socrata query URL for one source at a pin + radius. */
export function buildQueryUrl(src, { lat, lng, radiusM = 250, startISO = '2023-01-01T00:00:00' }) {
  const where = [
    `within_circle(${src.geoCol}, ${lat}, ${lng}, ${radiusM})`,
    `${src.dateCol} >= '${startISO}'`,
    src.signalWhere,
  ].join(' AND ');

  const params = new URLSearchParams({
    '$select': src.select,
    '$where': where,
    '$order': `${src.dateCol} DESC`,
    '$limit': String(ROW_CAP),
  });
  return `${SODA_BASE}/${src.dataset}.json?${params.toString()}`;
}

async function fetchSource(src, opts) {
  const url = buildQueryUrl(src, opts);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Socrata request failed (HTTP ${res.status})`);
  const rows = await res.json();

  // map rows → events, dropping undated rows and deduping within this source by id
  const seen = new Set();
  const events = [];
  for (const r of rows) {
    const e = src.mapRow(r);
    if (!e.day) continue;
    if (e.id != null) {
      if (seen.has(e.id)) continue; // same record returned twice → count once
      seen.add(e.id);
    }
    events.push(e);
  }
  return { dataset: src.dataset, url, filterDesc: src.filterDesc, signalWhere: src.signalWhere, events, truncated: rows.length >= ROW_CAP };
}

/**
 * Fetch + normalize events for a data point (single- or multi-source).
 * Returns { events, queries:[{dataset,url}] }.
 * Note: dedup is within each source only — cross-source records (e.g. a
 * 311 case and a 911 call about the same situation) have no shared key and
 * are kept as the distinct reports they are.
 */
export async function fetchEvents(dp, opts) {
  const sources = dp.sources || [dp];
  const results = await Promise.all(sources.map(s => fetchSource(s, opts)));
  return {
    events: results.flatMap(r => r.events),
    queries: results.map(r => ({ dataset: r.dataset, url: r.url, filterDesc: r.filterDesc, signalWhere: r.signalWhere })),
    truncated: results.some(r => r.truncated), // any source hit the row cap
  };
}
