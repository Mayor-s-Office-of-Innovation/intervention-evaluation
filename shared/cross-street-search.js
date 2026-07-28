// ──────────────────────────────────────────────────────────────────────
// Offline cross-street search — the reusable core, shared by every map that
// offers a "find cross streets" box. NO external geocoder (no Nominatim): all
// lookups are against our own activity data plus the baked authoritative SF
// corner index (shared/data/sf-intersections.json, built from DataSF jfxm-zeee).
//
// Three layers, each independent so a caller takes only what it needs:
//   1. Primitives   — streetTokens / matchIndex / distMeters / ensureCityIntersections.
//   2. resolveIntersection(query, {localIndex, inDistrict}) — the tiered matcher
//      (need-two → local activity → baked SF corner → out-of-district → none/error).
//   3. wireSearch({container, onSearch, …}) — the input/button/status UI + focus
//      prefetch + Escape-to-clear. Caller supplies onSearch(query,{setStatus}); the
//      box owns nothing about maps, so it drops into the hotspots map, the recent-
//      activity hexbins, and the hypothesis picker alike.
//
// This module is Leaflet-free — the map action (pan / drop pin / open popup) lives
// in each caller's onSearch, so cross-street-search.js can be imported anywhere.
// See docs/plan-cross-street-search-expansion.md (Workstream E).
// ──────────────────────────────────────────────────────────────────────

// Street-type words dropped when tokenizing an intersection, so "16th & Mission" ≡ "16TH ST / MISSION ST".
const STREET_SUFFIX = new Set(['st', 'street', 'ave', 'avenue', 'blvd', 'boulevard', 'dr', 'drive',
  'ct', 'court', 'ln', 'lane', 'pl', 'place', 'ter', 'terrace', 'way', 'hwy', 'highway', 'rd', 'road',
  'plz', 'plaza', 'row', 'aly', 'alley', 'cir', 'circle']);

/** Reduce an intersection string to its set of significant street tokens (order-independent match). */
export function streetTokens(str) {
  const t = new Set();
  String(str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).forEach(w => {
    if (!w || w === 'and') return;
    w = w.replace(/^(\d+)(st|nd|rd|th)$/, '$1');   // 16th → 16
    if (STREET_SUFFIX.has(w)) return;
    t.add(w);
  });
  return t;
}

/** Approximate metres between two lat/lng points (equirectangular — accurate enough under ~100 m). */
export function distMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = Math.PI / 180;
  const x = (bLng - aLng) * rad * Math.cos((aLat + bLat) / 2 * rad);
  const y = (bLat - aLat) * rad;
  return Math.hypot(x, y) * R;
}

// A city-index corner this close to tracked activity isn't really "empty" — block-level attribution
// (CFS snaps calls to the nearest named node) means a busy corner's activity can be logged one node
// over, e.g. the 16th & Mission plaza's calls land on the adjacent 16TH/WIESE + 16TH/HOFF alleys.
export const NEARBY_M = 80;

/** Best token-subset match of a query against an index (exact set-equality outranks subset).
 *  hotspotAware boosts entries flagged `isHotspot` so a tracked hotspot outranks a plain corner. */
export function matchIndex(idx, qkey, qTokens, hotspotAware) {
  let best = null, bestScore = -1;
  for (const e of idx) {
    let s = -1;
    if (e.key === qkey) s = hotspotAware && e.isHotspot ? 4 : (hotspotAware ? 3 : 2);
    else if (qTokens.every(t => e.tokens.has(t))) s = hotspotAware && e.isHotspot ? 2 : 1;
    if (s > bestScore) { bestScore = s; best = e; }
  }
  return bestScore >= 1 ? best : null;
}

let cityIndex = null, cityIndexPromise = null;   // baked authoritative SF corner list (lazy-loaded)

