// Shoplifting concentration map + time scrubber (Workstreams C + E).
//
// STATIC concentration only — NOT a "what moved / since Lurie" transition map. Corner-level
// movement for shoplifting is single-store reporting-regime churn (one retailer's loss-prevention
// paperwork switching on/off), not crime relocating, so there is no hot/cold/DiD/baseline here —
// just "where reports concentrated in the selected window" as absolute counts. See
// theft/plan-property-crime-expansion.md §C and map-hotspot-findings.md.
//
// The scrubber (E) picks the window the map aggregates: preset pills + a brushable month strip.
// One month (the latest complete-but-still-settling month) is shaded, tuned to theft's fast
// reported settling (§F) — one month, not the two copied from CFS/drug.
//
// Self-contained: loads its own data/shoplifting-map.json on first scroll into view (CLS-friendly),
// owns its Leaflet map, and reuses the shared cross-street search widget. Leaflet is the global `L`
// (CDN in index.html). Theme-aware via the page's `themechange` event.
import { wireSearch, resolveIntersection, buildLocalIndex } from '../../shared/cross-street-search.js';
import { isCitywide } from '../../shared/districts.js';

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS  = { subdomains: 'abcd', maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' };
const TOP_N = 12;               // ranked side list length
const isDark = () => document.documentElement.classList.contains('wa-dark');
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let DATA = null;                // the loaded artifact
let months = [], completeIdx = 0, settledIdx = 0, lurieIdx = 0;
let district = 'Northern';
let win = { lo: 0, hi: 0 };
let PRESETS = [];

let map = null, tile = null, markerLayer = null, searchPin = null;
let localIndex = [];            // shared-search local tier for the active district
let started = false;            // map lib initialized
let brushing = null;            // drag anchor index while brushing the strip

const $ = sel => document.querySelector(sel);

// ── data helpers ─────────────────────────────────────────────────────────
// Citywide: union every district's corners so the map, strip, bbox, and list span the whole city.
const corners = () => !DATA ? []
  : isCitywide(district) ? Object.values(DATA.districts).flat()
  : (DATA.districts[district] || []);

// Absolute reports at a corner over [win.lo, win.hi] (the corner's `m` dict is sparse).
function windowCount(corner) {
  let n = 0;
  for (let i = win.lo; i <= win.hi; i++) { const v = corner.m[months[i]]; if (v) n += v; }
  return n;
}

// District-wide monthly totals (for the strip's bar heights), indexed like `months`.
function districtMonthly() {
  const out = new Array(months.length).fill(0);
  for (const c of corners()) for (const [ym, v] of Object.entries(c.m)) {
    const i = months.indexOf(ym); if (i >= 0) out[i] += v;
  }
  return out;
}

function bbox() {
  const cs = corners();
  let latMin = 90, latMax = -90, lngMin = 180, lngMax = -180;
  for (const c of cs) {
    latMin = Math.min(latMin, c.lat); latMax = Math.max(latMax, c.lat);
    lngMin = Math.min(lngMin, c.lng); lngMax = Math.max(lngMax, c.lng);
  }
  return { latMin, latMax, lngMin, lngMax };
}
const inBbox = (lat, lng) => {
  const b = bbox(), pad = 0.01;
  return lat >= b.latMin - pad && lat <= b.latMax + pad && lng >= b.lngMin - pad && lng <= b.lngMax + pad;
};

const prettyMonth = ym => {
  const [y, m] = ym.split('-');
  return new Date(y, m - 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

// ── scrubber ─────────────────────────────────────────────────────────────
function buildPresets() {
  const L = completeIdx;
  PRESETS = [
    { id: '1mo',   label: 'Last month',  lo: L,                    hi: L },
    { id: '3mo',   label: 'Last 3 mo',   lo: Math.max(0, L - 2),   hi: L },
    { id: '12mo',  label: 'Last 12 mo',  lo: Math.max(0, L - 11),  hi: L },
    { id: 'lurie', label: 'Since Lurie', lo: lurieIdx,             hi: L },
    { id: 'all',   label: 'All time',    lo: 0,                    hi: L },
  ];
}

function clampWin(lo, hi) {
  lo = Math.max(0, Math.min(lo, completeIdx));
  hi = Math.max(lo, Math.min(hi, completeIdx));
  return { lo, hi };
}

function renderScrubber() {
  const active = PRESETS.find(p => p.lo === win.lo && p.hi === win.hi);
  const host = $('#sm-presets');
  if (host) {
    host.innerHTML = PRESETS.map(p =>
      `<button type="button" class="sm-seg ${active && active.id === p.id ? 'is-active' : ''}" data-preset="${p.id}">${p.label}</button>`
    ).join('') + (active ? '' : '<span class="sm-seg is-custom" aria-disabled="true">Custom window</span>');
    host.querySelectorAll('button[data-preset]').forEach(b =>
      b.onclick = () => { const p = PRESETS.find(x => x.id === b.dataset.preset); setWindow(p.lo, p.hi); });
  }
  const n = win.hi - win.lo + 1;
  const span = win.lo === win.hi ? prettyMonth(months[win.lo])
    : `${prettyMonth(months[win.lo])} – ${prettyMonth(months[win.hi])}`;
  const lbl = $('#sm-window-label');
  if (lbl) lbl.innerHTML = `<strong>${span}</strong> <small>(${n} mo)</small> · concentration by corner, absolute reports`;
  renderStrip();
}

// Brushable month strip: one bar per month (0…completeIdx), height ∝ district total.
// The single still-settling month is shaded; the selected window is highlighted.
function renderStrip() {
  const host = $('#sm-strip');
  if (!host) return;
  const totals = districtMonthly();
  const max = Math.max(1, ...totals.slice(0, completeIdx + 1));
  let html = '';
  for (let i = 0; i <= completeIdx; i++) {
    const h = Math.max(4, Math.round((totals[i] / max) * 100));
    const inWin = i >= win.lo && i <= win.hi;
    const settling = i === completeIdx && completeIdx > settledIdx;
    const lurie = i === lurieIdx;
    html += `<span class="sm-bar${inWin ? ' is-in' : ''}${settling ? ' is-settling' : ''}${lurie ? ' is-lurie' : ''}" `
      + `data-idx="${i}" style="height:${h}%" title="${prettyMonth(months[i])}: ${totals[i]} reports${settling ? ' · still settling' : ''}"></span>`;
  }
  host.innerHTML = html;
}

function setWindow(lo, hi) { win = clampWin(lo, hi); renderScrubber(); renderMarkers(); renderList(); }

// ── strip brushing (pointer drag over the bars) ──────────────────────────
function idxFromEvent(host, e) {
  const rect = host.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(completeIdx, Math.round(frac * completeIdx)));
}
function wireStripBrush() {
  const host = $('#sm-strip');
  if (!host) return;
  host.addEventListener('pointerdown', e => {
    e.preventDefault();
    brushing = idxFromEvent(host, e);
    host.setPointerCapture(e.pointerId);
    win = clampWin(brushing, brushing); renderScrubber();
  });
  host.addEventListener('pointermove', e => {
    if (brushing == null) return;
    const cur = idxFromEvent(host, e);
    win = clampWin(Math.min(brushing, cur), Math.max(brushing, cur));
    renderScrubber();
  });
  const end = () => { if (brushing != null) { brushing = null; renderMarkers(); renderList(); } };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
}

// ── map ──────────────────────────────────────────────────────────────────
function ensureMap() {
  if (map) return;
  map = L.map('sm-map', { scrollWheelZoom: false });
  tile = L.tileLayer(isDark() ? TILE_DARK : TILE_LIGHT, TILE_OPTS).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  const b = bbox();
  map.fitBounds([[b.latMin, b.lngMin], [b.latMax, b.lngMax]], { padding: [24, 24] });
}

function renderMarkers() {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  const cs = corners().map(c => ({ c, n: windowCount(c) })).filter(x => x.n > 0);
  const max = Math.max(1, ...cs.map(x => x.n));
  const fill = cssVar('--chart-monthly') || '#e8590c';
  for (const { c, n } of cs) {
    const r = 4 + 20 * Math.sqrt(n / max);        // area ∝ count
    L.circleMarker([c.lat, c.lng], {
      radius: r, color: fill, weight: 1, fillColor: fill, fillOpacity: 0.45, opacity: 0.9,
    }).bindTooltip(`<strong>${c.i}</strong><br>${n} report${n === 1 ? '' : 's'} in window`,
      { direction: 'top' }).addTo(markerLayer);
  }
}

function focusCorner(lat, lng, name, count) {
  ensureMap();
  map.setView([lat, lng], 16, { animate: true });
  if (searchPin) { map.removeLayer(searchPin); searchPin = null; }
  searchPin = L.marker([lat, lng], {
    icon: L.divIcon({ className: 'search-marker', html: '<span class="search-marker__pin"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
  }).addTo(map);
  const body = count != null ? `${name}<br>${count} report${count === 1 ? '' : 's'} in window` : name;
  searchPin.bindTooltip(body, { direction: 'top', permanent: false }).openTooltip();
}

// ── ranked side list ──────────────────────────────────────────────────────
function renderList() {
  const host = $('#sm-list');
  if (!host) return;
  const scored = corners().map(c => ({ c, n: windowCount(c) })).filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const total = scored.reduce((s, x) => s + x.n, 0);
  const top = scored.slice(0, TOP_N);
  const max = Math.max(1, ...top.map(x => x.n));
  if (!top.length) { host.innerHTML = '<p class="sm-empty">No shoplifting reports in this window.</p>'; return; }
  host.innerHTML = top.map(({ c, n }) => {
    const share = total ? Math.round((n / total) * 100) : 0;
    return `<button type="button" class="sm-rank" data-lat="${c.lat}" data-lng="${c.lng}" data-name="${escAttr(c.i)}" data-n="${n}">`
      + `<span class="sm-rank__label">${titleCase(c.i)}</span>`
      + `<span class="sm-rank__track"><span class="sm-rank__fill" style="width:${Math.round((n / max) * 100)}%"></span></span>`
      + `<span class="sm-rank__val">${n}<small> · ${share}%</small></span></button>`;
  }).join('');
  host.querySelectorAll('.sm-rank').forEach(b => b.onclick = () =>
    focusCorner(+b.dataset.lat, +b.dataset.lng, titleCase(b.dataset.name), +b.dataset.n));
}

// ── search ─────────────────────────────────────────────────────────────────
function wireMapSearch() {
  wireSearch({
    containerSel: '#sm-search',
    label: 'Find a corner',
    placeholder: 'e.g. Powell & Market',
    onSearch: async (query, { setStatus }) => {
      const res = await resolveIntersection(query, { localIndex, inDistrict: inBbox });
      if (res.status === 'need-two') return setStatus('Enter two cross streets, e.g. Powell & Market', true);
      if (res.status === 'none')    return setStatus('No matching SF corner found', true);
      if (res.status === 'error')   return setStatus('Search unavailable — try again', true);
      if (res.status === 'out-of-district')
        return setStatus(`${res.name} is outside the ${district} map area`, true);
      // local = a corner we actually track; city = a real corner with no shoplifting reports here
      if (res.status === 'local') {
        const c = corners().find(x => x.i.toUpperCase() === (res.entry.name || res.name).toUpperCase());
        focusCorner(res.lat, res.lng, titleCase(res.name), c ? windowCount(c) : null);
        setStatus('');
      } else {
        focusCorner(res.lat, res.lng, titleCase(res.name), 0);
        setStatus(res.nearby ? `No reports at that corner (nearest tracked: ${titleCase(res.nearName)})`
                             : 'No shoplifting reports at that corner in range');
      }
    },
    onClear: () => { if (searchPin) { map.removeLayer(searchPin); searchPin = null; } },
  });
}

// ── theme sync ─────────────────────────────────────────────────────────────
function onTheme() {
  if (tile) tile.setUrl(isDark() ? TILE_DARK : TILE_LIGHT);
  renderMarkers();
}

// ── lifecycle ────────────────────────────────────────────────────────────
function start() {
  if (started) return; started = true;
  ensureMap();
  buildStripLegend();
  wireStripBrush();
  wireMapSearch();
  renderScrubber();
  renderMarkers();
  renderList();
  window.addEventListener('themechange', onTheme);
  // Leaflet needs a size recalc once its container is actually visible.
  setTimeout(() => map && map.invalidateSize(), 60);
}

function buildStripLegend() {
  const el = $('#sm-strip-legend');
  if (el) el.innerHTML =
    `<span class="sm-lg"><i class="sm-lg__lurie"></i> Lurie term start (Jan 2025)</span>`
    + `<span class="sm-lg"><i class="sm-lg__settling"></i> still settling (${prettyMonth(months[completeIdx])})</span>`;
}

/** Called once by app.js after the first district render. Lazy-loads the artifact + inits the
 *  map only when the section scrolls near the viewport (keeps it off the critical path). */
export function initShopliftingMap(activeDistrict) {
  district = activeDistrict || 'Northern';
  const section = $('#shoplifting-map-section');
  if (!section) return;
  const load = () => fetch(new URL('../data/shoplifting-map.json', import.meta.url))
    .then(r => r.json())
    .then(d => {
      DATA = d;
      months = d.months;
      completeIdx = months.indexOf(d.latest_complete_month);
      settledIdx = months.indexOf(d.latest_settled_month);
      lurieIdx = Math.max(0, months.indexOf(d.lurie_month));
      buildPresets();
      const lurie = PRESETS.find(p => p.id === 'lurie');
      win = clampWin(lurie.lo, lurie.hi);
      localIndex = buildLocalIndex(corners().map(c => ({ name: c.i, lat: c.lat, lng: c.lng })));
      start();
    })
    .catch(() => { const h = $('#sm-map'); if (h) h.innerHTML = '<p class="error">Map data unavailable.</p>'; });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries, obs) => {
      if (entries.some(e => e.isIntersecting)) { obs.disconnect(); load(); }
    }, { rootMargin: '200px' });
    io.observe(section);
  } else { load(); }
}

/** Hash-route district change (app.js calls this). Re-scopes local index, refits, repaints. */
export function setShopliftingDistrict(activeDistrict) {
  district = activeDistrict || 'Northern';
  if (!DATA || !started) return;
  localIndex = buildLocalIndex(corners().map(c => ({ name: c.i, lat: c.lat, lng: c.lng })));
  if (searchPin) { map.removeLayer(searchPin); searchPin = null; }
  const b = bbox();
  map.fitBounds([[b.latMin, b.lngMin], [b.latMax, b.lngMax]], { padding: [24, 24] });
  renderScrubber();
  renderMarkers();
  renderList();
}

// ── tiny helpers ───────────────────────────────────────────────────────────
function titleCase(s) {
  // corners are stored UPPERCASE with a backslash separator — "CALIFORNIA ST \ POLK ST"
  return String(s).replace(/\s*\\\s*/g, ' & ').toLowerCase()
    .replace(/\b([a-z])/g, m => m.toUpperCase());
}
function escAttr(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
