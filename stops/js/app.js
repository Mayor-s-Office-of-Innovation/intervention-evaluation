// ──────────────────────────────────────────────────────────────────────
// Stops tool — universal stop lookup + concern-list overlay (stops/plan.md D1).
// Pre-baked JSON only: data/stops.json (meta), data/series/NN.json (lazy, per shard),
// data/concern.json, data/citywide.json, data/provenance.json. No live Socrata calls.
// ──────────────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const fmt = n => (n == null ? '—' : n.toLocaleString());
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SIG_COLOR = { encampment: '#f97316', shelter_maint: '#0d9488', cfs_presence: '#8b5cf6', cfs_drug: '#ef4444' };
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = ym => `${MONTH_ABBR[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
// Exclusive upper bound for the 12-month window: the first day of the month after it ends.
const t12End = () => {
  const [y, m] = META.t12_window[1].split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_345x_1_c35f447893a720bcee1599fe';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_345x_1_c35f447893a720bcee1599fe';
// "Streets first": OpenStreetMap's standard style draws every street with an outline and a name, which the
// Carto base does not at these zooms. No dark variant exists, so dark mode applies a CSS invert (styles.css).
const TILE_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_OPTS = { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' };
const isDark = () => document.documentElement.classList.contains('wa-dark');

let META, PROV, CONCERN, CITY, MLY = null;   // MLY: optional data/mapillary.json (image ids only)
let byId = new Map(), pinned = new Map();
const shardCache = new Map();
let map, tile, markers = new Map();
let colourBy = new Set();        // checked signal keys
let showConcern = true;          // outline concern-list stops
let streetsFirst = false;        // OSM streets basemap + faded dots
let osm = null;                  // the OSM tile layer (added only while streetsFirst)
let selectedId = null, halo = null, haloLabel = null;   // the chosen stop's highlight ring + name
let sigScale = {};               // per-signal 95th-percentile of 12-month counts (normaliser)

async function loadJSON(p) { const r = await fetch(p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); }
async function series(id) {
  const sh = id.padStart(4, '0').slice(0, 2);
  if (!shardCache.has(sh)) shardCache.set(sh, loadJSON(`./data/series/${sh}.json`));
  return (await shardCache.get(sh))[id];
}

// ── boot ──
(async function main() {
  [META, PROV, CONCERN, CITY] = await Promise.all([
    loadJSON('./data/stops.json'), loadJSON('./data/provenance.json'),
    loadJSON('./data/concern.json'), loadJSON('./data/citywide.json'),
  ]);
  META.stops.forEach(s => byId.set(s.id, s));
  // Optional image index; an empty placeholder ships so the request never 404s — treat empty as 'not built yet'.
  loadJSON('./data/mapillary.json').then(m => { MLY = Object.keys(m?.stops || {}).length ? m : null; }).catch(() => { MLY = null; });
  CONCERN.rows.filter(r => r.matched).forEach(r => pinned.set(r.id, r));
  $('#data-asof').textContent = `Data through ${pretty(META.latest_complete_month)} (complete) · built ${META.generated} · ` +
    `shelter flag as of ${PROV.stops_dataset.shelter_as_of || 'n/a'} · routes (GTFS) as of ${META.gtfs_as_of || 'n/a'} · ${META.stops.length.toLocaleString()} stops`;

  buildColourPicker();
  buildMap();
  wireSearch();
  renderConcern();
  buildCitywidePicker();
  renderCitywide();
  renderMethodology();

  const id = new URLSearchParams(location.search).get('stop');
  if (id && byId.has(String(+id).replace(/^1(\d{4})$/, '$1'))) showStop(String(+id).replace(/^1(\d{4})$/, '$1'), { pan: true });
  else if (id && byId.has(id)) showStop(id, { pan: true });
  window.addEventListener('popstate', () => {
    const q = new URLSearchParams(location.search).get('stop');
    if (q && byId.has(q)) showStop(q, { pan: true, push: false });
  });
})().catch(e => { console.error(e); $('#data-asof').textContent = 'Failed to load data: ' + e.message; });

// ── map ──
function buildColourPicker() {
  const box = $('#colour-by');
  for (const k of META.signals) {
    const vals = META.stops.map(s => s.t12[k] ?? 0).filter(v => v > 0).sort((a, b) => a - b);
    sigScale[k] = Math.max(3, vals[Math.floor(vals.length * 0.95)] || 1);
    colourBy.add(k);
  }
  box.insertAdjacentHTML('beforeend', META.signals.map(k =>
    `<label><input type="checkbox" value="${k}" checked /><span class="sw" style="background:${SIG_COLOR[k]}"></span>${esc(PROV.signals[k].short)}</label>`).join(''));
  box.addEventListener('change', e => {
    if (e.target.checked) colourBy.add(e.target.value); else colourBy.delete(e.target.value);
    restyleMarkers();
  });
  $('#show-concern').addEventListener('change', e => { showConcern = e.target.checked; restyleMarkers(); });
  $('#streets-first').addEventListener('change', e => {
    streetsFirst = e.target.checked;
    if (streetsFirst) { tile.remove(); osm.addTo(map); } else { osm.remove(); tile.addTo(map); }
    restyleMarkers();
  });
  window.addEventListener('themechange', () => { restyleMarkers(); drawHalo(); });
}
function buildMap() {
  // Canvas renderer with an 8 px click tolerance: a click just beside a small dot still opens it.
  const renderer = L.canvas({ tolerance: 8 });
  map = L.map('map', { preferCanvas: true, renderer });
  tile = L.tileLayer(isDark() ? TILE_DARK : TILE_LIGHT, TILE_OPTS).addTo(map);
  osm = L.tileLayer(TILE_OSM, { maxZoom: 19, className: 'osm-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
  window.addEventListener('themechange', () => { tile.setUrl(isDark() ? TILE_DARK : TILE_LIGHT); });
  // Open on the concern-list area at a zoom where street lines are readable; fall back to the city.
  const pinnedStops = META.stops.filter(s => pinned.has(s.id));
  if (pinnedStops.length) map.fitBounds(L.latLngBounds(pinnedStops.map(s => [s.lat, s.lng])).pad(0.25), { maxZoom: 15 });
  else map.setView([37.78, -122.42], 12.5);
  for (const s of META.stops) {
    const m = L.circleMarker([s.lat, s.lng], markerStyle(s)).addTo(map);
    m.bindTooltip(`${esc(s.name)} · #${s.code}`, { direction: 'top', offset: [0, -4] });
    m.on('click', () => showStop(s.id, { pan: false }));
    markers.set(s.id, m);
  }
  map.createPane('selected').style.zIndex = 460;    // above dots, below popups
  map.on('zoomend', () => { restyleMarkers(); drawHalo(); });
  window.__stopsMap = map;   // QA hook (screenshots, console)
}
// Dot = the checked signal that dominates at this stop (each signal's 12-month count normalised by its
// own citywide p95, so a "hot" shelter-maintenance stop can compete with a "hot" encampment stop);
// lightness and radius follow the summed normalised intensity. Unchecking a signal visibly removes its
// colour from the map, which is the "see the change" the picker is for.
function dotPaint(s) {
  let best = null, bestT = 0, total = 0;
  for (const k of colourBy) {
    const t = Math.min(1.5, (s.t12[k] ?? 0) / sigScale[k]);
    total += t;
    if (t > bestT) { bestT = t; best = k; }
  }
  if (!colourBy.size) return { fill: s.shelter ? '#3b82f6' : '#94a3b8', boost: 0, quiet: false };
  if (!best) return { fill: isDark() ? '#334155' : '#cbd5e1', boost: 0, quiet: true };
  const i = Math.min(1, total / 1.5);
  return { fill: mix(SIG_COLOR[best], isDark() ? '#0f172a' : '#ffffff', 0.15 + 0.55 * (1 - i)), boost: Math.round(3 * i), quiet: false };
}
function mix(hex, toHex, t) {          // blend hex → toHex by t (0 = hex)
  const a = hex.match(/\w\w/g).map(x => parseInt(x, 16)), b = toHex.match(/\w\w/g).map(x => parseInt(x, 16));
  return '#' + a.map((c, i) => Math.round(c + (b[i] - c) * t).toString(16).padStart(2, '0')).join('');
}
function markerStyle(s) {
  const z = map ? map.getZoom() : 12;
  const r = z >= 16 ? 7 : z >= 14 ? 5 : 3;
  const pin = showConcern && pinned.has(s.id);
  const p = dotPaint(s);
  // Concern-list ring: thick and ink-coloured (near-black / near-white by theme) so it never reads as a
  // signal colour — the drug signal is red, so a red ring was ambiguous.
  const fade = streetsFirst ? 0.45 : 1;     // "Streets first": smaller, translucent dots so street lines show through
  return { radius: Math.max(2, (r + p.boost) * (streetsFirst ? 0.75 : 1)) + (pin ? 2 : 0),
           color: pin ? (isDark() ? '#f8fafc' : '#0f172a') : (s.shelter ? '#1d4ed8' : '#64748b'),
           weight: pin ? 3 : 1, fillColor: p.fill, fillOpacity: (p.quiet ? .35 : (s.shelter ? .9 : .6)) * fade, opacity: (pin ? 1 : .9) * fade };
}
function restyleMarkers() { for (const s of META.stops) markers.get(s.id).setStyle(markerStyle(s)); }