/** Lazy-load the baked authoritative SF cross-street index (shared/data/sf-intersections.json).
 *  Module-relative URL so it resolves from any dashboard. Cached; safe to call repeatedly (e.g. to
 *  prefetch on search-box focus). Parses the compact dictionary format into match-ready entries.
 *  Rejects on network/parse failure and clears the cache so a later attempt can retry. */
export function ensureCityIntersections() {
  if (cityIndex) return Promise.resolve(cityIndex);
  if (cityIndexPromise) return cityIndexPromise;
  const url = new URL('./data/sf-intersections.json', import.meta.url);
  cityIndexPromise = fetch(url)
    .then(res => { if (!res.ok) throw new Error('city index fetch failed'); return res.json(); })
    .then(data => {
      const { coordScale, streets, pts } = data;
      const streetTok = streets.map(streetTokens);                // tokenize each unique street once
      cityIndex = pts.map(([latE5, lngE5, a, b]) => {
        const tokens = new Set([...streetTok[a], ...streetTok[b]]);
        return { key: [...tokens].sort().join(' '), tokens,
          name: `${streets[a]} / ${streets[b]}`, lat: latE5 / coordScale, lng: lngE5 / coordScale };
      });
      return cityIndex;
    })
    .catch(err => { cityIndexPromise = null; throw err; });        // allow retry on next call
  return cityIndexPromise;
}

/** Token-index a plain list of reported locations (`[{name, lat, lng, …}]`) for the local tier — the
 *  generic guts of the hotspots map's index, minus its cell/marker specifics. Dedupes by normalized
 *  street-token key and aggregates a `count` of how many source rows land on each corner. Entries
 *  without two street tokens (e.g. a street address) are skipped — the search contract is two cross
 *  streets. Callers pass whatever set they have (e.g. recent-activity's windowed rows). */
export function buildLocalIndex(entries) {
  const seen = new Map();
  for (const e of entries || []) {
    if (!e || !e.name) continue;
    const tokens = streetTokens(e.name);
    if (tokens.size < 2) continue;
    const key = [...tokens].sort().join(' ');
    const prev = seen.get(key);
    if (prev) { prev.count++; continue; }
    seen.set(key, { key, tokens, name: e.name, lat: e.lat, lng: e.lng, count: 1 });
  }
  return [...seen.values()];
}

/**
 * Tiered, fully-offline intersection resolver. Local activity first, then the baked SF corner index.
 * @param {string} query e.g. "16th & Mission"
 * @param {object} [opts]
 * @param {Array}  [opts.localIndex] entries from buildLocalIndex() — this map's own reported corners.
 * @param {(lat:number,lng:number)=>boolean} [opts.inDistrict] when set, a baked-index corner outside
 *        it resolves to `out-of-district` instead of `city` (local entries are assumed already scoped).
 * Returns one of:
 *   { status:'need-two' }                                  — fewer than two cross streets given
 *   { status:'local', lat,lng,name, count, entry }         — matched this map's own reported activity
 *   { status:'city',  lat,lng,name, nearby, nearName }     — a real SF corner; `nearby` = tracked
 *        activity within NEARBY_M (nearName = that corner) so "nothing here" can be softened honestly
 *   { status:'out-of-district', lat,lng,name }             — a real SF corner outside inDistrict
 *   { status:'none' }                                      — not a matchable SF corner (gibberish/typo)
 *   { status:'error' }                                     — baked index failed to load
 */
