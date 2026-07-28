// ──────────────────────────────────────────────────────────────────────
// Transition map (D11/D12) — per-block hot/cold classification on the FIXED
// Lurie-inauguration split (difference-in-differences vs the district tide).
// Classified ~block cells (persistent/cooled/emerged) at every zoom level; the
// popup carries a monthly sparkline plus a "See details" breakdown of report
// types for that block (which lazy-loads the per-report markers dataset).
// Built on presence signals only (D8). CARTO light/dark tiles follow the OS.
//
// The cross-street search primitives (tokenizer, matcher, baked SF corner index)
// now live in shared/cross-street-search.js so the recent-activity hexbins and
// the hypothesis picker can reuse them; this module keeps only the hotspot-cell-
// aware tiering (searchIntersections) + the Leaflet actions on its own map.
// ──────────────────────────────────────────────────────────────────────
import { streetTokens, matchIndex, distMeters, NEARBY_M, ensureCityIntersections } from './cross-street-search.js';

// Light uses CARTO Voyager for noticeably clearer street labels than Positron; dark stays Dark Matter
// (Voyager has no dark variant). Street names are part of the basemap, drawn under the data dots.
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS = {
  subdomains: 'abcd', maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
export const CATEGORY = {
  persistent: { label: 'Persistently hot', color: '#dc2626', blurb: 'Hot before and still hot now' },
  emerged: { label: 'Newly emerged', color: '#f59e0b', blurb: 'Rose faster than its district since the Lurie inauguration' },
  cooled: { label: 'Cooled', color: '#2563eb', blurb: 'Was hot, has fallen relative to its district (incl. emerged-then-cooled)' },
};

const isDark = () => document.documentElement.classList.contains('wa-dark');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();
// Monthly rates come out of the build as raw floats (e.g. 3.235294117647059); show 1 decimal.
const fmtRate = n => (n == null ? n : Number(n).toFixed(1));

export const TIME_BUCKETS = {
  morning: { label: 'Morning', hours: [6, 7, 8, 9, 10, 11] },
  afternoon: { label: 'Afternoon', hours: [12, 13, 14, 15, 16, 17] },
  evening: { label: 'Evening', hours: [18, 19, 20, 21] },
  night: { label: 'Night', hours: [22, 23, 0, 1, 2, 3, 4, 5] },
};

export function getTimeBucket(hour) {
  if (hour < 0) return null;
  for (const [key, { hours }] of Object.entries(TIME_BUCKETS)) {
    if (hours.includes(hour)) return key;
  }
  return null;
}

// ── global Day/Night filter (plan-time-of-day.md §2) — mirrors build/tod.py exactly ──
// DAY = 06:00–19:59, NIGHT = 20:00–05:59. Drives the marker layer + cell-details; the cell
// classification is filtered upstream by the orchestrator (via classify.js monthlyKey).
const DAY_START = 6, NIGHT_START = 20;
export function todBucket(hour) {
  if (hour == null || hour < 0) return 'night';   // never happens (0 nulls verified); safety net
  return hour >= DAY_START && hour < NIGHT_START ? 'day' : 'night';
}
let todFilter = 'both';   // 'both' | 'day' | 'night'
/** Set the global day/night filter. Cell classification is filtered upstream (classify.js); the
 *  per-cell "See details" breakdown recomputes when its popup is (re)opened. */
export function setTodFilter(f) {
  todFilter = f === 'day' || f === 'night' ? f : 'both';
}
const passesTod = hour => todFilter === 'both' || todBucket(hour) === todFilter;

// ── Day/Night split view (marker coloring) ──────────────────────────────
// Combined (default) = classification circles. Split = each cell drawn as a day/night pie:
// SIZED by window volume (same radius as combined) and SPLIT by the cell's day-vs-night share.
// The share comes from the baked monthly_day/monthly_night arrays summed over the active window,
// surfaced on each cell as `nightPct` by the orchestrator (see app.js renderMap). A cell with no
// day/night volume has nightPct == null and falls back to its classification circle — never a
// fabricated 50/50. Amber = day, indigo = night (own legend; distinct from the category colors).
const DAY_COLOR = '#e08a1e', NIGHT_COLOR = '#4f46e5';
let splitView = false;
/** Set day/night split-marker mode. The caller re-renders the map afterwards (renderMap), so the
 *  split share and marker size always reflect the SAME classification pass — no stale flash. */
export function setSplitView(on) { splitView = !!on; }
export function getSplitView() { return splitView; }

let map = null, tile = null, boundary = null, cellLayer = null;
let lastCells = [], lastDistrict = '', lastVisible = null;
let sparkMonths = [], sparkLurieIdx = -1;
// Markers dataset — lazy-loaded for the per-cell "See details" breakdown (no longer a map layer).
let markerKey = null, markerData = null, markerLoader = null, markerLoading = false;
// Deep-link state: which intersection/block CELL is "expanded" (its popup pinned open), the one
// queued to re-open on a shared-link load, and the callback that mirrors map state into the URL.
let selectedCellId = null, pendingCellId = null, onState = null;
// Cross-street search: cellId→marker registry (to open a rendered hotspot's popup), the temporary
// result pin, and a cached intersection index (rebuilt when the signal/cells change). See docs/plan-cross-street-search.md.
const cellMarkers = new Map();
let searchMarker = null, intersectionIndex = null, intersectionIndexKey = null;

// ── Map-level time-of-day filter (granular: morning/afternoon/evening/night) ──
// Drives the cell classification in app.js (which sums the baked `monthly_tod` arrays); this setter is
// kept so app.js can mirror its state here without other modules needing to know the internals.
let mapTodFilter = null;  // null = all, or Set of bucket names

/** Set the map-level granular time-of-day filter (state mirror for app.js). */
export function setMapTodFilter(filter) {
  mapTodFilter = filter;
}

function ensureMap(el) {
  if (map) return;
  map = L.map(el, { scrollWheelZoom: true }).setView([37.785, -122.42], 13);
  tile = L.tileLayer(isDark() ? TILE_DARK : TILE_LIGHT, TILE_OPTS).addTo(map);
  cellLayer = L.layerGroup().addTo(map);
  map.on('moveend', emitState);   // while a cell is pinned, keep its zoom/center fresh in the URL
  window.__map = map;   // exposed for e2e tests to drive zoom/center deterministically
  window.addEventListener('themechange', () => {
    if (tile) tile.setUrl(isDark() ? TILE_DARK : TILE_LIGHT);
  });
  setTimeout(() => map.invalidateSize(), 0);
}

// ── URL state sync ──────────────────────────────────────────────────────
// State is tied to a PINNED CELL: while a block/intersection cell's popup is open we persist its id
// plus the current zoom/center; with nothing pinned we emit `null` so the orchestrator cleans the URL.
// So a plain load or a district switch leaves a clean URL.
function emitState() {
  if (!onState || !map) return;
  if (selectedCellId) {
    const c = map.getCenter();
    onState({ zoom: map.getZoom(), center: { lat: c.lat, lng: c.lng }, cell: selectedCellId });
  } else {
    onState(null);
  }
}

/** Register a callback that receives map state ({zoom,center,cell}) — or null to clear — for the URL. */
export function onMapState(fn) { onState = fn; }

/** Force a state emit (e.g. after a signal toggle re-rendered the cells without moving the map). */
export function notifyState() { emitState(); }

/** Queue a cell id to re-open on the next renderCells (call BEFORE renderCells, e.g. on deep-link load). */
export function queueRestore(cellId) { pendingCellId = cellId || null; }

/** Deep-link restore: re-center/zoom the map (the queued cell opens as renderCells draws it). */
export function restoreMapView(center, zoom) {
  if (!map) return;
  map.setView([center.lat, center.lng], zoom);
}

/** Draw (or redraw) the boundary for the active district and zoom to it. */
export function focusDistrict(el, geojson, districtName) {
  ensureMap(el);
  if (boundary) boundary.remove();
  const upper = districtName.toUpperCase();
  const feats = geojson.features.filter(f => f.properties.district === upper);
  boundary = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
    style: { color: '#64748b', weight: 2, fill: false, opacity: 0.7, dashArray: '4 3' },
  }).addTo(map);
  if (feats.length) map.fitBounds(boundary.getBounds(), { padding: [16, 16], animate: false });
}

