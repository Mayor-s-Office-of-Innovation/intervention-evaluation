// ──────────────────────────────────────────────────────────────────────
// Transition map (D11/D12) — per-block hot/cold classification on the FIXED
// Lurie-inauguration split (difference-in-differences vs the district tide).
// Two zoom regimes:
//   • zoomed out → classified ~block cells (persistent/cooled/emerged); the
//     popup carries a monthly sparkline so you can read a block's trajectory.
//   • zoomed in past ZOOM_THRESHOLD → individual report markers, period-colored
//     (before Lurie vs since), with a hover overlay of the report's details.
// Built on presence signals only (D8). CARTO light/dark tiles follow the OS.
// ──────────────────────────────────────────────────────────────────────

// Light uses CARTO Voyager for noticeably clearer street labels than Positron; dark stays Dark Matter
// (Voyager has no dark variant). Street names are part of the basemap, drawn under the data dots.
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS = {
  subdomains: 'abcd', maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
const ZOOM_THRESHOLD = 17;      // at/above this, swap block cells → individual report markers
const MARKER_CAP = 1500;        // safety cap on markers drawn in one viewport
const HIT_RADIUS = 11;          // invisible hover target around each dot (the visible dot is much smaller)
const OLDER_COLOR = '#94a3b8';  // report older than the recent window (faded)
const RECENT_COLOR = '#e11d48'; // report within the trailing-3-month "now" window (solid)

export const CATEGORY = {
  persistent: { label: 'Persistently hot', color: '#dc2626', blurb: 'Hot before and still hot now' },
  emerged: { label: 'Newly emerged', color: '#f59e0b', blurb: 'Rose faster than its district since the Lurie inauguration' },
  cooled: { label: 'Cooled', color: '#2563eb', blurb: 'Was hot, has fallen relative to its district (incl. emerged-then-cooled)' },
};

const isDark = () => document.documentElement.classList.contains('wa-dark');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();

const TIME_BUCKETS = {
  morning: { label: 'Morning', hours: [6, 7, 8, 9, 10, 11] },
  afternoon: { label: 'Afternoon', hours: [12, 13, 14, 15, 16, 17] },
  evening: { label: 'Evening', hours: [18, 19, 20, 21] },
  night: { label: 'Night', hours: [22, 23, 0, 1, 2, 3, 4, 5] },
};

function getTimeBucket(hour) {
  if (hour < 0) return null;
  for (const [key, { hours }] of Object.entries(TIME_BUCKETS)) {
    if (hours.includes(hour)) return key;
  }
  return null;
}

let map = null, tile = null, boundary = null, cellLayer = null, markerLayer = null, hintEl = null;
let lastCells = [], lastDistrict = '', lastVisible = null;
let sparkMonths = [], sparkLurieIdx = -1;
let markerKey = null, markerData = null, markerLoader = null, markerLoading = false;
// Analysis window + baseline as [startYM,…,endYM] spans — drives the zoom-in marker coloring:
// in-window = solid, baseline = faded, outside both = hidden. Set by the orchestrator per window.
let mapWinSpan = null, mapBaseSpan = null;
// Deep-link state: which intersection/block CELL is "expanded" (its popup pinned open), the one
// queued to re-open on a shared-link load, and the callback that mirrors map state into the URL.
// (Individual report markers are deliberately NOT deep-linked — only the cluster cells are.)
let selectedCellId = null, pendingCellId = null, onState = null;

function ensureMap(el) {
  if (map) return;
  map = L.map(el, { scrollWheelZoom: true }).setView([37.785, -122.42], 13);
  tile = L.tileLayer(isDark() ? TILE_DARK : TILE_LIGHT, TILE_OPTS).addTo(map);
  cellLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup();
  hintEl = L.DomUtil.create('div', 'map-hint');
  hintEl.style.display = 'none';
  el.appendChild(hintEl);
  map.on('zoomend', applyZoomMode);
  map.on('moveend', () => { if (inMarkerMode()) renderMarkers(); });
  map.on('moveend', emitState);   // while a cell is pinned, keep its zoom/center fresh in the URL
  window.__map = map;   // exposed for e2e tests to drive zoom/center deterministically
  window.addEventListener('themechange', () => {
    if (tile) tile.setUrl(isDark() ? TILE_DARK : TILE_LIGHT);
  });
  setTimeout(() => map.invalidateSize(), 0);
}

const inMarkerMode = () => map && map.getZoom() >= ZOOM_THRESHOLD && !!markerData;

// ── URL state sync ──────────────────────────────────────────────────────
// State is tied to a PINNED CELL: while a block/intersection cell's popup is open we persist its id
// plus the current zoom/center; with nothing pinned we emit `null` so the orchestrator cleans the URL.
// So a plain load, a district switch, or zooming into the individual-marker view all leave a clean URL.
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

/** Tell the map which marker dataset to lazy-load for the zoom-in view. */
export function setMarkers(key, loaderFn) {
  if (key !== markerKey) { markerKey = key; markerData = null; markerLoader = loaderFn; }
  applyZoomMode();
}

/** Set the analysis window + baseline ([startYM,…,endYM] spans) the zoom-in markers color against. */
export function setMapWindow(winSpan, baseSpan) {
  mapWinSpan = winSpan; mapBaseSpan = baseSpan;
  if (inMarkerMode()) renderMarkers();
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
  const counts = { persistent: 0, cooled: 0, emerged: 0 };
  for (const c of cells) {
    if (c.district !== districtName) continue;
    counts[c.category] = (counts[c.category] || 0) + 1;
    if (!visible.has(c.category)) continue;
    const meta = CATEGORY[c.category];
    const r = 5 + Math.min(6, Math.sqrt(c.total));
    // Stable, shareable cell id from its (rounded) center — survives rebuilds.
    const cellId = `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`;
    const cm = L.circleMarker([c.lat, c.lng], {
      radius: r, color: meta.color, weight: 1.5, fillColor: meta.color, fillOpacity: 0.55,
    });
    cm.bindPopup(
      (c.name ? `<div class="cell-loc">${esc(c.name)}</div>` : '') +
      `<strong>${meta.label}</strong> · ${esc(titleCase(c.district))}` +
      `<br>Before Lurie: <strong>${c.preRate}</strong>/mo · Now: <strong>${c.nowRate}</strong>/mo` +
      (c.expectedRate != null ? ` <small>(district-tide ${c.expectedRate})</small>` : '') +
      sparkline(c.monthly) +
      `<button class="cell-details-btn" data-lat="${c.lat}" data-lng="${c.lng}">See details</button>` +
      `<div class="cell-details" hidden></div>`, { maxWidth: 230, autoPan: false }
    );
    cm.on('popupopen', () => {
      selectedCellId = cellId; emitState();   // click → pin + shareable URL
      const popupEl = cm.getPopup()?.getElement();
      const btn = popupEl?.querySelector('.cell-details-btn');
      btn?.addEventListener('click', () => showCellDetails(c.lat, c.lng, popupEl, cm));
    });
    cm.on('popupclose', () => { if (selectedCellId === cellId) { selectedCellId = null; emitState(); } });
    cm.addTo(cellLayer);
    if (cellId === pendingCellId) { pendingCellId = null; cm.openPopup(); }   // deep-link target
  }
  applyZoomMode();
  return counts;
}

// ── switch between cell view and individual-marker view based on zoom ──
async function applyZoomMode() {
  if (!map) return;
  if (map.getZoom() >= ZOOM_THRESHOLD && markerKey) {
    if (!markerData && markerLoader && !markerLoading) {
      markerLoading = true;
      try { markerData = await markerLoader(); } finally { markerLoading = false; }
    }
    if (!markerData) return;
    map.closePopup();   // leaving the cell view → unpin any open cell popup (clears the URL)
    if (map.hasLayer(cellLayer)) map.removeLayer(cellLayer);
    if (!map.hasLayer(markerLayer)) markerLayer.addTo(map);
    renderMarkers();
  } else {
    if (map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
    markerLayer.clearLayers();
    if (!map.hasLayer(cellLayer)) cellLayer.addTo(map);
    if (hintEl) hintEl.style.display = 'none';
  }
}

function renderMarkers() {
  if (!markerData) return;
  markerLayer.clearLayers();
  const { coordScale, now_start_day, lurie_day, fields, pts, epoch } = markerData;
  const epochMs = new Date(epoch + 'T00:00:00').getTime();
  const b = map.getBounds();

  // Day-index ranges for the selected window + its baseline (from the YM spans). In-window points are
  // solid, baseline points faded, points outside BOTH are hidden. Falls back to the old trailing-3mo
  // cutoff if no window has been set yet.
  const [epY, epM, epD] = epoch.split('-').map(Number);
  const epUTC = Date.UTC(epY, epM - 1, epD);
  const dStart = ym => { const [y, m] = ym.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, 1) - epUTC) / 86400000); };
  const dEnd = ym => { const [y, m] = ym.split('-').map(Number); return Math.round((Date.UTC(y, m, 0) - epUTC) / 86400000); };
  const haveWin = mapWinSpan && mapBaseSpan;
  const winLoD = haveWin ? dStart(mapWinSpan[0]) : (now_start_day != null ? now_start_day : lurie_day);
  const winHiD = haveWin ? dEnd(mapWinSpan[mapWinSpan.length - 1]) : Infinity;
  const baseLoD = haveWin ? dStart(mapBaseSpan[0]) : -Infinity;
  const baseHiD = haveWin ? dEnd(mapBaseSpan[mapBaseSpan.length - 1]) : (now_start_day != null ? now_start_day : lurie_day) - 1;
  const inWin = d => d >= winLoD && d <= winHiD;
  const inBase = d => d >= baseLoD && d <= baseHiD;
  // CFS/311 coordinates are snapped to the intersection centroid, so many reports land on the EXACT same
  // point. Stacking individual dots hides all but the top one and makes the colour flip by draw order at
  // different zooms. Instead we GROUP co-located reports into one marker — sized by how many, coloured if
  // ANY fall in the recent window — and let the overlay say how many and show the most-recent report's
  // details. Deterministic (no grey/red flicker) and the cluster size shows volume.
  const groups = new Map();
  for (const p of pts) {
    const d = p[2];
    const isWin = inWin(d), isBase = inBase(d);
    if (!isWin && !isBase) continue;        // outside the window AND its baseline → not shown
    const lat = p[0] / coordScale, lng = p[1] / coordScale;
    if (!b.contains([lat, lng])) continue;
    const key = p[0] + ',' + p[1];
    let g = groups.get(key);
    if (!g) { g = { lat, lng, total: 0, recent: 0, top: p }; groups.set(key, g); }
    g.total++;
    if (isWin) g.recent++;                  // "recent" = falls inside the analysis window
    if (p[2] > g.top[2]) g.top = p;         // the most-recent report represents the spot in the overlay
  }
  const inView = groups.size;
  // spots with no recent activity drawn first (underneath); spots with recent activity drawn last (on top)
  // and kept first when the cap bites — so a busy viewport never hides where activity is happening now.
  const allG = [...groups.values()];
  const recentG = allG.filter(g => g.recent > 0);
  const olderG = allG.filter(g => g.recent === 0);
  const draw = olderG.slice(0, Math.max(0, MARKER_CAP - recentG.length)).concat(recentG.slice(0, MARKER_CAP));
  for (const g of draw) {
    const recent = g.recent > 0;
    const color = recent ? RECENT_COLOR : OLDER_COLOR;
    const date = new Date(epochMs + g.top[2] * 86400000).toISOString().slice(0, 10);
    const rows = fields.map((f, i) => {
      const raw = g.top[4 + i];   // pts layout: [lat, lng, day, hour, ...fields] → fields start at 4
      const val = f.coded ? f.values[raw] : raw;
      return val ? `<div class="ov-row"><span>${esc(f.label)}</span>${esc(val)}</div>` : '';
    }).join('');
    const head = g.total > 1
      ? `${g.total} reports here · ${g.recent} in the window · most recent ${date}`
      : `${date} · ${recent ? 'in window' : 'baseline'}`;
    const multi = g.total > 1 ? '<div class="ov-multi">Most recent report:</div>' : '';
    // dot radius grows with the count (√ scale, capped); halo is the larger hover target.
    const r = Math.min(15, (recent ? 4.5 : 3.5) + Math.sqrt(Math.max(0, g.total - 1)) * 1.8);
    L.circleMarker([g.lat, g.lng], {
      radius: Math.max(HIT_RADIUS, r + 3), stroke: false, fillColor: color, fillOpacity: 0, className: 'mk-halo',
    }).bindTooltip(
      `<div class="ov-date">${head}</div>${multi}${rows}`,
      { className: 'marker-overlay', sticky: true, direction: 'top', opacity: 1 }
    ).addTo(markerLayer);
    L.circleMarker([g.lat, g.lng], {
      radius: r, color, weight: 1, fillColor: color, fillOpacity: recent ? 0.8 : 0.45, interactive: false,
    }).addTo(markerLayer);
  }
  if (hintEl) {
    hintEl.style.display = 'block';
    hintEl.innerHTML =
      `Reports by location (larger = more) · <span class="hint-dot" style="background:${OLDER_COLOR}"></span>baseline ` +
      `<span class="hint-dot" style="background:${RECENT_COLOR}"></span>in window · hover for count + details` +
      (inView > MARKER_CAP ? ` · showing ${MARKER_CAP} of ${inView} locations, zoom in` : '');
  }
}

// ── cell "See details" panel — incident-type breakdown with time-of-day filtering ──
function getMarkersForCell(lat, lng, data) {
  if (!data?.pts) return [];
  const { coordScale, pts } = data;
  const cellLat = Math.round(lat * 1000) / 1000;
  const cellLng = Math.round(lng * 1000) / 1000;
  return pts.filter(pt => {
    const mLat = Math.round((pt[0] / coordScale) * 1000) / 1000;
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

  // Leaflet equivalent of Mapbox's popup.setMaxWidth — widen for the panel and reflow.
  const popup = cm?.getPopup();
  if (popup) { popup.options.maxWidth = 340; popup.update(); }

  popupEl.querySelector('.cell-details-btn')?.remove();
}