export async function resolveIntersection(query, { localIndex = [], inDistrict = null } = {}) {
  const qTokens = streetTokens(query);
  if (qTokens.size < 2) return { status: 'need-two' };
  const qkey = [...qTokens].sort().join(' ');
  const q = [...qTokens];

  // Tier 1: this map's own reported activity.
  const local = matchIndex(localIndex, qkey, q, false);
  if (local) return { status: 'local', lat: local.lat, lng: local.lng, name: local.name,
    count: local.count, entry: local };

  // Tier 2: authoritative baked SF corner index (every real corner, incl. zero-activity ones).
  let city;
  try { city = await ensureCityIntersections(); }
  catch { return { status: 'error' }; }
  const hit = matchIndex(city, qkey, q, false);
  if (!hit) return { status: 'none' };
  if (inDistrict && !inDistrict(hit.lat, hit.lng))
    return { status: 'out-of-district', lat: hit.lat, lng: hit.lng, name: hit.name };

  // Is local activity logged just off this corner (block-level attribution)? Find the nearest.
  let near = null;
  for (const e of localIndex) {
    const d = distMeters(hit.lat, hit.lng, e.lat, e.lng);
    if (d <= NEARBY_M && (!near || d < near.d)) near = { d, name: e.name };
  }
  return { status: 'city', lat: hit.lat, lng: hit.lng, name: hit.name,
    nearby: !!near, nearName: near?.name };
}

/**
 * Render the search box UI and wire its behavior. Map-agnostic: the caller's `onSearch` does all the
 * work (resolve + act on the map + set status), so this one box serves the hotspots map, the recent-
 * activity hexbins, and the hypothesis picker.
 * @param {object} opts
 * @param {string} [opts.containerSel]  selector for the host element (or pass `container`)
 * @param {Element}[opts.container]     the host element itself
 * @param {string} [opts.label]         visible field label
 * @param {string} [opts.placeholder]   input placeholder
 * @param {(query:string, api:{setStatus:Function})=>void|Promise} opts.onSearch  runs on submit; wrap
 *        errors are caught here and surfaced as "Search failed".
 * @param {()=>void} [opts.onClear]     runs on Escape (after the input is cleared)
 * @param {()=>any}  [opts.prefetch]    fire-and-forget warm-up on first focus (default: load the SF
 *        corner index so it's ready by submit). Pass a no-op to disable.
 */
export function wireSearch({ containerSel, container, label = 'Find cross streets',
  placeholder = 'e.g. 16th & Mission', onSearch, onClear,
  prefetch = ensureCityIntersections } = {}) {
  const host = container || (containerSel && document.querySelector(containerSel));
  if (!host || typeof onSearch !== 'function') return;

  // A stable-but-unique id so the label's `for` works even with multiple boxes on one page.
  const uid = 'map-search-' + Math.abs(hashStr(label + placeholder + (containerSel || ''))).toString(36);
  host.innerHTML =
    `<form class="map-search-wrap" role="search">` +
    `<label class="map-search-label" for="${uid}">${escAttr(label)}</label>` +
    `<span class="map-search-controls">` +
    `<input type="text" class="map-search-input" id="${uid}" ` +
    `placeholder="${escAttr(placeholder)}" autocomplete="off">` +
    `<button type="submit" class="map-search-btn">` +
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">` +
    `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>` +
    `<span>Search</span></button>` +
    `</span>` +
    `<span class="map-search-status" role="status" aria-live="polite"></span>` +
    `</form>`;

  const form = host.querySelector('.map-search-wrap');
  const input = host.querySelector('.map-search-input');
  const statusEl = host.querySelector('.map-search-status');
  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-error', !!isError);
  };

  // Deferred cost: the ~113 KB corner index is fetched only once the user engages the box (focus), so
  // it's warm by the time they submit — zero page-load impact. Fire-and-forget; a failure here is
  // retried (and surfaced) by the search itself.
  if (prefetch) input.addEventListener('focus', () => { try { Promise.resolve(prefetch()).catch(() => {}); } catch (_) {} }, { once: true });

  // Submit button (click) and Enter both fire the form's submit — one path, natively accessible.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    setStatus('Searching…');
    try { await onSearch(query, { setStatus }); }
    catch { setStatus('Search failed', true); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; if (onClear) onClear(); setStatus(''); }
  });
}

// tiny helpers (local — no dependency on any dashboard's util module)
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function escAttr(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
