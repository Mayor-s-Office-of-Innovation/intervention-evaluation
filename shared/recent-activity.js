// ──────────────────────────────────────────────────────────────────────
// "Where reports are appearing recently" — an EVERGREEN, district-scoped
// operational view, separate from the baked hot/cold (difference-in-differences)
// map. Shows WHERE reports are (clickable hexbin density map) and WHEN
// (hour-of-day bar strip that also brushes the map). See plan-recent-activity-map.md.
//
// Data: queried LIVE from DataSF (Socrata), no backend/key (same pattern as the
// hypothesis tool). Per signal, two small queries: (1) max(dateCol) → anchor, then
// (2) the trailing MAX_WEEKS window in the district's bounding box. Recency chips
// (1/2/4/8w) re-slice the fetched rows client-side. District is matched to the
// dashboard's OWN geometry by point-in-polygon against police_districts.geojson
// (native district fields are unreliable — the builds ignore them too).
//
// Generic over a `signal` config so both dashboards reuse it:
//   { key, dataset, dateCol, where, nameCol, label,
//     geo: {kind:'point', col} | {kind:'latlong', latCol, lngCol} }
// Pass one or more; with ≥2 a signal picker renders into #ra-signal.
// ──────────────────────────────────────────────────────────────────────

const MAX_WEEKS = 8;                       // widest window we ever fetch
const MAX_ROWS = 10000;                    // generous cap (a district's 8wk stays well under)
const RECENCY = [1, 2, 4, 8];              // chip options (weeks)
const DEFAULT_WEEKS = 4;
const HEXR = 13;                           // px hex radius (small = granular)
// teal sequential ramp — validated monotonic-L, distinct from the categorical
// hot/cold palette (persistent=red / emerged=amber / cooled=blue).
const RAMP = ['#d8f3ea', '#a6e3d0', '#6bcbb0', '#2ba98a', '#158066', '#0c5a48'];

const isDark = () => document.documentElement.classList.contains('wa-dark');
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS = { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO' };

// ── date helpers — floating timestamps are NAIVE Pacific local ("2026-07-14T18:14:30.000"),
// so read wall-clock fields off the string; never via new Date() (that applies browser tz). ──
const hourOf = s => parseInt(s.slice(11, 13), 10);
function isoMinusWeeks(iso, weeks) {
  const d = new Date(iso.slice(0, 19) + 'Z');
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return d.toISOString().slice(0, 19);           // naive-local comparison string
}
const hourLabel = h => h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? h + 'a' : (h - 12) + 'p';
const titleCase = s => s ? s[0] + s.slice(1).toLowerCase() : s;

// ── per-signal Socrata shape (abstracts point-geo vs lat/long-column datasets) ──
const sodaUrl = sig => `https://data.sfgov.org/resource/${sig.dataset}.json`;
function bboxClause(sig, b) {
  if (sig.geo.kind === 'point')
    return `within_box(${sig.geo.col}, ${b.maxY}, ${b.minX}, ${b.minY}, ${b.maxX})`;
  const { latCol, lngCol } = sig.geo;
  return `${latCol} >= ${b.minY} AND ${latCol} <= ${b.maxY} AND ${lngCol} >= ${b.minX} AND ${lngCol} <= ${b.maxX}`;
}
const selectClause = sig => sig.geo.kind === 'point'
  ? `${sig.nameCol}, ${sig.dateCol}, ${sig.geo.col}`
  : `${sig.nameCol}, ${sig.dateCol}, ${sig.geo.latCol}, ${sig.geo.lngCol}`;
function coordOf(sig, r) {
  if (sig.geo.kind === 'point') {
    const p = r[sig.geo.col];
    if (!p || !p.coordinates) return null;
    return { lng: +p.coordinates[0], lat: +p.coordinates[1] };
  }
  const lat = +r[sig.geo.latCol], lng = +r[sig.geo.lngCol];
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}
// "50 MORRIS ST, SAN FRANCISCO, CA 94107" → "50 MORRIS ST";
// "INTERSECTION EDDY ST, HYDE ST, SAN FRANCISCO, CA 94102" → "EDDY ST, HYDE ST";
// "EDDY ST \\ HYDE ST" (CFS intersection) → "EDDY ST / HYDE ST".
const nameOf = (sig, r) => (r[sig.nameCol] || '')
  .replace(/,?\s*SAN FRANCISCO\b.*$/i, '')        // drop the city/state/zip tail (keep intersections)
  .replace(/^INTERSECTION\s+/i, '')
  .replace(/ \\ /g, ' / ').replace(/\\/g, ' / ').trim();

// ── point-in-polygon (ray cast) against a GeoJSON MultiPolygon feature, holes honored ──
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function inFeature(x, y, feature) {
  const g = feature.geometry;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  for (const poly of polys) {
    if (inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h))) return true;
  }
  return false;
}
function bboxOf(feature) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const g = feature.geometry;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

