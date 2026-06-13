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

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS = {
  subdomains: 'abcd', maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
const ZOOM_THRESHOLD = 16;      // at/above this, swap block cells → individual report markers
const MARKER_CAP = 1500;        // safety cap on markers drawn in one viewport
const PRE_COLOR = '#94a3b8';    // before Lurie (faded)
const POST_COLOR = '#e11d48';   // since Lurie (solid)

export const CATEGORY = {
  persistent: { label: 'Persistently hot', color: '#dc2626', blurb: 'Hot before and still hot now' },
  emerged: { label: 'Newly emerged', color: '#f59e0b', blurb: 'Rose faster than its district since the Lurie inauguration' },
  cooled: { label: 'Cooled', color: '#2563eb', blurb: 'Was hot, has fallen relative to its district (incl. emerged-then-cooled)' },
};

const isDark = () => document.documentElement.classList.contains('wa-dark');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();

let map = null, tile = null, boundary = null, cellLayer = null, markerLayer = null, hintEl = null;
let lastCells = [], lastDistrict = '', lastVisible = null;
let sparkMonths = [], sparkLurieIdx = -1;
let markerKey = null, markerData = null, markerLoader = null, markerLoading = false;

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
  window.__map = map;   // exposed for e2e tests to drive zoom/center deterministically
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (tile) tile.setUrl(isDark() ? TILE_DARK : TILE_LIGHT);
  });
  setTimeout(() => map.invalidateSize(), 0);
}

const inMarkerMode = () => map && map.getZoom() >= ZOOM_THRESHOLD && !!markerData;

/** Draw (or redraw) the boundary for the active district and zoom to it. */
export function focusDistrict(el, geojson, districtName) {
  ensureMap(el);
  if (boundary) boundary.remove();
  const upper = districtName.toUpperCase();
  const feats = geojson.features.filter(f => f.properties.district === upper);
  boundary = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
    style: { color: '#64748b', weight: 2, fill: false, opacity: 0.7, dashArray: '4 3' },
  }).addTo(map);
  if (feats.length) map.fitBounds(boundary.getBounds(), { padding: [16, 16] });
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
    L.circleMarker([c.lat, c.lng], {
      radius: r, color: meta.color, weight: 1.5, fillColor: meta.color, fillOpacity: 0.55,
    }).bindPopup(
      `<strong>${meta.label}</strong> · ${esc(titleCase(c.district))}` +
      `<br>Before Lurie: <strong>${c.preRate}</strong>/mo · Now: <strong>${c.nowRate}</strong>/mo` +
      (c.expectedRate != null ? ` <small>(district-tide ${c.expectedRate})</small>` : '') +
      sparkline(c.monthly), { maxWidth: 230 }
    ).addTo(cellLayer);
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
  const { coordScale, lurie_day, fields, pts, epoch } = markerData;
  const epochMs = new Date(epoch + 'T00:00:00').getTime();
  const b = map.getBounds();
  let shown = 0, inView = 0;
  for (const p of pts) {
    const lat = p[0] / coordScale, lng = p[1] / coordScale;
    if (!b.contains([lat, lng])) continue;
    inView++;
    if (shown >= MARKER_CAP) continue;
    shown++;
    const day = p[2];
    const pre = day < lurie_day;
    const color = pre ? PRE_COLOR : POST_COLOR;
    const date = new Date(epochMs + day * 86400000).toISOString().slice(0, 10);
    const rows = fields.map((f, i) => {
      const raw = p[3 + i];
      const val = f.coded ? f.values[raw] : raw;
      return val ? `<div class="ov-row"><span>${esc(f.label)}</span>${esc(val)}</div>` : '';
    }).join('');
    L.circleMarker([lat, lng], {
      radius: pre ? 3.5 : 4.5, color, weight: 1, fillColor: color, fillOpacity: pre ? 0.45 : 0.8,
    }).bindTooltip(
      `<div class="ov-date">${date} · ${pre ? 'before Lurie' : 'since Lurie'}</div>${rows}`,
      { className: 'marker-overlay', sticky: true, direction: 'top', opacity: 1 }
    ).addTo(markerLayer);
  }
  if (hintEl) {
    hintEl.style.display = 'block';
    hintEl.innerHTML =
      `Individual reports · <span class="hint-dot" style="background:${PRE_COLOR}"></span>before Lurie ` +
      `<span class="hint-dot" style="background:${POST_COLOR}"></span>since · hover for details` +
      (inView > MARKER_CAP ? ` · showing ${MARKER_CAP} of ${inView}, zoom in` : '');
  }
}
