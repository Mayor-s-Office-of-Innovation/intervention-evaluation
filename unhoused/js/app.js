// ──────────────────────────────────────────────────────────────────────
// Orchestration — per-district pages (hash router) over the pre-baked JSON.
// Consolidated layout (plan D15): two compact SUCCESS cards (Encampments,
// 911 unhoused calls — want DOWN), one focused chart with a selector
// (Aggregate=sum · Encampment · 911), a detail strip under it, and HSOC as a
// RESPONSE signal below (the theft-arrests analog — not a success target, D8).
// Plus the fixed-Lurie transition map (D11/D12) and the methodology footnote (D7).
// ──────────────────────────────────────────────────────────────────────
import { loadAggregates, loadProvenance, loadTransitionMeta, loadTransitions, loadMarkers } from './data.js';
import { renderChart } from './chart.js';
import {
  monthIndex, prettyMonth, yoy, trailing12, trend12, trailing12Line, priorYearLine, fmtPct,
} from './rollup.js';
import {
  CATEGORY, focusDistrict, renderCells, setSparkMeta, setMarkers,
  onMapState, notifyState, queueRestore, restoreMapView,
} from './transition-map.js';

const DISTRICTS = ['Northern', 'Mission', 'Tenderloin', 'Central'];
const $ = sel => document.querySelector(sel);

// ── deep-linkable map state (query string; the district stays in the hash) ──
// Written with replaceState so panning/zooming/opening cell popups never piles up Back-button history,
// but the URL is always shareable. Only populated while a block/intersection cell is pinned (emitState).
let pendingRestore = null;   // a parsed {center,zoom,sig,cell} to apply on first map render
function parseMapParams() {
  const p = new URLSearchParams(location.search);
  if (!p.has('z') || !p.has('ll')) return null;
  const [lat, lng] = (p.get('ll') || '').split(',').map(Number);
  const zoom = parseInt(p.get('z'), 10);
  if (![lat, lng, zoom].every(Number.isFinite)) return null;
  return { center: { lat, lng }, zoom, sig: p.get('sig'), cell: p.get('cl') };
}
function writeMapUrl(state) {
  if (!state) {   // nothing pinned → drop the map params, keep the district hash
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    return;
  }
  const p = new URLSearchParams();
  p.set('z', String(state.zoom));
  p.set('ll', `${state.center.lat.toFixed(5)},${state.center.lng.toFixed(5)}`);
  p.set('sig', mapSignal);
  if (state.cell) p.set('cl', state.cell);
  history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
}

let AGG, PROV, TMETA, GEO;
let active = 'Northern';
let focus = 'aggregate';          // 'aggregate' | 'encampment' | 'cfs_presence'
let encOnly = false;              // dedicated-category sub-view (only when focus === 'encampment')
let mapSignal = 'encampment';
const visibleCats = new Set(['persistent', 'cooled', 'emerged']);
const transitionData = {};

// ── series helpers ──
const lastIdx = () => monthIndex(AGG, AGG.latest_complete_month);
const seriesFor = (sigKey, dist) => AGG.signals[sigKey].series[dist];
const groupSeries = (gKey, dist) => AGG.groups[gKey].series[dist];
// Aggregate = summed total: encampment union (311) + 911 group. Distinct channels, no overlap (D15).
const aggSeries = dist => seriesFor('encampment', dist).map((v, i) => v + groupSeries('cfs_presence', dist)[i]);
const allTimeAvg = s => s.reduce((a, b) => a + b, 0) / s.length;

// verdict: lower is better for presence signals
function verdict(series, idx) {
  const t = trend12(series, idx);
  if (!t || t.pct == null) return { label: 'Not enough history', cls: 'verdict-flat', pct: null };
  if (t.pct > 0.05) return { label: 'Worsening', cls: 'verdict-bad', pct: t.pct };
  if (t.pct < -0.05) return { label: 'Improving', cls: 'verdict-good', pct: t.pct };
  return { label: 'Little change', cls: 'verdict-flat', pct: t.pct };
}
const dirClass = x => (x == null ? 'delta-flat' : x < -0.005 ? 'delta-good' : x > 0.005 ? 'delta-bad' : 'delta-flat');