export function setSparkMeta(months, lurieMonth) {
  sparkMonths = months || [];
  sparkLurieIdx = sparkMonths.indexOf(lurieMonth);
}

/** Tell the map which marker dataset to lazy-load for the per-cell "See details" breakdown. */
export function setMarkers(key, loaderFn) {
  if (key !== markerKey) { markerKey = key; markerData = null; markerLoader = loaderFn; }
}

// ── tiny inline sparkline (monthly counts) with a Lurie-inauguration marker ──
function sparkline(monthly) {
  if (!monthly || !monthly.length) return '';
  const W = 188, H = 40, pad = 2;
  const max = Math.max(1, ...monthly);
  const n = monthly.length;
  const x = i => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = v => H - pad - (v / max) * (H - 2 * pad);
  let d = '';
  monthly.forEach((v, i) => { d += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; });
  const area = `M${x(0).toFixed(1)} ${H - pad} ` + monthly.map((v, i) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ') + ` L${x(n - 1).toFixed(1)} ${H - pad} Z`;
  const lurie = sparkLurieIdx >= 0
    ? `<line x1="${x(sparkLurieIdx).toFixed(1)}" y1="0" x2="${x(sparkLurieIdx).toFixed(1)}" y2="${H}" stroke="#64748b" stroke-width="1" stroke-dasharray="2 2"/>` : '';
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <path d="${area}" fill="#f97316" fill-opacity="0.15"/>
    <path d="${d.trim()}" fill="none" stroke="#f97316" stroke-width="1.5"/>${lurie}
  </svg><div class="spark-axis"><span>${sparkMonths[0] || ''}</span><span>Lurie ’25</span><span>${sparkMonths[sparkMonths.length - 1] || ''}</span></div>`;
}

/**
 * Render the transition cells for the active district (zoomed-out view).
 * @returns counts per category (for the active district)
 */
export function renderCells(cells, districtName, visible) {
  if (!map) return {};
  lastCells = cells; lastDistrict = districtName; lastVisible = visible;
  cellLayer.clearLayers();
  cellMarkers.clear();
  clearSearchResult();   // drop any stale search pin on district/window change (fixes lingering marker)
  const counts = { persistent: 0, cooled: 0, emerged: 0 };
  for (const c of cells) {
    if (c.district !== districtName) continue;
    counts[c.category] = (counts[c.category] || 0) + 1;
    if (!visible.has(c.category)) continue;
    const meta = CATEGORY[c.category];
    const r = 5 + Math.min(6, Math.sqrt(c.total));
    // Stable, shareable cell id from its (rounded) center — survives rebuilds.
    const cellId = `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`;
    let cm;
    if (splitView && c.nightPct != null) {
      // Day/Night pie via a divIcon conic-gradient: sized by volume, split by real day/night share.
      const size = Math.round(r * 2);
      const nightPct = Math.round(c.nightPct);
      cm = L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: 'split-marker',
          html: `<span class="split-marker__pie" style="width:${size}px;height:${size}px;` +
            `background:conic-gradient(${NIGHT_COLOR} 0 ${nightPct}%, ${DAY_COLOR} ${nightPct}% 100%)"></span>`,
          iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        }),
      });
    } else {
      cm = L.circleMarker([c.lat, c.lng], {
        radius: r, color: meta.color, weight: 1.5, fillColor: meta.color, fillOpacity: 0.55,
      });
    }
    cm.bindPopup(
      (c.name ? `<div class="cell-loc">${esc(c.name)}</div>` : '') +
      `<strong>${meta.label}</strong> · ${esc(titleCase(c.district))}` +
      `<br>Before Lurie: <strong>${fmtRate(c.preRate)}</strong>/mo · Now: <strong>${fmtRate(c.nowRate)}</strong>/mo` +
      (c.expectedRate != null ? ` <small>(district-tide ${fmtRate(c.expectedRate)})</small>` : '') +
      sparkline(c.monthly) +
      `<button class="cell-details-btn" data-lat="${c.lat}" data-lng="${c.lng}">See details</button>` +
      `<div class="cell-details" hidden></div>`, { maxWidth: 230, autoPan: false }
    );
    cm.on('popupopen', () => {
      selectedCellId = cellId; emitState();   // click → pin + shareable URL
      const popupEl = cm.getPopup()?.getElement();
      // Keep clicks on the popup's own controls (See details, the tod-chip filters injected by
      // showCellDetails) from bubbling to the map — otherwise Leaflet's closePopupOnClick treats them
      // as a map click and closes the popup instead of running the handler. Leaflet's own
      // disableClickPropagation doesn't cover these (it checks its skip-flag on the direct target
      // only), so guard the content node once per popup element.
      const content = popupEl?.querySelector('.leaflet-popup-content');
      if (content && !content._detailsClickGuard) {
        content._detailsClickGuard = true;
        L.DomEvent.on(content, 'click', L.DomEvent.stopPropagation);
      }
      const btn = popupEl?.querySelector('.cell-details-btn');
      btn?.addEventListener('click', () => showCellDetails(c.lat, c.lng, popupEl, cm));
    });
    cm.on('popupclose', () => { if (selectedCellId === cellId) { selectedCellId = null; emitState(); } });
    cm.addTo(cellLayer);
    cellMarkers.set(cellId, cm);   // registry for cross-street search to open this hotspot
    if (cellId === pendingCellId) { pendingCellId = null; cm.openPopup(); }   // deep-link target
  }
  return counts;
}

