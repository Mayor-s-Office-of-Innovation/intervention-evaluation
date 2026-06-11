// ──────────────────────────────────────────────────────────────────────
// Leaflet map — district boundary overlays + a heatmap layer (clusters) and
// a dot layer (individual reports), toggled. CARTO light/dark tiles follow the
// OS scheme. Pure consumer: given points + a window, it draws. (../plan.md §8)
// ──────────────────────────────────────────────────────────────────────

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS = {
  subdomains: 'abcd', maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
const DISTRICT_COLORS = ['#3b82f6', '#a855f7', '#f97316', '#ef4444']; // Central, Northern, Mission, Tenderloin

const isDark = () => document.documentElement.classList.contains('wa-dark');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let map = null, tile = null, heat = null, dots = null, boundary = null;
let mode = 'heat';

function ensureMap(el) {
  if (map) return;
  map = L.map(el, { scrollWheelZoom: true }).setView([37.785, -122.42], 13);
  tile = L.tileLayer(isDark() ? TILE_DARK : TILE_LIGHT, TILE_OPTS).addTo(map);
  dots = L.layerGroup();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (tile) tile.setUrl(isDark() ? TILE_DARK : TILE_LIGHT);
  });
  setTimeout(() => map.invalidateSize(), 0);
}

export function drawBoundaries(el, geojson) {
  ensureMap(el);
  if (boundary) boundary.remove();
  boundary = L.geoJSON(geojson, {
    style: f => {
      const idx = ['CENTRAL', 'NORTHERN', 'MISSION', 'TENDERLOIN'].indexOf(f.properties.district);
      return { color: DISTRICT_COLORS[idx] || '#888', weight: 2, fill: false, opacity: 0.7 };
    },
  }).addTo(map);
  // fit to the 4 districts once
  map.fitBounds(boundary.getBounds(), { padding: [10, 10] });
  boundary.eachLayer(layer => {
    const name = layer.feature.properties.district;
    const c = layer.getBounds().getCenter();
    L.marker(c, {
      icon: L.divIcon({ className: 'district-label', html: titleCase(name), iconSize: [80, 16] }),
      interactive: false,
    }).addTo(boundary);
  });
}

const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();

export function setMode(m) { mode = m; }

/** Render points within [fromDay, toDay] (dayIndex bounds) using the current mode. */
export function renderPoints(points, fromDay, toDay) {
  if (!map) return;
  const inWin = points.filter(p => p.day >= fromDay && p.day <= toDay);

  if (heat) { heat.remove(); heat = null; }
  dots.clearLayers();

  if (mode === 'heat') {
    const latlngs = inWin.map(p => [p.lat, p.lng, 1]);
    heat = L.heatLayer(latlngs, { radius: 18, blur: 22, maxZoom: 16, minOpacity: 0.25 }).addTo(map);
    if (map.hasLayer(dots)) map.removeLayer(dots);
  } else {
    // cap dots so a wide window stays usable; sample if needed
    const CAP = 4000;
    const shown = inWin.length > CAP ? sample(inWin, CAP) : inWin;
    for (const p of shown) {
      L.circleMarker([p.lat, p.lng], {
        radius: 4, color: DISTRICT_COLORS[p.districtIdx] || '#b91c1c', weight: 1,
        fillColor: DISTRICT_COLORS[p.districtIdx] || '#ef4444', fillOpacity: 0.6,
      }).bindPopup(`<strong>${esc(p.date.toISOString().slice(0, 10))}</strong>`).addTo(dots);
    }
    if (!map.hasLayer(dots)) dots.addTo(map);
    return shown.length < inWin.length ? { shown: shown.length, total: inWin.length } : { shown: inWin.length, total: inWin.length };
  }
  return { shown: inWin.length, total: inWin.length };
}

function sample(arr, n) {
  const stride = arr.length / n;
  const out = [];
  for (let i = 0; i < arr.length; i += stride) out.push(arr[Math.floor(i)]);
  return out;
}