// What the focused chart shows.
function focusInfo() {
  if (focus === 'aggregate') return {
    series: aggSeries, label: 'All unhoused-presence reports', breaks: [],
    note: 'Sum of encampment & homelessness reports (311) and 911 unhoused-presence calls (SFPD) — distinct reporting channels with no overlap. Encampment dominates the magnitude.',
  };
  if (focus === 'cfs_presence') return {
    series: d => groupSeries('cfs_presence', d), label: '911 unhoused calls', breaks: [],
    note: AGG.groups.cfs_presence.note,
  };
  const k = encOnly ? 'encampment_only' : 'encampment';
  return { series: d => seriesFor(k, d), label: AGG.signals[k].label, breaks: AGG.signals[k].breaks, note: AGG.signals[k].caveat };
}

// ── top: two compact success cards ──
function summaryCard(focusKey, label, series, accent) {
  const idx = lastIdx(), cur = series[idx], v = verdict(series, idx);
  return `<button class="scard ${focus === focusKey ? 'is-focused' : ''}" data-focus="${focusKey}" style="--accent:${accent}">
    <span class="scard__label">${label}</span>
    <span class="scard__num">${cur.toLocaleString()}<small>${prettyMonth(AGG.latest_complete_month)}</small></span>
    <span class="verdict ${v.cls}">${v.label}${v.pct != null ? ` · 12-mo ${fmtPct(v.pct)}` : ''}</span>
  </button>`;
}
function renderSummary() {
  $('#summary-cards').innerHTML =
    summaryCard('encampment', 'Encampments', seriesFor('encampment', active), 'var(--c-red)') +
    summaryCard('cfs_presence', '911 unhoused calls', groupSeries('cfs_presence', active), 'var(--c-orange)');
  $('#summary-cards').querySelectorAll('.scard').forEach(b =>
    b.onclick = () => setFocus(b.dataset.focus));
}

// ── detail strip under the chart (comparisons for the focused series) ──
function cmp(label, cur, ref, refLabel) {
  if (ref == null) return `<div class="cmp"><span class="cmp__h">${label}</span><span class="cmp__v">—</span></div>`;
  const pct = ref ? (cur - ref) / ref : null;
  return `<div class="cmp ${dirClass(pct)}"><span class="cmp__h">${label}</span>
    <span class="cmp__v">${fmtPct(pct)}</span><span class="cmp__r">${refLabel}</span></div>`;
}
function renderDetail(seriesFn) {
  const idx = lastIdx(), series = seriesFn(active), city = seriesFn('Citywide');
  const cur = series[idx], y = yoy(series, idx), typical = allTimeAvg(series.slice(0, idx + 1));
  const cityT = trend12(city, idx);
  const shareNow = city[idx] ? cur / city[idx] : null;
  let d = 0, c = 0;
  for (let i = 0; i <= idx; i++) { d += series[i]; c += city[i]; }
  const shareAvg = c ? d / c : null;
  $('#detail-strip').innerHTML = `
    <div class="cmps">
      ${cmp('vs last month', cur, series[idx - 1], prettyMonth(AGG.months[idx - 1]))}
      ${cmp('vs a year ago', cur, y && y.prior, y && y.prior != null ? prettyMonth(AGG.months[idx - 12]) : '')}
      ${cmp('vs a typical month', cur, typical, `avg ${typical.toFixed(0)}`)}
    </div>
    <div class="ctx-line"><span>In SF context:</span>
      citywide 12-mo ${cityT ? fmtPct(cityT.pct) : '—'} ·
      ${active} is ${shareNow != null ? (shareNow * 100).toFixed(0) + '%' : '—'} of citywide
      (typically ${shareAvg != null ? (shareAvg * 100).toFixed(0) + '%' : '—'})</div>`;
}