// ── cell "See details" panel — incident-type breakdown with time-of-day filtering ──
function getMarkersForCell(lat, lng, data) {
  if (!data?.pts) return [];
  const { coordScale, pts } = data;
  const cellLat = Math.round(lat * 1000) / 1000;
  const cellLng = Math.round(lng * 1000) / 1000;
  return pts.filter(pt => {
    if (!passesTod(pt[3])) return false;   // honor the global Day/Night filter (the popup's own
    const mLat = Math.round((pt[0] / coordScale) * 1000) / 1000;   // 4 chips then refine within it)
    const mLng = Math.round((pt[1] / coordScale) * 1000) / 1000;
    return mLat === cellLat && mLng === cellLng;
  });
}

function computeBreakdown(markers, fields, hourFilter = null) {
  const typeFieldIdx = fields.findIndex(f =>
    ['Reported as', 'Type', 'Call type', 'call_type_original_desc'].includes(f.label)
  );
  if (typeFieldIdx < 0 || !markers.length) return [];

  const field = fields[typeFieldIdx];
  const counts = {};
  const fieldOffset = 4; // pts layout: [lat, lng, day, hour, ...fields]

  markers.forEach(pt => {
    const hour = pt[3];
    if (hourFilter && !hourFilter.includes(getTimeBucket(hour))) return;
    const rawVal = pt[fieldOffset + typeFieldIdx];
    const val = field.coded ? (field.values[rawVal] || '') : (rawVal || '');
    counts[val] = (counts[val] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
}

function renderBreakdownList(breakdown) {
  if (!breakdown.length) return '<em class="cell-details__empty">No reports at this location</em>';
  const total = breakdown.reduce((s, [, c]) => s + c, 0);
  return breakdown.map(([type, count]) => {
    const pct = Math.round((count / total) * 100);
    return `
      <div class="breakdown-row">
        <span class="breakdown-type">${esc(type || '(blank)')}</span>
        <span class="breakdown-bar" style="--pct:${pct}%"></span>
        <span class="breakdown-count">${count}</span>
      </div>`;
  }).join('');
}

async function showCellDetails(lat, lng, popupEl, cm) {
  if (!markerData && markerLoader && !markerLoading) {
    markerLoading = true;
    try { markerData = await markerLoader(); } finally { markerLoading = false; }
  }
  if (!markerData) return;

  const detailsEl = popupEl?.querySelector('.cell-details');
  if (!detailsEl) return;

  const cellMarkers = getMarkersForCell(lat, lng, markerData);

  detailsEl.innerHTML = `
    <div class="cell-details__header">${cellMarkers.length} report${cellMarkers.length !== 1 ? 's' : ''}</div>
    <div class="cell-details__filter" role="group" aria-label="Time of day">
      <button class="tod-chip is-active" data-tod="all">All</button>
      <button class="tod-chip" data-tod="morning">Morning</button>
      <button class="tod-chip" data-tod="afternoon">Afternoon</button>
      <button class="tod-chip" data-tod="evening">Evening</button>
      <button class="tod-chip" data-tod="night">Night</button>
    </div>
    <div class="cell-details__breakdown"></div>`;
  detailsEl.hidden = false;

  const filterBtns = detailsEl.querySelectorAll('.tod-chip');
  const breakdownEl = detailsEl.querySelector('.cell-details__breakdown');

  const renderBd = (filter) => {
    const breakdown = computeBreakdown(cellMarkers, markerData.fields, filter);
    breakdownEl.innerHTML = renderBreakdownList(breakdown);
  };

  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const tod = btn.dataset.tod;
      renderBd(tod === 'all' ? null : [tod]);
    };
  });

  renderBd(null);
  popupEl.querySelector('.cell-details-btn')?.remove();

  // Widen the popup for the panel and reflow. NOTE: do NOT call popup.update() — it re-renders the
  // popup from the original bound HTML string and would wipe the breakdown DOM we just injected.
  // _updateLayout/_updatePosition re-fit width + reposition against the *live* DOM, preserving it.
  // (PR #37 proposed a CSS-class widen instead, but max-width can't override Leaflet's inline width —
  // measured 231px vs 327px here — so the panel stays cramped. Kept the working approach.)
  const popup = cm?.getPopup();
  if (popup) {
    popup.options.maxWidth = 340;
    popup._updateLayout?.();
    popup._updatePosition?.();
  }
}

