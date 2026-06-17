// ──────────────────────────────────────────────────────────────────────
// Mapbox GL JS map — district boundary overlays + a heatmap layer (clusters) and
// a dot layer (individual reports), toggled. Light/dark styles follow the
// OS scheme. Pure consumer: given points + a window, it draws. (../plan.md §8)
// ──────────────────────────────────────────────────────────────────────

import { MAPBOX_TOKEN, STYLE_LIGHT, STYLE_DARK, isDark } from '../../shared/mapbox-config.js';
const DISTRICT_COLORS = ['#3b82f6', '#a855f7', '#f97316', '#ef4444']; // Central, Northern, Mission, Tenderloin
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();

let map = null, popup = null;
let mode = 'heat';
let boundaryData = null;

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
  popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: true });

  map.on('load', () => {
    // Add sources
    map.addSource('boundary', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // Boundary lines
    map.addLayer({
      id: 'boundary-line',
      type: 'line',
      source: 'boundary',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 0.7,
      },
    });

    // Heatmap layer
    map.addLayer({
      id: 'points-heat',
      type: 'heatmap',
      source: 'points',
      paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': 1,
        'heatmap-radius': 18,
        'heatmap-opacity': 0.75,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0, 0, 255, 0)',
          0.2, 'royalblue',
          0.4, 'cyan',
          0.6, 'lime',
          0.8, 'yellow',
          1, 'red'
        ],
      },
    });

    // Dots layer
    map.addLayer({
      id: 'points-dots',
      type: 'circle',
      source: 'points',
      paint: {
        'circle-radius': 4,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.6,
        'circle-stroke-width': 1,
        'circle-stroke-color': ['get', 'color'],
      },
      layout: { visibility: 'none' },
    });

    // Click handler for dots
    map.on('click', 'points-dots', (e) => {
      if (!e.features.length) return;
      const feat = e.features[0];
      popup.setLngLat(feat.geometry.coordinates)
        .setHTML(`<strong>${esc(feat.properties.date)}</strong>`)
        .addTo(map);
    });
    map.on('mouseenter', 'points-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'points-dots', () => { map.getCanvas().style.cursor = ''; });

    // If we have pending boundary data, set it
    if (boundaryData) {
      map.getSource('boundary').setData(boundaryData);
      fitToBoundary();
    }
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (map) map.setStyle(isDark() ? STYLE_DARK : STYLE_LIGHT);
  });
}

function fitToBoundary() {
  if (!boundaryData || !boundaryData.features.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  boundaryData.features.forEach(f => {
    if (f.geometry.type === 'Polygon') {
      f.geometry.coordinates[0].forEach(coord => bounds.extend(coord));
    } else if (f.geometry.type === 'MultiPolygon') {
      f.geometry.coordinates.forEach(poly => poly[0].forEach(coord => bounds.extend(coord)));
    }
  });
  map.fitBounds(bounds, { padding: 40, duration: 0 });
}

export function drawBoundaries(el, geojson) {
  ensureMap(el);

  // Add color property to each feature
  const coloredFeatures = geojson.features.map(f => {
    const idx = ['CENTRAL', 'NORTHERN', 'MISSION', 'TENDERLOIN'].indexOf(f.properties.district);
    return {
      ...f,
      properties: { ...f.properties, color: DISTRICT_COLORS[idx] || '#888' },
    };
  });
  boundaryData = { type: 'FeatureCollection', features: coloredFeatures };

  if (map && map.loaded()) {
    map.getSource('boundary').setData(boundaryData);
    fitToBoundary();

    // Add district labels as markers
    geojson.features.forEach(f => {
      const name = f.properties.district;
      // Calculate centroid
      let coords = [];
      if (f.geometry.type === 'Polygon') {
        coords = f.geometry.coordinates[0];
      } else if (f.geometry.type === 'MultiPolygon') {
        coords = f.geometry.coordinates[0][0];
      }
      if (coords.length) {
        const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;

        const el = document.createElement('div');
        el.className = 'district-label';
        el.textContent = titleCase(name);
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, lat])
          .addTo(map);
      }
    });
  }
}

export function setMode(m) {
  mode = m;
  if (!map || !map.loaded()) return;

  if (mode === 'heat') {
    map.setLayoutProperty('points-heat', 'visibility', 'visible');
    map.setLayoutProperty('points-dots', 'visibility', 'none');
  } else {
    map.setLayoutProperty('points-heat', 'visibility', 'none');
    map.setLayoutProperty('points-dots', 'visibility', 'visible');
  }
}

export function renderPoints(points, fromDay, toDay) {
  if (!map || !map.loaded()) return { shown: 0, total: 0 };
  const inWin = points.filter(p => p.day >= fromDay && p.day <= toDay);

  // Cap dots so a wide window stays usable; sample if needed
  const CAP = 4000;
  const shown = inWin.length > CAP && mode !== 'heat' ? sample(inWin, CAP) : inWin;

  const features = shown.map(p => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: {
      color: DISTRICT_COLORS[p.districtIdx] || '#ef4444',
      date: p.date.toISOString().slice(0, 10),
    },
  }));

  map.getSource('points').setData({ type: 'FeatureCollection', features });

  // Ensure correct layer visibility
  if (mode === 'heat') {
    map.setLayoutProperty('points-heat', 'visibility', 'visible');
    map.setLayoutProperty('points-dots', 'visibility', 'none');
  } else {
    map.setLayoutProperty('points-heat', 'visibility', 'none');
    map.setLayoutProperty('points-dots', 'visibility', 'visible');
  }

  return shown.length < inWin.length
    ? { shown: shown.length, total: inWin.length }
    : { shown: inWin.length, total: inWin.length };
}

function sample(arr, n) {
  const stride = arr.length / n;
  const out = [];
  for (let i = 0; i < arr.length; i += stride) out.push(arr[Math.floor(i)]);
  return out;
}