// Selection halo: a big dashed ring + a pinned name label on the chosen stop, so it stays findable
// after a search or a click, at any zoom, whatever the dots are coloured.
function drawHalo() {
  if (halo) { halo.remove(); halo = null; }
  if (haloLabel) { haloLabel.remove(); haloLabel = null; }
  const s = selectedId && byId.get(selectedId);
  if (!s) return;
  const base = markerStyle(s).radius;
  halo = L.circleMarker([s.lat, s.lng], { pane: 'selected', radius: base + 10, color: '#2563eb', weight: 3,
    dashArray: '6 4', fill: true, fillColor: '#2563eb', fillOpacity: .08, interactive: false }).addTo(map);
  haloLabel = L.tooltip({ pane: 'selected', permanent: true, direction: 'top', offset: [0, -(base + 12)], className: 'halo-label' })
    .setLatLng([s.lat, s.lng]).setContent(`${esc(s.name)} · #${s.code}`).addTo(map);
}

// ── search ──
function tokens(str) { return String(str).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t && !['st', 'ave', 'blvd', 'and', 'the', 'way'].includes(t)); }
function wireSearch() {
  const inp = $('#stop-search'), list = $('#search-results');
  let sel = -1, hits = [];
  const render = () => {
    list.innerHTML = hits.map((s, i) => `<li role="option" data-id="${s.id}" aria-selected="${i === sel}">
      <span class="rid">${s.code}</span><span>${esc(s.name)}</span>
      <span class="rtag">${s.shelter ? 'shelter' : ''}${pinned.has(s.id) ? ' · on list' : ''}${s.routes.length ? ' · ' + esc(s.routes.join(' ')) : ''}</span></li>`).join('');
    list.hidden = !hits.length;
  };
  inp.addEventListener('input', () => {
    const q = inp.value.trim(); sel = -1;
    if (!q) { hits = []; render(); return; }
    if (/^\d{4,5}$/.test(q)) {
      const id = q.length === 5 && q[0] === '1' ? q.slice(1) : q;
      hits = META.stops.filter(s => s.id === id || s.code === q || s.id.startsWith(id)).slice(0, 12);
    } else {
      const qt = tokens(q);
      hits = META.stops.map(s => {
        const st = tokens(s.name + ' ' + (s.on || '') + ' ' + (s.at || ''));
        const score = qt.reduce((a, t) => a + (st.some(x => x.startsWith(t)) ? 1 : 0), 0);
        return score === qt.length ? [score + (pinned.has(s.id) ? .5 : 0) + (s.shelter ? .1 : 0), s] : null;
      }).filter(Boolean).sort((a, b) => b[0] - a[0]).slice(0, 12).map(x => x[1]);
    }
    render();
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && hits.length) { pick(hits[Math.max(0, sel)].id); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('click', e => { const li = e.target.closest('li'); if (li) pick(li.dataset.id); });
  document.addEventListener('click', e => { if (!e.target.closest('.finder')) list.hidden = true; });
  function pick(id) { list.hidden = true; inp.value = ''; showStop(id, { pan: true }); }
}

// ── stop card ──
async function showStop(id, { pan = true, push = true } = {}) {
  const s = byId.get(id); if (!s) return;
  if (push) history.pushState(null, '', `?stop=${id}`); else history.replaceState(null, '', `?stop=${id}`);
  if (pan) map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16));
  selectedId = id; drawHalo();
  const card = $('#stop-card'); card.hidden = false;
  card.innerHTML = `<div class="stop-card__head"><h2>${esc(s.name)}</h2><span class="stop-card__ids">stop ${s.code} · id ${s.id}</span></div><p class="field-hint">Loading…</p>`;
  const [ser, ...nbSer] = await Promise.all([series(id), ...s.neighbours.map(series)]);
  const c = pinned.get(id);
  const n = META.months.length, partialIdx = n - 1;
  const t12lo = META.months.indexOf(META.t12_window[0]), t12hi = META.months.indexOf(META.t12_window[1]);
  const sum = (arr, lo, hi) => arr == null ? null : arr.slice(lo, hi + 1).reduce((a, b) => a + b, 0);
  // Returns the mean series and records the count it averaged over — that count varies (144 stops have
  // fewer than 3 neighbours within 400 m, and 911 signals drop mid-block neighbours), so the label must
  // state it rather than always claiming 3 (stops-review.md F4).
  const nbCount = {};
  const nbMean = key => {
    const arrs = nbSer.map(x => x?.[key]?.stop).filter(Boolean);
    nbCount[key] = arrs.length;
    if (!arrs.length) return null;
    return META.months.map((_, i) => arrs.reduce((a, x) => a + x[i], 0) / arrs.length);
  };
  const boardings = c?.boardings;
  const alts = s.alts.map(a => `<li><span class="route">${esc(a.route)}</span><span>${a.m} m → ${esc(a.name)}</span>${pinned.has(a.stop) ? '<span class="flag">also on the concern list</span>' : ''}</li>`).join('');
  const sv = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lng}`;
  const gm = `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;

  const sigCards = META.signals.map(key => {
    const p = PROV.signals[key];
    const stop = ser[key].stop, ring = ser[key].ring, nb = nbMean(key);
    const na = stop == null;
    const t12 = sum(stop, t12lo, t12hi), all = sum(stop, 0, partialIdx - 1);
    const nb12 = nb ? sum(nb, t12lo, t12hi) : null;
    const ring12 = sum(ring, t12lo, t12hi);
    const months = stop ? stop.filter(Boolean).length : 0;
    const fill = tpl => tpl
      .replace('{lat}', s.lat).replace('{lng}', s.lng)
      .replace('{intersection}', (s.intersection || '').replace(/'/g, "''"))
      .replace('{from}', META.t12_window[0] + '-01').replace('{to}', t12End())
      .replace(/\$query=(.*)$/, (_, soql) => '$query=' + encodeURIComponent(soql));
    const qTotal = p.stop_total_template ? fill(p.stop_total_template) : null;
    const q = p.stop_query_template
      .replace('{lat}', s.lat).replace('{lng}', s.lng)
      .replace('{intersection}', (s.intersection || '').replace(/'/g, "''"))
      .replace(/\$query=(.*)$/, (_, soql) => '$query=' + encodeURIComponent(soql));
    const geoNote = p.dataset_id === '2zdj-bwza'
      ? (s.intersection ? `At intersection <b>${esc(s.intersection)}</b> (${s.intersection_m} m) — shared by every stop there.`
                        : `No calls of this type at any intersection near this stop (within ${META.geometry.intersection_snap_m} m) since ${META.months[0].slice(0, 4)}.`)
      : `Within ${META.geometry.stop_radius_m} m of the stop.`;
    return `<div class="sig">
      <p class="sig__t"><span class="sig__sw" style="background:${SIG_COLOR[key]}"></span>${esc(p.label)}</p>
      ${na ? `<p class="sig__na">Not attributable</p>` : `
      <div class="sig__nums"><span>${qTotal
          ? `<a class="sig__n" href="${qTotal}" target="_blank" rel="noopener" title="Runs on DataSF and returns this number">${fmt(t12)}</a>`
          : `<span class="sig__n">${fmt(t12)}</span>`} <span class="sig__s">last 12 mo</span></span>
        <span><span class="sig__n">${fmt(all)}</span> <span class="sig__s">since ${META.months[0].slice(0, 4)}</span></span>
        <span class="sig__s">${months} of ${n} months active</span></div>
      ${sparkline(stop, nb, ring, key)}
      <dl class="sig__leg">
        <div class="sig__leg-row"><dt><i class="sig__leg-bar" style="background:${SIG_COLOR[key]}"></i>this stop (bars)</dt><dd><b>${fmt(t12)}</b> <span class="sig__leg-u">12-mo total</span></dd></div>
        <div class="sig__leg-row"><dt><i class="sig__leg-line"></i>${nbCount[key] ? `neighbors, mean (nearest ${nbCount[key]} stops with no shelter)` : 'no stop without a shelter within 400 m'}</dt><dd>${nbCount[key] ? `<b>${fmt(nb12 == null ? null : Math.round(nb12))}</b> <span class="sig__leg-u">12-mo total</span>` : '—'}</dd></div>
        <div class="sig__leg-row"><dt><i class="sig__leg-ring"></i>surrounding block (25–250 m)</dt><dd><b>${fmt(ring12)}</b> <span class="sig__leg-u">12-mo total</span></dd></div>
      </dl>`}
      <p class="sig__cmp">${geoNote}</p>
      <p class="sig__q">${qTotal ? 'The 12-month figure links to a DataSF query that returns exactly that number. ' : ''}<a href="${q}" target="_blank" rel="noopener">Monthly series on DataSF ↗</a></p>
    </div>`;
  }).join('');

  const dataThin = c && META.signals.every(k => (s.t12[k] ?? 0) < 6);
  const img = MLY?.stops?.[id];
  const photo = img ? `<div class="photo">
      <iframe class="photo__frame" src="https://www.mapillary.com/embed?image_key=${encodeURIComponent(img.id)}&style=photo" loading="lazy" allow="xr-spatial-tracking; fullscreen" allowfullscreen title="Street-level photo near this stop (Mapillary)"></iframe>
      <p class="photo__cap">Street-level photo ${img.m} m from the stop${img.captured ? `, captured ${img.captured}` : ''}${img.pano ? ' (panorama)' : ''}${img.captured && (new Date().getFullYear() - +img.captured.slice(0, 4)) >= 5 ? ' · <b>old imagery — the corner may look different now</b>' : ''} ·
        <a href="https://www.mapillary.com/app/?pKey=${encodeURIComponent(img.id)}" target="_blank" rel="noopener">open on Mapillary ↗</a> · imagery © Mapillary contributors, CC BY-SA</p>
    </div>` : (MLY ? `<p class="field-hint">No Mapillary street-level image within ${MLY.radius_m} m of this stop.</p>` : '');
  card.innerHTML = `
    <div class="stop-card__head">
      <h2>${esc(s.name)}</h2>
      <span class="stop-card__ids">stop ${s.code} · id ${s.id}${s.supe ? ` · D${s.supe}` : ''}</span>
      <span class="pill ${s.shelter ? 'pill--yes' : ''}">${s.shelter ? 'Shelter' : 'No shelter'} <small>as of ${s.shelter_as_of || '?'}</small></span>
      ${c ? `<span class="pill pill--pin">On the concern list${c.removal_requested ? ' · removal requested' : ''}</span>` : ''}
    </div>
    <div class="facts">
      <div class="fact"><div class="fact__k">Routes</div><div class="fact__v">${s.routes.length ? esc(s.routes.join(' · ')) : '—'}</div>${s.in_gtfs ? '' : '<div class="fact__s">not in current GTFS</div>'}</div>
      <div class="fact ${boardings ? '' : 'fact--na'}"><div class="fact__k">Boardings / day</div><div class="fact__v">${boardings ? esc(boardings) : 'not available'}</div><div class="fact__s">${boardings ? 'Average daily, from the leadership list — no published source to link yet' : 'only available for concern-list stops'}</div></div>
      <div class="fact"><div class="fact__k">Accessible</div><div class="fact__v">${s.accessible ? 'Yes' : 'No'}</div><div class="fact__s">DataSF accessibility flag</div></div>
      <div class="fact"><div class="fact__k">Nearest alternative stop, by route</div>${alts ? `<ul class="alts">${alts}</ul>` : '<div class="fact__v fact--na">—</div>'}<div class="fact__s">straight-line; the walk is a little longer</div></div>
      ${CONCERN.detail ? `<div class="fact fact--na"><div class="fact__k">Contractor missed-servicing</div><div class="fact__v">${c?.missed_servicing_rank ? `rank ${esc(c.missed_servicing_rank)} (Jan–Jun)` : 'not available'}</div><div class="fact__s">per-stop monthly log requested from SFMTA</div></div>` : ''}
    </div>
    ${c && CONCERN.detail ? `<div class="basis ${dataThin ? 'basis--data-thin' : ''}">
      <p class="basis__t">Why it's on the list <span class="pill">${esc(c.basis_types.join(' · '))}</span></p>
      <p>${esc(c.basis || c.issue || '—')}</p>
      <p class="field-hint">List location: “${esc(c.list_location)}” · issue: ${esc(c.issue || '—')}${c.needs_verification ? ' · <b>needs verification</b>' : ''}${c.alts_on_list.length ? ` · nearest alternative(s) also listed: ${c.alts_on_list.map(a => `<a href="?stop=${a}" data-stop="${a}">${esc(byId.get(a)?.name || a)}</a>`).join(', ')}` : ''}</p>
      ${dataThin ? '<p><b>The public data shows little here</b> (under 6 reports on every signal in the last 12 months). The concern is stakeholder-reported; the card can\'t confirm or refute it.</p>' : ''}
    </div>` : ''}
    ${photo}
    ${c && !CONCERN.detail && c.alts_on_list.length ? `<p class="field-hint">Nearest alternative stop(s) also on the concern list: ${c.alts_on_list.map(a => `<a href="?stop=${a}" data-stop="${a}">${esc(byId.get(a)?.name || a)}</a>`).join(', ')}.</p>` : ''}
    <div class="signals">${sigCards}</div>
    <p class="signals__note">Faint final bar in each chart = current partial month.</p>
    <div class="links">
      <a href="${sv}" target="_blank" rel="noopener">Street View at this stop ↗</a>
      <a href="${gm}" target="_blank" rel="noopener">Google Maps ↗</a>
      <a href="${PROV.stops_dataset.url}" target="_blank" rel="noopener">Muni Stops dataset ↗</a>
      <a href="${PROV.gtfs.url}" target="_blank" rel="noopener">Routes &amp; next stop: SFMTA GTFS${META.gtfs_as_of ? ` (as of ${META.gtfs_as_of})` : ''} ↗</a>
      <a href="?stop=${id}" data-copy>Link to this card</a>
    </div>`;
  card.querySelectorAll('a[data-stop]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showStop(a.dataset.stop, { pan: true }); }));
  card.querySelector('a[data-copy]').addEventListener('click', e => { e.preventDefault(); navigator.clipboard?.writeText(location.origin + location.pathname + `?stop=${id}`); e.target.textContent = 'Link copied'; });
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function sparkline(stop, nb, ring, key) {
  // Two stacked frames, not one. The stop's bars and the neighbour mean share a scale and can be
  // compared by height. The ring (25–250 m) counts a much larger area, so it gets its own strip with
  // its own baseline and its own maximum — separated rather than overlaid, because a second scale
  // inside the same frame invites a height comparison that isn't valid (stops-review.md F6).
  const W = 320, H = 106, pad = { t: 6, l: 4, r: 4 };
  const AXIS_H = 14, RING_H = 20, GAP = 8;
  const n = stop.length, iw = W - pad.l - pad.r, bw = iw / n;
  const ih = H - pad.t - AXIS_H - RING_H - GAP;
  const max = Math.max(1, ...stop, ...(nb || []));
  const y = v => pad.t + ih - (v / max) * ih;
  let bars = '';
  stop.forEach((v, i) => {
    const h = (v / max) * ih;
    bars += `<rect x="${(pad.l + i * bw).toFixed(1)}" y="${y(v).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${SIG_COLOR[key]}" opacity="${i === n - 1 ? .35 : .85}"><title>${pretty(META.months[i])}: ${v}</title></rect>`;
  });
  const line = (arr, mx, top, hgt) => arr.map((v, i) => `${i ? 'L' : 'M'}${(pad.l + i * bw + bw / 2).toFixed(1)} ${(top + hgt - (v / mx) * hgt).toFixed(1)}`).join(' ');
  const nbPath = nb ? `<path d="${line(nb, max, pad.t, ih)}" fill="none" stroke="#0ea5e9" stroke-width="1.6"/>` : '';
  const ringTop = pad.t + ih + GAP, ringMax = Math.max(1, ...ring);
  const ringPath = `<path d="${line(ring, ringMax, ringTop, RING_H)}" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 2" opacity=".9"/>`;
  const ringBase = `<line x1="${pad.l}" y1="${ringTop + RING_H}" x2="${W - pad.r}" y2="${ringTop + RING_H}" stroke="#cbd5e1" stroke-width="1"/>`;
  const ringTag = `<text x="${pad.l}" y="${ringTop - 1}" font-size="8" fill="#94a3b8">surrounding 25–250 m · own scale, peak ${ringMax}</text>`;
  const years = META.months.map((m, i) => m.endsWith('-01') ? `<text x="${(pad.l + i * bw).toFixed(1)}" y="${H - 3}" font-size="9" fill="#94a3b8">${m.slice(0, 4)}</text>` : '').join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="monthly series for this stop and its neighbors, with the surrounding ring on a separate scale below">${bars}${nbPath}${ringTag}${ringBase}${ringPath}${years}</svg>`;
}

// ── concern table ──
function renderConcern() {
  const rows = CONCERN.rows;
  const unmatched = rows.filter(r => !r.matched);
  $('#concern-meta').textContent = `${rows.length} rows on the list (${CONCERN.list_date || 'date unknown'}) · ${rows.length - unmatched.length} are Muni stops` +
    (unmatched.length ? ` · ${unmatched.length} not stops: ${unmatched.map(r => r.list_location).join('; ')}` : '') +
    (CONCERN.detail ? ` · ${rows.filter(r => r.removal_requested).length} removal requests` : ' · public view: stop identities only');
  const detail = !!CONCERN.detail;
  // Public builds: the section is hidden entirely — every column it would show is already on each stop's
  // card, and the list shouldn't be the page's emphasis. Full-detail builds (--full) keep the table.
  $('#concern-block').hidden = !detail;
  if (!detail) return;
  const cols = [
    ['Stop', r => `<a href="?stop=${r.id}" data-stop="${r.id}">${esc(r.name)}</a> <span class="tag">${r.code}</span>`, r => r.name],
    ['Shelter', r => r.shelter ? 'Y' : '—', r => +r.shelter],
    ...(detail ? [
      ['Removal ask', r => r.removal_requested ? '<b>Yes</b>' : '—', r => +r.removal_requested],
      ['Basis', r => `<span class="tag">${esc(r.basis_types.join(' · '))}</span>`, r => r.basis_types.join()],
      ['Boardings/day', r => esc(r.boardings || '—'), r => parseFloat(r.boardings) || 0, 'num'],
    ] : []),
    ['Routes', r => esc(byId.get(r.id).routes.join(' ')), r => byId.get(r.id).routes.length],
    ['Next stop (m)', r => { const a = byId.get(r.id).alts[0]; return a ? a.m : '—'; }, r => byId.get(r.id).alts[0]?.m ?? 9e9, 'num'],
    ...META.signals.map(k => [PROV.signals[k].short + ' 12mo', r => fmt(byId.get(r.id).t12[k]), r => byId.get(r.id).t12[k] ?? -1, 'num']),
  ];
  sortableTable($('#concern-table'), cols, rows.filter(r => r.matched), detail ? 2 : 4);
}
// Citywide concentration: the curve + top-stops table recompute in-browser for any subset of the
// four signals. CITY.stops carries per-signal [t12, all, active] index-aligned to CITY.signals for
// every active sheltered stop, so no series-shard load is needed. See plan-citywide-toggle.md.
let citySignals = new Set();     // checked signal keys for the citywide section (default: encampment)
function buildCitywidePicker() {
  citySignals = new Set(['encampment']);
  const box = $('#citywide-signals');
  box.insertAdjacentHTML('beforeend', CITY.signals.map(k =>
    `<label><input type="checkbox" value="${k}" ${k === 'encampment' ? 'checked' : ''} /><span class="sw" style="background:${SIG_COLOR[k]}"></span>${esc(PROV.signals[k].short)}</label>`).join(''));
  box.addEventListener('change', e => {
    if (e.target.checked) citySignals.add(e.target.value); else citySignals.delete(e.target.value);
    renderCitywide();
  });
}
function renderCitywide() {
  const keys = CITY.signals.filter(k => citySignals.has(k));   // preserve canonical order
  const idx = keys.map(k => CITY.signals.indexOf(k));
  const sum = (arr) => idx.reduce((a, i) => a + (arr[i] || 0), 0);
  // Months active for the checked set = popcount of the OR of the per-signal month bitmasks, so it is
  // the exact union of active months, not a sum (double-counts) or max (undercounts). Masks span >32
  // bits, so OR/count in BigInt.
  const activeMonths = (v) => {
    let m = 0n;
    for (const i of idx) m |= BigInt(v.mask[i] || 0);
    let c = 0;
    while (m) { c += Number(m & 1n); m >>= 1n; }
    return c;
  };
  // Per-stop combined totals for the checked set.
  const rows = Object.entries(CITY.stops).map(([id, v]) => ({
    id, name: v.name, supe: v.supe, on_list: v.on_list,
    t12: sum(v.t12), all: sum(v.all), active: activeMonths(v),
  })).filter(r => r.all > 0);   // a stop with no activity in ANY checked signal drops out
  const total = rows.reduce((a, r) => a + r.t12, 0);

  // Concentration curve over the checked set.
  const ranked = rows.slice().sort((a, b) => b.t12 - a.t12);
  let run = 0;
  const curve = [];
  ranked.forEach((r, k) => {
    run += r.t12;
    if ([5, 10, 25, 50, 100, 200].includes(k + 1)) curve.push({ top: k + 1, share: total ? run / total : null });
  });

  // Meta line: name the checked signals, and warn when a 911 (intersection-resolved) signal is mixed in.
  const has911 = keys.some(k => PROV.signals[k].geo && PROV.signals[k].geo.startsWith('911'));
  const names = keys.map(k => PROV.signals[k].short);
  const onlyEnc = keys.length === 1 && keys[0] === 'encampment';
  const withZero = CITY.sheltered_stops - rows.length;
  $('#citywide-meta').textContent =
    (onlyEnc
      ? `Encampment signal only — 311 encampment & unhoused reports within 25 m of a sheltered stop`
      : keys.length
        ? `Counting ${names.join(' + ')} within reach of a sheltered stop`
        : `No signal selected — pick at least one above`) +
    `, ${pretty(CITY.window[0])}–${pretty(CITY.window[1])}. ` +
    (has911 ? `911 signals attach to a stop's whole intersection, so those counts are shared by every stop at the corner — coarser than the 311 point match. ` : ``) +
    `${CITY.sheltered_stops} sheltered stops; ${withZero} have had none of the selected signals since ${META.months[0].slice(0, 4)}. Stops on the concern list are tagged.`;

  $('#citywide-curve').innerHTML = keys.length
    ? curve.map(c => `<div>top <b>${c.top}</b> stops = <b>${Math.round(c.share * 100)}%</b> of selected reports</div>`).join('')
    : '';

  const cols = [
    ['#', (r, i) => i + 1, (r, i) => i],
    ['Stop', r => `<a href="?stop=${r.id}" data-stop="${r.id}">${esc(r.name)}</a>${r.on_list ? ' <span class="tag" style="color:#dc2626">on list</span>' : ''}`, r => r.name],
    ['District', r => r.supe ? 'D' + r.supe : '—', r => +r.supe || 0],
    ['12 mo', r => fmt(r.t12), r => r.t12, 'num'],
    ['Since 2023', r => fmt(r.all), r => r.all, 'num'],
    ['Months active', r => r.active, r => r.active, 'num'],
  ];
  sortableTable($('#citywide-table'), cols, ranked.slice(0, 25), 3);
}
function sortableTable(tbl, cols, rows, defaultCol) {
  let sortCol = defaultCol, desc = true;
  const draw = () => {
    const sorted = rows.map((r, i) => [r, i]).sort((a, b) => {
      const va = cols[sortCol][2](a[0], a[1]), vb = cols[sortCol][2](b[0], b[1]);
      return (va < vb ? -1 : va > vb ? 1 : 0) * (desc ? -1 : 1);
    });
    tbl.innerHTML = `<thead><tr>${cols.map((c, i) => `<th class="${c[3] || ''}" data-i="${i}" ${i === sortCol ? 'data-sorted' : ''}>${c[0]}</th>`).join('')}</tr></thead>` +
      `<tbody>${sorted.map(([r, i]) => `<tr>${cols.map(c => `<td class="${c[3] || ''}">${c[1](r, i)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    tbl.querySelectorAll('th').forEach(th => th.addEventListener('click', () => { const i = +th.dataset.i; desc = i === sortCol ? !desc : true; sortCol = i; draw(); }));
    tbl.querySelectorAll('a[data-stop]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showStop(a.dataset.stop, { pan: true }); }));
  };
  draw();
}
function renderMethodology() {
  const g = META.geometry;
  $('#methodology-body').innerHTML = `
    <p>Every number ties to a runnable DataSF query (the link on each signal). Filters are copied verbatim from the
    <a href="../unhoused/">unhoused</a> and <a href="../drug/">drug</a> dashboards, so a count here equals the same
    count there for the same place and month.</p>
    ${META.signals.map(k => `<h3>${esc(PROV.signals[k].label)}</h3><p>${esc(PROV.signals[k].caveat)} <span class="tag">${esc(PROV.signals[k].dataset_name)} · ${PROV.signals[k].dataset_id}</span></p>`).join('')}
    <p>311 records are occasionally re-geocoded after the fact, so counts for past months can shift slightly between weekly refreshes.</p>
    <h3>Geometry</h3>
    <p>311 cases attach to the nearest stop within ${g.stop_radius_m} m. 911 calls are geocoded to the intersection, so each stop is
    assigned to its parent intersection (nearest within ${g.intersection_snap_m} m) and the calls are shared by every stop there;
    mid-block stops get “not attributable”, never zero. The surrounding ring is ${g.stop_radius_m}–${g.ring_m} m. Neighbors are the
    three nearest stops with no shelter within ${g.neighbour_m} m — the baseline for “is it the shelter or the corner?”.</p>
    <h3>Citywide concentration</h3>
    <p>The concentration section counts whichever signals you check, over every sheltered stop. “Top N stops = X%” is the share of
    all selected reports that fall at the N most-active sheltered stops, so it rises with concentration. When a 911 signal is
    included the figures mix two attribution models — 311 points snap to the nearest stop, 911 calls are shared across a whole
    intersection — so a combined count is coarser than either signal alone; the per-stop cards keep them separate.</p>
    <h3>Cost side</h3>
    <p>Routes and the nearest alternative stop come from the SFMTA GTFS feed (straight-line meters). Boardings are the leadership
    list's own average-daily figures and exist only for stops on that list — there is no published dataset to link them to yet,
    so they can't be checked here; citywide stop-level ridership is not available. The shelter flag is a DataSF snapshot
    (as of ${PROV.stops_dataset.shelter_as_of || '?'}) with no history — changes to stops are only recorded once they're logged here.</p>`;
}