async function sodaJson(sig, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${sodaUrl(sig)}?${qs}`);
  if (!res.ok) throw new Error(`DataSF request failed (HTTP ${res.status})`);
  return res.json();
}

// ── the controller ──
export function initRecentActivity({ districtName, districtFeature, signals }) {
  const el = {
    status: document.getElementById('ra-status'),
    body: document.getElementById('ra-body'),
    signal: document.getElementById('ra-signal'),
    recency: document.getElementById('ra-recency'),
    hours: document.getElementById('ra-hours'),
    map: document.getElementById('ra-map'),
    note: document.getElementById('ra-note'),
  };
  if (!el.map || !signals || !signals.length) return;

  const bbox = bboxOf(districtFeature);
  let sig = signals[0];      // active signal
  let allRows = [];          // fetched window rows, PIP-filtered to the district, {lat,lng,name,hour,iso}
  let anchor = null;         // latest dateCol value (data-anchored)
  let weeks = DEFAULT_WEEKS;
  let brushed = new Set();   // selected hours (0–23); empty = all hours
  let map, hexLayer;

  const status = (msg, kind = 'info') => {
    el.status.hidden = false;
    el.status.className = `ra-status ra-status--${kind}`;
    el.status.textContent = msg;
  };
  const clearStatus = () => { el.status.hidden = true; };

  // ── fetch: anchor (max) then the trailing MAX_WEEKS window in the district bbox ──
  async function load() {
    status('Loading recent reports from DataSF…');
    try {
      const where = `${sig.where} AND ${bboxClause(sig, bbox)}`;
      const maxRow = await sodaJson(sig, { '$select': `max(${sig.dateCol}) as mx`, '$where': where });
      anchor = maxRow[0] && maxRow[0].mx;
      if (!anchor) { allRows = []; status('No recent reports found for this district.', 'empty'); return; }

      const rows = await sodaJson(sig, {
        '$select': selectClause(sig),
        '$where': `${where} AND ${sig.dateCol} >= '${isoMinusWeeks(anchor, MAX_WEEKS)}'`,
        '$order': `${sig.dateCol} DESC`,
        '$limit': String(MAX_ROWS),
      });
      // map + PIP to the district's real polygon (matches the dashboard, not the native district field)
      allRows = [];
      for (const r of rows) {
        const c = coordOf(sig, r);
        if (!c || !inFeature(c.lng, c.lat, districtFeature)) continue;
        const dt = r[sig.dateCol];
        allRows.push({ lat: c.lat, lng: c.lng, hour: hourOf(dt), iso: dt, name: nameOf(sig, r) });
      }
      clearStatus();
      el.body.hidden = false;    // reveal before creating the Leaflet map so it gets a real size
      if (!map) buildMap();      // map is built once; signal/recency switches just redraw
      redraw();
    } catch (e) {
      status(`Couldn’t reach DataSF — recent activity is unavailable right now. (${e.message})`, 'error');
      console.error('[recent-activity]', e);
    }
  }

  const inWindow = () => {
    const start = isoMinusWeeks(anchor, weeks);
    return allRows.filter(r => r.iso >= start);
  };
  // A runnable Socrata link that reproduces the data shown: the signal filter + this district's
  // bounding box + the current recency window (the map then clips to the district polygon and any
  // hour brush client-side, as the note explains). Mirrors the load() fetch at the current `weeks`.
  const soqlLink = () => {
    if (!anchor) return null;
    const where = `(${sig.where}) AND ${bboxClause(sig, bbox)} AND ${sig.dateCol} >= '${isoMinusWeeks(anchor, weeks)}'`;
    const qs = new URLSearchParams({
      '$select': selectClause(sig), '$where': where,
      '$order': `${sig.dateCol} DESC`, '$limit': String(MAX_ROWS),
    });
    return `${sodaUrl(sig)}?${qs}`;
  };
  const rampColor = (frac) => {
    const ramp = isDark() ? [...RAMP].reverse() : RAMP;
    return ramp[Math.max(0, Math.min(5, Math.floor(frac * 5.999)))];
  };

  // ── signal picker (only with ≥2 signals) ──
  function buildSignalPicker() {
    if (!el.signal || signals.length < 2) return;
    el.signal.innerHTML = '';
    signals.forEach(s => {
      const b = document.createElement('button');
      b.className = 'seg' + (s === sig ? ' is-active' : '');
      b.textContent = s.chip || s.label;
      b.setAttribute('aria-pressed', String(s === sig));
      b.onclick = () => { if (s === sig) return; sig = s; buildSignalPicker(); load(); };
      el.signal.appendChild(b);
    });
  }

  // ── recency chips ──
  function buildRecency() {
    el.recency.innerHTML = '';
    RECENCY.forEach(w => {
      const b = document.createElement('button');
      b.className = 'seg' + (w === weeks ? ' is-active' : '');
      b.textContent = w === 1 ? 'Last 1 wk' : `Last ${w} wks`;
      b.setAttribute('aria-pressed', String(w === weeks));
      b.onclick = () => { weeks = w; buildRecency(); redraw(); };
      el.recency.appendChild(b);
    });
  }

  // ── hour-of-day bars (also the brush). Day-of-week is a weak signal at a single district's
  // volume; hour-of-day is the clean dawn-to-dusk signal, so we collapse to hours. ──
  function redraw() {
    const rows = inWindow();
    const byHour = new Array(24).fill(0);
    rows.forEach(r => { byHour[r.hour]++; });

    const brushLabel = () => {
      const hrs = [...brushed].sort((a, b) => a - b);
      return hrs.length ? ` · filtered to ${hrs.map(hourLabel).join(', ')}` : '';
    };
    const q = soqlLink();
    el.note.innerHTML =
      `Live from DataSF (<a href="https://data.sfgov.org/d/${sig.dataset}" target="_blank" rel="noopener">${sig.dataset}</a>) · ` +
      `${sig.label} in ${titleCase(districtName)} · ` +
      `last ${weeks} week${weeks > 1 ? 's' : ''} through ${anchor.slice(0, 10)} · ${rows.length} reports` +
      brushLabel() +
      `. Live data may be newer than the rest of this page` +
      (q ? ` · <a href="${q}" target="_blank" rel="noopener">run this query ↗</a>` : '') +
      `. <button type="button" class="ra-clear"${brushed.size ? '' : ' hidden'}>Show all hours</button>`;
    const clr = el.note.querySelector('.ra-clear');
    if (clr) clr.onclick = () => { brushed.clear(); redraw(); };

    drawHours(byHour);
    drawHexes(rows);
  }

  function drawHours(byHour) {
    const max = Math.max(1, ...byHour);
    const bars = ['<div class="ra-hours__bars">'];
    for (let h = 0; h < 24; h++) {
      const c = byHour[h], avg = c / weeks;
      const on = !brushed.size || brushed.has(h);
      const label = `${hourLabel(h)} — ${c} report${c === 1 ? '' : 's'} (avg ${avg.toFixed(1)}/wk)`;
      bars.push(
        `<button class="ra-bar${on ? '' : ' ra-bar--off'}" data-hour="${h}" title="${label}" aria-label="${label}">` +
        `<span class="ra-bar__fill" style="height:${Math.round((c / max) * 100)}%"></span></button>`
      );
    }
    bars.push('</div><div class="ra-hours__axis">' +
      [0, 6, 12, 18, 23].map(h => `<span>${hourLabel(h)}</span>`).join('') + '</div>');
    el.hours.innerHTML = bars.join('');
  }

  // Live-toggle the dimmed state of every bar from the current `brushed` set (no rebuild during drag).
  function refreshBarsOff() {
    const any = brushed.size > 0;
    el.hours.querySelectorAll('.ra-bar').forEach(b =>
      b.classList.toggle('ra-bar--off', any && !brushed.has(+b.dataset.hour)));
  }

  // Click a bar to toggle that hour; press-and-drag to paint a run of hours (add or remove, decided
  // by the bar the drag starts on). Map + note recompute only on release (redraw), not mid-drag.
  function wireHourBrush() {
    let dragging = false, mode = 'add';
    const barAt = (x, y) => { const t = document.elementFromPoint(x, y); return t && t.closest ? t.closest('.ra-bar') : null; };
    const paint = h => { if (h == null) return; mode === 'add' ? brushed.add(h) : brushed.delete(h); refreshBarsOff(); };
    el.hours.addEventListener('pointerdown', e => {
      const b = e.target.closest && e.target.closest('.ra-bar');
      if (!b) return;
      e.preventDefault(); dragging = true;
      try { el.hours.setPointerCapture(e.pointerId); } catch (_) {}
      const h = +b.dataset.hour;
      mode = brushed.has(h) ? 'del' : 'add';
      paint(h);
    });
    el.hours.addEventListener('pointermove', e => { if (dragging) { const b = barAt(e.clientX, e.clientY); if (b) paint(+b.dataset.hour); } });
    const end = () => { if (dragging) { dragging = false; redraw(); } };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }

  // ── clickable hexbin density map ──
  function buildMap() {
    map = L.map(el.map, { scrollWheelZoom: false })
      .fitBounds([[bbox.minY, bbox.minX], [bbox.maxY, bbox.maxX]]);
    L.tileLayer(isDark() ? TILE_DARK : TILE_LIGHT, TILE_OPTS).addTo(map);
    hexLayer = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 0);   // in case the container just un-hid
    map.on('moveend zoomend', () => drawHexes(inWindow()));
    window.addEventListener('themechange', () => {
      map.eachLayer(l => { if (l.setUrl) l.setUrl(isDark() ? TILE_DARK : TILE_LIGHT); });
      redraw();
    });
  }
  function cubeRound(q, r) {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    return [rx, rz];
  }
  function drawHexes(rows) {
    if (!hexLayer) return;
    hexLayer.clearLayers();
    const pts = brushed.size ? rows.filter(r => brushed.has(r.hour)) : rows;
    const bins = new Map();
    pts.forEach(n => {
      const p = map.latLngToLayerPoint([n.lat, n.lng]);
      const q = (2 / 3 * p.x) / HEXR;
      const rr = (-1 / 3 * p.x + Math.sqrt(3) / 3 * p.y) / HEXR;
      const [hq, hr] = cubeRound(q, rr);
      const key = hq + ',' + hr;
      const b = bins.get(key) || { hq, hr, count: 0, corners: new Map() };
      b.count++;
      b.corners.set(n.name, (b.corners.get(n.name) || 0) + 1);
      bins.set(key, b);
    });
    const max = Math.max(1, ...[...bins.values()].map(b => b.count));
    bins.forEach(b => {
      const cx = HEXR * 1.5 * b.hq, cy = HEXR * Math.sqrt(3) * (b.hr + b.hq / 2);
      const verts = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 180 * (60 * i);
        verts.push(map.layerPointToLatLng(L.point(cx + HEXR * Math.cos(a), cy + HEXR * Math.sin(a))));
      }
      const rowsHtml = [...b.corners.entries()].sort((a, c) => c[1] - a[1])
        .map(([nm, c]) => `<tr><td>${nm || '<em>unnamed</em>'}</td><td class="n">${c}</td></tr>`).join('');
      const popup = `<div class="ra-pop"><strong>${b.count} report${b.count > 1 ? 's' : ''}</strong>` +
        `<span class="sub"> · ${b.corners.size} location${b.corners.size > 1 ? 's' : ''}</span>` +
        `<table><thead><tr><th>Location</th><th class="n">Reports</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
      L.polygon(verts, {
        className: 'ra-hex', color: isDark() ? '#1e293b' : '#ffffff', weight: 1,
        fillColor: rampColor(b.count / max), fillOpacity: 0.82,
      }).bindTooltip(`${b.count} report${b.count > 1 ? 's' : ''} — click for locations`)
        .bindPopup(popup, { maxWidth: 280 })
        .addTo(hexLayer);
    });
  }

  buildSignalPicker();
  buildRecency();
  wireHourBrush();
  load();
}
