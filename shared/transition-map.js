// ──────────────────────────────────────────────────────────────────────
// Transition map (D11/D12) — per-block hot/cold classification on the FIXED
// Lurie-inauguration split (difference-in-differences vs the district tide).
// Two zoom regimes:
//   • zoomed out → classified ~block cells (persistent/cooled/emerged); the
//     popup carries a monthly sparkline so you can read a block's trajectory.
//   • zoomed in past ZOOM_THRESHOLD → individual report markers, period-colored
//     (before Lurie vs since), with a hover overlay of the report's details.
// Built on presence signals only (D8). Mapbox styles for light/dark follow the OS.
// ──────────────────────────────────────────────────────────────────────

import { MAPBOX_TOKEN, STYLE_LIGHT, STYLE_DARK, isDark, getStyle } from './mapbox-config.js';
const ZOOM_THRESHOLD = 15;      // at/above this, swap block cells → individual report markers
const MARKER_CAP = 1500;        // safety cap on markers drawn in one viewport
const OLDER_COLOR = '#94a3b8';  // report older than the recent window (faded)
const RECENT_COLOR = '#e11d48'; // report within the trailing-3-month "now" window (solid)

export const CATEGORY = {
  persistent: { label: 'Persistently hot', color: '#dc2626', blurb: 'Hot before and still hot now' },
  emerged: { label: 'Newly emerged', color: '#f59e0b', blurb: 'Rose faster than its district since the Lurie inauguration' },
  cooled: { label: 'Cooled', color: '#2563eb', blurb: 'Was hot, has fallen relative to its district (incl. emerged-then-cooled)' },
};

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

let map = null, popup = null, hintEl = null;
let lastCells = [], lastDistrict = '', lastVisible = null;
let sparkMonths = [], sparkLurieIdx = -1;
let markerKey = null, markerData = null, markerLoader = null, markerLoading = false;
let mapWinSpan = null, mapBaseSpan = null;
let selectedCellId = null, pendingCellId = null, onState = null;
let boundaryGeoJSON = null;

function ensureMap(el) {
  if (map) return;
  mapboxgl.accessToken = MAPBOX_TOKEN;
  map = new mapboxgl.Map({
    container: el,
    style: isDark() ? STYLE_DARK : STYLE_LIGHT,
    center: [-122.42, 37.785],
    zoom: 12,
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '260px' });

  hintEl = document.createElement('div');
  hintEl.className = 'map-hint';
  hintEl.style.display = 'none';
  el.appendChild(hintEl);

  map.on('load', () => {
    // Add empty sources that we'll populate later
    map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('boundary', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // Boundary layer
    map.addLayer({
      id: 'boundary-line',
      type: 'line',
      source: 'boundary',
      paint: {
        'line-color': '#64748b',
        'line-width': 2,
        'line-opacity': 0.7,
        'line-dasharray': [2, 1],
      },
    });

    // Cell circles layer
    map.addLayer({
      id: 'cells-circle',
      type: 'circle',
      source: 'cells',
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.55,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': ['get', 'color'],
      },
    });

    // Marker circles layer (for zoomed-in view)
    map.addLayer({
      id: 'markers-circle',
      type: 'circle',
      source: 'markers',
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-width': 1,
        'circle-stroke-color': ['get', 'color'],
      },
    });

    // Setup event handlers
    map.on('click', 'cells-circle', onCellClick);
    map.on('mouseenter', 'cells-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cells-circle', () => { map.getCanvas().style.cursor = ''; });

    map.on('mouseenter', 'markers-circle', onMarkerHover);
    map.on('mouseleave', 'markers-circle', () => { popup.remove(); });

    // Re-render on zoom changes
    map.on('zoomend', applyZoomMode);
    map.on('moveend', () => { if (inMarkerMode()) renderMarkers(); emitState(); });

    // If we have pending data, render it now
    if (lastCells.length) renderCellsInternal();
    if (boundaryGeoJSON) map.getSource('boundary').setData(boundaryGeoJSON);
  });

  window.__map = map;
  window.addEventListener('themechange', () => {
    if (map) map.setStyle(isDark() ? STYLE_DARK : STYLE_LIGHT);
  });
}

const inMarkerMode = () => map && map.getZoom() >= ZOOM_THRESHOLD && !!markerData;

function emitState() {
  if (!onState || !map) return;
  if (selectedCellId) {
    const c = map.getCenter();
    onState({ zoom: map.getZoom(), center: { lat: c.lat, lng: c.lng }, cell: selectedCellId });
  } else {
    onState(null);
  }
}

export function onMapState(fn) { onState = fn; }
export function notifyState() { emitState(); }
export function queueRestore(cellId) { pendingCellId = cellId || null; }

export function restoreMapView(center, zoom) {
  if (!map) return;
  map.flyTo({ center: [center.lng, center.lat], zoom, duration: 0 });
}