// ── the focused chart ──
function renderFocusChart() {
  const fi = focusInfo();
  const series = fi.series(active), city = fi.series('Citywide');
  const months = AGG.months, partialIdx = months.indexOf(AGG.current_partial_month);
  const maxD = Math.max(1, ...series), maxC = Math.max(1, ...city);
  renderChart($('#chart'), {
    months, values: series, partialIdx,
    overlays: {
      trend: trailing12Line(series),
      priorYear: priorYearLine(series),
      citywideScaled: city.map(v => v * (maxD / maxC)),
    },
    breaks: fi.breaks || [], noun: 'report',
  });
  $('#chart-note').textContent = fi.note || '';
  renderDetail(fi.series);
}

function buildChartSelector() {
  const opts = [['aggregate', 'Aggregate'], ['encampment', 'Encampment'], ['cfs_presence', '911 unhoused calls']];
  $('#chart-selector').innerHTML = opts.map(([k, lab]) =>
    `<button class="seg ${focus === k ? 'is-active' : ''}" data-f="${k}">${lab}</button>`).join('');
  $('#chart-selector').querySelectorAll('.seg').forEach(b => b.onclick = () => setFocus(b.dataset.f));
}

function setFocus(f) {
  focus = f;
  $('#enc-only-wrap').hidden = (f !== 'encampment');
  renderSummary();
  buildChartSelector();
  renderFocusChart();
}

// ── response signal (HSOC) — below the success metrics, like theft's arrests ──
function renderHSOC() {
  const idx = lastIdx(), hs = seriesFor('hsoc', active);
  const cur = hs[idx], t = trend12(hs, idx);
  const encT = trend12(seriesFor('encampment', active), idx);
  const hsUp = t && t.pct > 0.05, hsDown = t && t.pct < -0.05;
  const encUp = encT && encT.pct > 0.05, encDown = encT && encT.pct < -0.05;
  let read = 'Response effort to track alongside presence: it’s appropriate for HSOC to rise while encampments are high, but the goal is for both response and presence to fall together over time.';
  if (encUp && (hsUp || !hsDown)) read = 'Encampments are rising and outreach response is keeping pace — the city responding to higher presence. Success would be both falling together over time, not response alone.';
  else if (encDown && hsDown) read = 'Both presence and outreach response are easing — the direction real improvement looks like.';
  else if (encDown && hsUp) read = 'Presence is easing while response keeps climbing — watch whether response can taper as the problem improves.';
  else if (encUp && hsDown) read = 'Encampments are rising while outreach response falls — worth watching: response isn’t tracking presence.';
  $('#hsoc-block').innerHTML = `
    <div class="rb__head">
      <h2 class="section-title">HSOC outreach response</h2>
      <span class="rb__role">City response effort · not a success metric</span>
    </div>
    <div class="rb__body">
      <div class="rb__num">${cur.toLocaleString()}<small>HSOC-routed calls · ${prettyMonth(AGG.latest_complete_month)}</small></div>
      <span class="verdict verdict-context">12-mo ${t ? fmtPct(t.pct) : '—'}</span>
    </div>
    <p class="rb__note">${read}</p>`;
}

// ── render one district ──
function renderDistrict(name) {
  active = name;
  document.querySelectorAll('.district-nav a').forEach(a => a.classList.toggle('is-active', a.dataset.d === name));
  renderSummary();
  buildChartSelector();
  renderFocusChart();
  renderHSOC();
  renderMap();
}