// ── Cross-street search (local activity data first, then the baked authoritative SF corner index) ──
// Tokenizer / matcher / baked-index loader now live in shared/cross-street-search.js (imported above);
// this file keeps only the hotspot-cell-aware index + tiering + the Leaflet actions on its own map.

async function ensureMarkerData() {
  if (!markerData && markerLoader && !markerLoading) {
    markerLoading = true;
    try { markerData = await markerLoader(); } finally { markerLoading = false; }
  }
  return markerData;
}

/** Build (and cache) the intersection index for the active signal: hotspot cells + all reported
 *  marker intersections, deduped by normalized key (hotspot entries win). */
async function buildIntersectionIndex() {
  const key = markerKey || '';
  if (intersectionIndex && intersectionIndexKey === key) return intersectionIndex;
  const seen = new Map();   // normKey → entry
  for (const c of lastCells) {
    if (!c.name || !c.category) continue;   // only truly classified (rendered) hotspots are tier-1
    const tokens = streetTokens(c.name);
    const nk = [...tokens].sort().join(' ');
    seen.set(nk, { key: nk, tokens, name: c.name, lat: c.lat, lng: c.lng,
      isHotspot: true, cellId: `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}` });
  }
  const md = await ensureMarkerData();
  if (md?.pts) {
    const { coordScale, pts } = md;
    for (const pt of pts) {
      const name = pt[4];
      if (!name) continue;
      const tokens = streetTokens(name);
      const nk = [...tokens].sort().join(' ');
      if (seen.has(nk)) continue;   // a hotspot cell already covers this intersection
      seen.set(nk, { key: nk, tokens, name, lat: pt[0] / coordScale, lng: pt[1] / coordScale, isHotspot: false });
    }
  }
  intersectionIndex = [...seen.values()];
  intersectionIndexKey = key;
  return intersectionIndex;
}