export function focusDistrict(el, geojson, districtName) {
  ensureMap(el);
  const upper = districtName.toUpperCase();
  const feats = geojson.features.filter(f => f.properties.district === upper);
  boundaryGeoJSON = { type: 'FeatureCollection', features: feats };

  if (map.loaded()) {
    map.getSource('boundary').setData(boundaryGeoJSON);
    if (feats.length) {
      const bounds = new mapboxgl.LngLatBounds();
      feats.forEach(f => {
        if (f.geometry.type === 'Polygon') {
          f.geometry.coordinates[0].forEach(coord => bounds.extend(coord));
        } else if (f.geometry.type === 'MultiPolygon') {
          f.geometry.coordinates.forEach(poly => poly[0].forEach(coord => bounds.extend(coord)));
        }
      });
      map.fitBounds(bounds, { padding: 40, duration: 0 });
    }
  }
}

export function setSparkMeta(months, lurieMonth) {
  sparkMonths = months || [];
  sparkLurieIdx = sparkMonths.indexOf(lurieMonth);
}

export function setMarkers(key, loaderFn) {
  if (key !== markerKey) { markerKey = key; markerData = null; markerLoader = loaderFn; }
  applyZoomMode();
}

export function setMapWindow(winSpan, baseSpan) {
  mapWinSpan = winSpan; mapBaseSpan = baseSpan;
  if (inMarkerMode()) renderMarkers();
}

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
  </svg><div class="spark-axis"><span>${sparkMonths[0] || ''}</span><span>Lurie '25</span><span>${sparkMonths[sparkMonths.length - 1] || ''}</span></div>`;
}

export function renderCells(cells, districtName, visible) {
  lastCells = cells; lastDistrict = districtName; lastVisible = visible;
  if (!map || !map.loaded()) return {};
  return renderCellsInternal();
}

function renderCellsInternal() {
  const cells = lastCells, districtName = lastDistrict, visible = lastVisible;
  const counts = { persistent: 0, cooled: 0, emerged: 0 };
  const features = [];

  for (const c of cells) {
    if (c.district !== districtName) continue;
    counts[c.category] = (counts[c.category] || 0) + 1;
    if (!visible.has(c.category)) continue;
    const meta = CATEGORY[c.category];
    const r = 5 + Math.min(6, Math.sqrt(c.total));
    const cellId = `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`;

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: {
        cellId,
        radius: r,
        color: meta.color,
        name: c.name || '',
        label: meta.label,
        district: c.district,
        preRate: c.preRate,
        nowRate: c.nowRate,
        expectedRate: c.expectedRate,
        monthly: c.monthly,
      },
    });
  }

  map.getSource('cells').setData({ type: 'FeatureCollection', features });

  // Handle pending cell restore
  if (pendingCellId) {
    const feat = features.find(f => f.properties.cellId === pendingCellId);
    if (feat) {
      showCellPopup(feat);
    }
    pendingCellId = null;
  }

  applyZoomMode();
  return counts;
}

function onCellClick(e) {
  if (!e.features.length) return;
  const feat = e.features[0];
  showCellPopup(feat);
}

function showCellPopup(feat) {
  const p = feat.properties;
  const coords = feat.geometry.coordinates;
  const monthly = typeof p.monthly === 'string' ? JSON.parse(p.monthly) : p.monthly;

  const html =
    (p.name ? `<div class="cell-loc">${esc(p.name)}</div>` : '') +
    `<strong>${p.label}</strong> · ${esc(titleCase(p.district))}` +
    `<br>Before Lurie: <strong>${p.preRate}</strong>/mo · Now: <strong>${p.nowRate}</strong>/mo` +
    (p.expectedRate != null ? ` <small>(district-tide ${p.expectedRate})</small>` : '') +
    sparkline(monthly) +
    `<button class="cell-details-btn" data-lat="${coords[1]}" data-lng="${coords[0]}">See details</button>` +
    `<div class="cell-details" hidden></div>`;

  popup.setLngLat(coords).setHTML(html).addTo(map);
  selectedCellId = p.cellId;
  emitState();

  const popupEl = popup.getElement();
  const btn = popupEl?.querySelector('.cell-details-btn');
  btn?.addEventListener('click', () => showCellDetails(coords[1], coords[0], popupEl));

  popup.on('close', () => {
    if (selectedCellId === p.cellId) {
      selectedCellId = null;
      emitState();
    }
  });
}

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