// ── transition map ──
async function renderMap() {
  if (!transitionData[mapSignal]) transitionData[mapSignal] = await loadTransitions(mapSignal);
  if (pendingRestore) queueRestore(pendingRestore.cell);   // so renderCells re-opens the shared cell
  focusDistrict($('#map'), GEO, active);
  const counts = renderCells(transitionData[mapSignal], active, visibleCats);
  setMarkers(mapSignal, () => loadMarkers(mapSignal));   // lazy-loaded on first zoom-in
  $('#map-legend').innerHTML = Object.entries(CATEGORY).map(([k, m]) => `
    <button class="legend-item ${visibleCats.has(k) ? '' : 'is-off'}" data-cat="${k}"
            style="--cat:${m.color}" title="Click to show/hide on the map" aria-pressed="${visibleCats.has(k)}">
      <span class="legend-top">
        <span class="legend-dot"></span>
        <span class="legend-label">${m.label}</span>
      </span>
      <span class="legend-count">${counts[k] || 0}</span>
      <span class="legend-blurb">${m.blurb}</span>
    </button>`).join('');
  $('#map-legend').querySelectorAll('.legend-item').forEach(b =>
    b.onclick = () => { const c = b.dataset.cat; visibleCats.has(c) ? visibleCats.delete(c) : visibleCats.add(c); renderMap(); });
  const sigMeta = TMETA.signals[mapSignal];
  const tide = sigMeta.district_tide[active];
  const hot = sigMeta.hot_rate_per_month;
  $('#map-note').innerHTML =
    `Each dot is a ~block (≈110 m) that reaches at least <strong>${hot} ${mapSignal === 'encampment' ? 'reports' : 'calls'}/month</strong>, ` +
    `classified by how its “hot now” rate (last 3 complete months) compares to pre-Lurie (2023–24), ` +
    `<strong>normalized against ${active}’s overall change</strong> (×${tide} pre→now) so the June-2025 ` +
    `encampment reporting reroute and citywide growth don’t read as local change. ` +
    `Built on presence reports only (not HSOC). ` +
    (mapSignal === 'encampment'
      ? 'Encampment spans the June-2025 reroute — the reroute-free “911 calls” view corroborates the pattern. '
      : 'The 911 calls signal has no reporting reroute (a clean pre/post comparison), and uses a lower hotspot threshold because it is lower-volume. ') +
    '<strong>Click a block</strong> to pin its intersection + monthly trend and get a shareable link to that spot; <strong>zoom in</strong> to see individual reports (last 3 months vs older) with full details on hover.';

  // Deep-link restore (once): scroll to the map, then re-center/zoom (the queued cell opens as cells draw).
  if (pendingRestore) {
    const r = pendingRestore; pendingRestore = null;
    $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    restoreMapView(r.center, r.zoom);
  }
}

// ── map signal toggle (encampment / 911) ──
function buildMapControls() {
  $('#map-controls').innerHTML = `
    <button class="seg ${mapSignal === 'encampment' ? 'is-active' : ''}" data-s="encampment">Encampment</button>
    <button class="seg ${mapSignal === 'cfs_presence' ? 'is-active' : ''}" data-s="cfs_presence">911 unhoused calls</button>`;
  $('#map-controls').querySelectorAll('.seg').forEach(b =>
    b.onclick = async () => { mapSignal = b.dataset.s; buildMapControls(); await renderMap(); notifyState(); });
}

// ── nav ──
function buildNav() {
  $('#district-nav').innerHTML = DISTRICTS.map(d => `<a href="#${d.toLowerCase()}" data-d="${d}">${d}</a>`).join('');
}
function routeFromHash() {
  const h = (location.hash || '').replace('#', '').toLowerCase();
  renderDistrict(DISTRICTS.find(d => d.toLowerCase() === h) || 'Northern');
}