/**
 * Search for an intersection. Purely local/offline — no external geocoder. Returns a tiered result:
 *   { status:'need-two' }                              — need two cross streets
 *   { status:'local', isHotspot, cellId?, lat,lng,name } — matched our data (hotspot or reported corner)
 *   { status:'city', lat,lng,name, nearby, nearName? }  — a real SF corner (baked DataSF index); no
 *        activity logged AT it, but `nearby` is true when tracked activity sits within NEARBY_M
 *        (nearName = that nearest tracked corner) — softens the "no activity" note honestly.
 *   { status:'none' }                                  — not a matchable SF corner (gibberish/typo)
 *   { status:'error' }                                 — city index failed to load
 */
export async function searchIntersections(query) {
  const qTokens = streetTokens(query);
  if (qTokens.size < 2) return { status: 'need-two' };
  const qkey = [...qTokens].sort().join(' ');
  const q = [...qTokens];

  // Tiers 1–2: our own activity data (tracked hotspot / reported corner).
  const idx = await buildIntersectionIndex();
  const local = matchIndex(idx, qkey, q, true);
  if (local) return { status: 'local', ...local };

  // Tier 3: authoritative baked SF corner index (every real corner, incl. zero-activity ones).
  let city;
  try { city = await ensureCityIntersections(); }
  catch { return { status: 'error' }; }
  const hit = matchIndex(city, qkey, q, false);
  if (!hit) return { status: 'none' };

  // Is tracked activity logged just off this corner (block-level attribution)? Find the nearest.
  let near = null;
  for (const e of idx) {
    const d = distMeters(hit.lat, hit.lng, e.lat, e.lng);
    if (d <= NEARBY_M && (!near || d < near.d)) near = { d, name: e.name };
  }
  return { status: 'city', lat: hit.lat, lng: hit.lng, name: hit.name,
    nearby: !!near, nearName: near?.name };
}

/** Open a rendered hotspot's popup (reuses the click/pin/shareable-URL path). Returns false if the
 *  cell isn't currently on the map (e.g. its category is filtered off). */
export function focusCellById(cellId) {
  clearSearchResult();
  const cm = cellMarkers.get(cellId);
  if (!cm || !map) return false;
  map.setView(cm.getLatLng(), Math.max(map.getZoom(), 15));
  cm.openPopup();
  return true;
}

/** Drop/replace a single temporary result pin for a searched location. */
export function showSearchResult(lat, lng, label) {
  if (!map) return;
  clearSearchResult();
  map.setView([lat, lng], Math.max(map.getZoom(), 16));
  searchMarker = L.marker([lat, lng], {
    icon: L.divIcon({ className: 'search-marker', html: '<span class="search-marker__pin"></span>',
      iconSize: [22, 22], iconAnchor: [11, 11] }),
    keyboard: false,
  }).addTo(map);
  if (label) searchMarker.bindTooltip(label, { direction: 'top', offset: [0, -12] });
}

/** Remove the temporary search result pin (on Escape, new search, or district/window change). */
export function clearSearchResult() {
  if (searchMarker) { searchMarker.remove(); searchMarker = null; }
}