async function showCellDetails(lat, lng, popupEl) {
  if (!markerData && markerLoader && !markerLoading) {
    markerLoading = true;
    try { markerData = await markerLoader(); } finally { markerLoading = false; }
  }
  if (!markerData) return;

  const detailsEl = popupEl?.querySelector('.cell-details');
  if (!detailsEl) return;

  const cellMarkers = getMarkersForCell(lat, lng, markerData);

  let html = `
    <div class="cell-details__header">${cellMarkers.length} report${cellMarkers.length !== 1 ? 's' : ''}</div>
    <div class="cell-details__filter" role="group" aria-label="Time of day">
      <button class="tod-chip is-active" data-tod="all">All</button>
      <button class="tod-chip" data-tod="morning">Morning</button>
      <button class="tod-chip" data-tod="afternoon">Afternoon</button>
      <button class="tod-chip" data-tod="evening">Evening</button>
      <button class="tod-chip" data-tod="night">Night</button>
    </div>
    <div class="cell-details__breakdown"></div>`;

  detailsEl.innerHTML = html;
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
  popup.setMaxWidth('340px');

  popupEl.querySelector('.cell-details-btn')?.remove();
}

async function applyZoomMode() {
  if (!map || !map.loaded()) return;

  if (map.getZoom() >= ZOOM_THRESHOLD && markerKey) {
    if (!markerData && markerLoader && !markerLoading) {
      markerLoading = true;
      try { markerData = await markerLoader(); } finally { markerLoading = false; }
    }
    if (!markerData) return;
    popup.remove();
    map.setLayoutProperty('cells-circle', 'visibility', 'none');
    map.setLayoutProperty('markers-circle', 'visibility', 'visible');
    renderMarkers();
  } else {
    map.setLayoutProperty('markers-circle', 'visibility', 'none');
    map.setLayoutProperty('cells-circle', 'visibility', 'visible');
    map.getSource('markers').setData({ type: 'FeatureCollection', features: [] });
    if (hintEl) hintEl.style.display = 'none';
  }
}

function renderMarkers() {
  if (!markerData || !map.loaded()) return;

  const { coordScale, now_start_day, lurie_day, fields, pts, epoch } = markerData;
  const epochMs = new Date(epoch + 'T00:00:00').getTime();
  const bounds = map.getBounds();

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

  const groups = new Map();
  for (const p of pts) {
    const d = p[2];
    const isWin = inWin(d), isBase = inBase(d);
    if (!isWin && !isBase) continue;
    const lat = p[0] / coordScale, lng = p[1] / coordScale;
    if (!bounds.contains([lng, lat])) continue;
    const key = p[0] + ',' + p[1];
    let g = groups.get(key);
    if (!g) { g = { lat, lng, total: 0, recent: 0, top: p }; groups.set(key, g); }
    g.total++;
    if (isWin) g.recent++;
    if (p[2] > g.top[2]) g.top = p;
  }

  const inView = groups.size;
  const allG = [...groups.values()];
  const recentG = allG.filter(g => g.recent > 0);
  const olderG = allG.filter(g => g.recent === 0);
  const draw = olderG.slice(0, Math.max(0, MARKER_CAP - recentG.length)).concat(recentG.slice(0, MARKER_CAP));

  const features = draw.map(g => {
    const recent = g.recent > 0;
    const color = recent ? RECENT_COLOR : OLDER_COLOR;
    const r = Math.min(15, (recent ? 4.5 : 3.5) + Math.sqrt(Math.max(0, g.total - 1)) * 1.8);
    const date = new Date(epochMs + g.top[2] * 86400000).toISOString().slice(0, 10);

    const rows = fields.map((f, i) => {
      const raw = g.top[3 + i];
      const val = f.coded ? f.values[raw] : raw;
      return val ? `<div class="ov-row"><span>${esc(f.label)}</span>${esc(val)}</div>` : '';
    }).join('');

    const head = g.total > 1
      ? `${g.total} reports here · ${g.recent} in the window · most recent ${date}`
      : `${date} · ${recent ? 'in window' : 'baseline'}`;
    const multi = g.total > 1 ? '<div class="ov-multi">Most recent report:</div>' : '';

    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.lng, g.lat] },
      properties: {
        radius: r,
        color,
        opacity: recent ? 0.8 : 0.45,
        tooltip: `<div class="ov-date">${head}</div>${multi}${rows}`,
      },
    };
  });

  map.getSource('markers').setData({ type: 'FeatureCollection', features });

  if (hintEl) {
    hintEl.style.display = 'block';
    hintEl.innerHTML =
      `Reports by location (larger = more) · <span class="hint-dot" style="background:${OLDER_COLOR}"></span>baseline ` +
      `<span class="hint-dot" style="background:${RECENT_COLOR}"></span>in window · hover for count + details` +
      (inView > MARKER_CAP ? ` · showing ${MARKER_CAP} of ${inView} locations, zoom in` : '');
  }
}

function onMarkerHover(e) {
  if (!e.features.length) return;
  const feat = e.features[0];
  const coords = feat.geometry.coordinates;
  popup.setLngLat(coords).setHTML(feat.properties.tooltip).addTo(map);
}
