// ──────────────────────────────────────────────────────────────────────
// Leaflet maps — uses the global `L` (loaded via CDN in index.html).
//   initPicker()   → the location picker in the input panel
//   renderEvents() → the result map with one dot per 911 call
// Both pure consumers: given a {lat,lng} + events, they draw. No fetch.
// ──────────────────────────────────────────────────────────────────────

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS = {
  subdomains: 'abcd',
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

const isDark = () => document.documentElement.classList.contains('wa-dark');
const tileUrl = () => (isDark() ? TILE_DARK : TILE_LIGHT);

function esc(str) {
  return String(str ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const tileLayers = [];
function baseTiles(map) {
  const layer = L.tileLayer(tileUrl(), TILE_OPTS);
  layer.addTo(map);
  tileLayers.push(layer);
  return layer;
}

// Swap basemap tiles when the OS light/dark setting changes (the <head> script
// has already toggled html.wa-dark by the time this fires).
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const url = tileUrl();
  for (const layer of tileLayers) layer.setUrl(url);
});

/**
 * Location picker. Click or drag to choose a point.
 * @returns {{setLocation:Function}}
 */
export function initPicker(el, init, onChange, radiusM = 250) {
  const map = L.map(el).setView([init.lat, init.lng], 15);
  baseTiles(map);

  const circle = L.circle([init.lat, init.lng], { radius: radiusM, color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.05 }).addTo(map);
  const marker = L.marker([init.lat, init.lng], { draggable: true }).addTo(map);

  function commit(latlng) {
    marker.setLatLng(latlng);
    circle.setLatLng(latlng);
    onChange({ lat: latlng.lat, lng: latlng.lng });
  }
  marker.on('dragend', () => commit(marker.getLatLng()));
  map.on('click', e => commit(e.latlng));

  setTimeout(() => map.invalidateSize(), 0);
  return {
    setLocation: ll => commit(L.latLng(ll.lat, ll.lng)),
    setRadius: r => { circle.setRadius(r); if (map.getZoom() > 14 && r >= 700) map.setView(circle.getLatLng(), 14); },
  };
}

let eMap = null;
let eLayer = null;

// darken a #rrggbb hex by a factor (for the marker stroke) — keeps each lever's
// dot readable against the map without hard-coding a second color per lever.
function darken(hex, f = 0.75) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Draw the result map: pin + radius + one dot per event, colored by lever.
 * @param {{color:string,label:string,events:object[]}[]} groups one entry per lever.
 * @param {{recenter?:boolean}} [opts] recenter the view on the pin (default true).
 *   Pass false for slider-driven window changes so the user's pan/zoom is kept.
 */
export function renderEvents(el, center, radiusM, groups, { recenter = true } = {}) {
  if (!eMap) {
    eMap = L.map(el).setView([center.lat, center.lng], 15);
    baseTiles(eMap);
    eLayer = L.layerGroup().addTo(eMap);
  } else {
    if (recenter) eMap.setView([center.lat, center.lng], 15);
    eLayer.clearLayers();
  }

  L.circle([center.lat, center.lng], { radius: radiusM, color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.04 }).addTo(eLayer);
  L.marker([center.lat, center.lng]).addTo(eLayer);

  for (const g of groups) {
    const stroke = darken(g.color);
    for (const ev of g.events) {
      if (ev.lat == null || ev.lng == null) continue;
      const m = L.circleMarker([ev.lat, ev.lng], {
        radius: 5, color: stroke, weight: 1, fillColor: g.color, fillOpacity: 0.7,
      });
      m.bindPopup(
        `<strong>${esc(g.label)}</strong><br>${esc(ev.day)}<br>${esc(ev.place)}<br>` +
        `<em>${esc(ev.notes) || '(no details)'}</em>`
      );
      m.addTo(eLayer);
    }
  }

  setTimeout(() => eMap.invalidateSize(), 0);
}