// ── methodology (D7) — what's in/out, why, and the runnable queries ──
function renderMethodology() {
  const s = PROV.signals, g = PROV.groups;
  const q = url => `<a href="${url}" target="_blank" rel="noopener">query ↗</a>`;
  const sigRow = (key, why) => {
    const p = s[key];
    let parts = '';
    if (p.components) {
      parts = '<ul class="meth-parts">' + Object.entries(p.components).map(([n, c]) =>
        `<li><code>${n}</code>: ${q(c.query_url)}</li>`).join('') + '</ul>';
    }
    return `<li><strong>${AGG.signals[key].label}</strong> — ${why}
      <br><small>${p.dataset_name} (<code>${p.dataset_id}</code>) · ${q(p.query_url)}${p.dedup_note ? ' · ' + p.dedup_note : ''}</small>${parts}</li>`;
  };
  const grp = g.cfs_presence;
  const grpRow = `<li><strong>${grp.label}</strong> — two distinct, non-overlapping SFPD call types, summed.
    <br><small>${grp.note}</small>
    <ul class="meth-parts">${Object.values(grp.members).map(m =>
      `<li>${m.label}: ${m.dataset_name} (<code>${m.dataset_id}</code>) · ${q(m.query_url)}</li>`).join('')}</ul></li>`;

  document.getElementById('methodology-body').innerHTML = `
    <p class="meth-lead">Every signal — and every component of a combined one — names its dataset and links a
      runnable Socrata query, so each number ties back to source data.</p>
    <h3>Success metrics — what we want to go down, and why each is homeless-related</h3>
    <ul class="meth-list">
      ${sigRow('encampment', 'the critical presence metric; unions the dedicated 311 Encampment category with the homelessness requests it was rerouted into in June 2025 so the trend stays continuous')}
      ${grpRow}
    </ul>
    <h3>Response signal — shown below, not a success target</h3>
    <ul class="meth-list">
      <li><strong>${AGG.signals.hsoc.label}</strong> — the city’s outreach <em>effort</em>, the analog of arrests in a crime dashboard: appropriate to rise while presence is high, but ultimately should fall as the problem improves. It overlaps the 911 calls and is never summed with them.
        <br><small>${s.hsoc.dataset_name} (<code>${s.hsoc.dataset_id}</code>) · ${q(s.hsoc.query_url)}</small></li>
    </ul>
    <h3>Left out — and why (deferred to sibling projects)</h3>
    <ul class="meth-list meth-list--out">
      <li><strong>Needles / syringes</strong> — a drug-use signal that co-locates with homelessness but isn’t a measure of it. Covered in a dedicated drug-use project.</li>
      <li><strong>Human / animal waste</strong> — excluded after analysis: 311 records this as one “human <em>or</em> animal waste” category that can’t separate dog waste from human waste; it clusters near encampments (~49% of waste reports sit on heavy-encampment blocks vs ~15% for ordinary overflowing-trash-can reports) <em>but</em> doesn’t rise and fall with encampments month to month in the highest-homeless neighborhoods — so we can’t confidently call it an unhoused measure. Covered in a dedicated street-cleanliness project.</li>
    </ul>
    <p class="meth-foot">Data current to ${PROV.generated}. History from ${PROV.history_start}. Seasonality-aware,
      observational (not causal). Recent complete months are reliable — these datasets are creation-stamped,
      so unlike police incident reports there is no approval-lag backfill (only the in-progress month is partial).</p>`;
}

// ── boot ──
async function main() {
  try {
    [AGG, PROV, TMETA] = await Promise.all([loadAggregates(), loadProvenance(), loadTransitionMeta()]);
    GEO = await fetch('./data/police_districts.geojson').then(r => r.json());
    $('#data-asof').textContent =
      `Data current to ${AGG.generated} · evaluating ${prettyMonth(AGG.latest_complete_month)} (latest complete month)`;
    setSparkMeta(TMETA.months, TMETA.lurie_month);
    // Adopt any deep-linked map state before the first render (signal must be set before the map builds).
    pendingRestore = parseMapParams();
    if (pendingRestore && (pendingRestore.sig === 'encampment' || pendingRestore.sig === 'cfs_presence')) {
      mapSignal = pendingRestore.sig;
    }
    onMapState(writeMapUrl);
    buildNav();
    buildMapControls();
    renderMethodology();
    $('#enc-only-toggle').addEventListener('change', (e) => { encOnly = e.target.checked; renderFocusChart(); });
    // Manual district navigation abandons any restore + clears stale map params (the new district is zoomed out).
    window.addEventListener('hashchange', () => { pendingRestore = null; writeMapUrl(null); routeFromHash(); });
    routeFromHash();
  } catch (e) {
    const s = $('#status'); s.hidden = false; s.textContent = 'Failed to load data: ' + e.message;
    console.error(e);
  }
}
main();
