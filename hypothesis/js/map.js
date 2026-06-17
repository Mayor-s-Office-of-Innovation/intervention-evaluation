// ──────────────────────────────────────────────────────────────────────
// Mapbox GL JS maps — uses the global `mapboxgl` (loaded via CDN in index.html).
//   initPicker()   → the location picker in the input panel
//   renderEvents() → the result map with one dot per 911 call
// Both pure consumers: given a {lat,lng} + events, they draw. No fetch.
// ──────────────────────────────────────────────────────────────────────

import { MAPBOX_TOKEN, STYLE_LIGHT, STYLE_DARK, isDark, getStyle } from '../../shared/mapbox-config.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const maps = [];
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const style = getStyle();
  for (const map of maps) map.setStyle(style);
});

/**
 * Location picker. Click or drag to choose a point.
 * @returns {{setLocation:Function, setRadius:Function}}
 */
export function initPicker(el, init, onChange, radiusM = 250) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const map = new mapboxgl.Map({
    container: el,
    style: getStyle(),
    center: [init.lng, init.lat],
    zoom: 15,
  });
  maps.push(map);

  let marker = null;
  let circleLayerAdded = false;

  map.on('load', () => {
    // Add circle source and layer for radius
    map.addSource('picker-circle', {
      type: 'geojson',
      data: createCircleGeoJSON(init.lng, init.lat, radiusM),
    });

    map.addLayer({
      id: 'picker-circle-fill',
      type: 'fill',
      source: 'picker-circle',
      paint: {
        'fill-color': '#3b82f6',
        'fill-opacity': 0.05,
      },
    });

    map.addLayer({
      id: 'picker-circle-line',
      type: 'line',
      source: 'picker-circle',
      paint: {
        'line-color': '#3b82f6',
        'line-width': 1,
      },
    });

    circleLayerAdded = true;

    // Add draggable marker
    marker = new mapboxgl.Marker({ draggable: true })
      .setLngLat([init.lng, init.lat])
      .addTo(map);

    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      updateCircle(lngLat.lng, lngLat.lat);
      onChange({ lat: lngLat.lat, lng: lngLat.lng });
    });

    // Click to move marker
    map.on('click', (e) => {
      marker.setLngLat(e.lngLat);
      updateCircle(e.lngLat.lng, e.lngLat.lat);
      onChange({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
  });

  let currentRadius = radiusM;

  function updateCircle(lng, lat) {
    if (circleLayerAdded) {
      map.getSource('picker-circle').setData(createCircleGeoJSON(lng, lat, currentRadius));
    }
  }

  return {
    setLocation: ll => {
      if (marker) {
        marker.setLngLat([ll.lng, ll.lat]);
        updateCircle(ll.lng, ll.lat);
      }
    },
    setRadius: r => {
      currentRadius = r;
      if (marker) {
        const lngLat = marker.getLngLat();
        updateCircle(lngLat.lng, lngLat.lat);
        if (map.getZoom() > 14 && r >= 700) {
          map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 14 });
        }
      }
    },
  };
}

// Create a GeoJSON circle polygon
function createCircleGeoJSON(lng, lat, radiusM, points = 64) {
  const coords = [];
  const km = radiusM / 1000;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = km * Math.cos(angle);
    const dy = km * Math.sin(angle);
    // Approximate conversion to degrees
    const dLng = dx / (111.32 * Math.cos(lat * Math.PI / 180));
    const dLat = dy / 110.574;
    coords.push([lng + dLng, lat + dLat]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

let eMap = null;
let popup = null;

/**
 * Draw the result map: pin + radius + one dot per event.
 * @param {{recenter?:boolean}} [opts] recenter the view on the pin (default true).
 *   Pass false for slider-driven window changes so the user's pan/zoom is kept.
 */
export function renderEvents(el, center, radiusM, events, { recenter = true } = {}) {
  if (!eMap) {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    eMap = new mapboxgl.Map({
      container: el,
      style: getStyle(),
      center: [center.lng, center.lat],
      zoom: 15,
    });
    maps.push(eMap);
    popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true });

    eMap.on('load', () => {
      setupEventsSources();
      renderEventsData(center, radiusM, events);
    });
  } else {
    if (recenter) {
      eMap.flyTo({ center: [center.lng, center.lat], zoom: 15, duration: 0 });
    }
    if (eMap.loaded()) {
      renderEventsData(center, radiusM, events);
    }
  }
}

function setupEventsSources() {
  // Circle source for radius
  eMap.addSource('events-circle', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  eMap.addLayer({
    id: 'events-circle-fill',
    type: 'fill',
    source: 'events-circle',
    paint: {
      'fill-color': '#3b82f6',
      'fill-opacity': 0.04,
    },
  });

  eMap.addLayer({
    id: 'events-circle-line',
    type: 'line',
    source: 'events-circle',
    paint: {
      'line-color': '#3b82f6',
      'line-width': 1,
    },
  });

  // Events dots source
  eMap.addSource('events-dots', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  eMap.addLayer({
    id: 'events-dots-layer',
    type: 'circle',
    source: 'events-dots',
    paint: {
      'circle-radius': 5,
      'circle-color': '#ef4444',
      'circle-opacity': 0.7,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#b91c1c',
    },
  });

  // Click handler for dots
  eMap.on('click', 'events-dots-layer', (e) => {
    if (!e.features.length) return;
    const feat = e.features[0];
    const p = feat.properties;
    popup.setLngLat(feat.geometry.coordinates)
      .setHTML(`<strong>${esc(p.day)}</strong><br>${esc(p.place)}<br><em>${esc(p.notes) || '(no details)'}</em>`)
      .addTo(eMap);
  });

  eMap.on('mouseenter', 'events-dots-layer', () => { eMap.getCanvas().style.cursor = 'pointer'; });
  eMap.on('mouseleave', 'events-dots-layer', () => { eMap.getCanvas().style.cursor = ''; });
}

let eventsMarker = null;

function renderEventsData(center, radiusM, events) {
  // Update circle
  eMap.getSource('events-circle').setData(createCircleGeoJSON(center.lng, center.lat, radiusM));

  // Update or create center marker
  if (eventsMarker) {
    eventsMarker.setLngLat([center.lng, center.lat]);
  } else {
    eventsMarker = new mapboxgl.Marker()
      .setLngLat([center.lng, center.lat])
      .addTo(eMap);
  }

  // Update event dots
  const features = events
    .filter(ev => ev.lat != null && ev.lng != null)
    .map(ev => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ev.lng, ev.lat] },
      properties: {
        day: ev.day,
        place: ev.place,
        notes: ev.notes,
      },
    }));

  eMap.getSource('events-dots').setData({ type: 'FeatureCollection', features });
}
