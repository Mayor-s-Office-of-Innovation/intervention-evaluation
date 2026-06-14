// ──────────────────────────────────────────────────────────────────────
// Drug-activity dashboard — per-district pages (hash router) over pre-baked JSON.
// TWO co-headline cards with OPPOSITE goals (plan D9):
//   • Drug-activity reports (cfs_drug)  — community 911, want DOWN
//   • Dealer arrests (dealer_arrests)   — supply disruption, want UP
// A focused chart (reports · dealer arrests · needles), the "what drug arrests
// are made of" composition (dealer vs paraphernalia vs other), and the fixed-Lurie
// displacement map built on presence only (D2). Methodology footnotes per D5/D7/D9.
// ──────────────────────────────────────────────────────────────────────
import { loadAggregates, loadProvenance, loadTransitionMeta, loadTransitions, loadMarkers } from './data.js';
import { renderChart, renderStacked } from './chart.js';
import {
  monthIndex, prettyMonth, yoy, trailing12, trend12, trailing12Line, priorYearLine, fmtPct,
} from './rollup.js';
import {
  CATEGORY, focusDistrict, renderCells, setSparkMeta, setMarkers,
  onMapState, notifyState, queueRestore, restoreMapView,
} from './transition-map.js';

const DISTRICTS = ['Northern', 'Mission', 'Central', 'Tenderloin'];
const $ = sel => document.querySelector(sel);
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// composition layer colors (dealer = good/green, the rest = churn)
const COMP = [
  { key: 'dealer_arrests', label: 'Dealer (supply)', color: 'var(--c-green, #2e9e6b)' },
  { key: 'paraphernalia', label: 'Paraphernalia', color: 'var(--c-red, #d64545)' },
  { key: 'other_drug_arrests', label: 'Possession / use / other', color: 'var(--c-gray, #9aa0a6)' },
];

let AGG, PROV, TMETA, GEO;
let active = 'Northern';
let focus = 'cfs_drug';                 // 'cfs_drug' | 'dealer_arrests' | 'needles'
let compScope = 'district';             // 'district' | 'citywide'
let mapSignal = 'cfs_drug';
const visibleCats = new Set(['persistent', 'cooled', 'emerged']);
const transitionData = {};

// ── deep-linkable map state (query string; district stays in the hash) ──
let pendingRestore = null;
function parseMapParams() {
  const p = new URLSearchParams(location.search);
  if (!p.has('z') || !p.has('ll')) return null;
  const [lat, lng] = (p.get('ll') || '').split(',').map(Number);
  const zoom = parseInt(p.get('z'), 10);
  if (![lat, lng, zoom].every(Number.isFinite)) return null;
  return { center: { lat, lng }, zoom, sig: p.get('sig'), cell: p.get('cl') };
}
function writeMapUrl(state) {
  if (!state) {
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

// ── series helpers ──
const sig = key => AGG.signals[key];
const seriesFor = (key, dist) => sig(key).series[dist] || sig(key).series.Citywide;
// each signal evaluates at the freshest month it can trust: settling signals hold back the lag months.
const evalIdx = key =>
  monthIndex(AGG, sig(key).settles ? AGG.latest_settled_month : AGG.latest_complete_month);
const allTimeAvg = s => s.reduce((a, b) => a + b, 0) / s.length;

// Direction-aware verdict. presence (cfs_drug, needles): down=good. enforcement goal (dealer): up=good.
function verdict(key, series, idx) {
  const t = trend12(series, idx);
  if (!t || t.pct == null) return { label: 'Not enough history', cls: 'verdict-flat', pct: null };
  const goalUp = sig(key).goal === 'up';
  const improving = goalUp ? t.pct > 0.05 : t.pct < -0.05;
  const worsening = goalUp ? t.pct < -0.05 : t.pct > 0.05;
  if (improving) return { label: goalUp ? 'Rising — good' : 'Improving', cls: 'verdict-good', pct: t.pct };
  if (worsening) return { label: goalUp ? 'Falling short' : 'Worsening', cls: 'verdict-bad', pct: t.pct };
  return { label: 'Little change', cls: 'verdict-flat', pct: t.pct };
}
// chip tone: for a goal-up metric a positive change is good; for goal-down it's bad.
function dirClass(key, x) {
  if (x == null || Math.abs(x) < 0.005) return 'delta-flat';
  const good = sig(key).goal === 'up' ? x > 0 : x < 0;
  return good ? 'delta-good' : 'delta-bad';
}

const CHART_SIGNALS = [
  ['cfs_drug', 'Drug reports'],
  ['dealer_arrests', 'Dealer arrests'],
];

function focusInfo() {
  const s = sig(focus);
  return { key: focus, label: s.label, note: s.caveat || '', citywideOnly: s.citywide_only };
}

// ── two co-headline cards ──
function summaryCard(key, label, accent) {
  const idx = evalIdx(key), series = seriesFor(key, active), cur = series[idx], v = verdict(key, series, idx);
  const arrow = sig(key).goal === 'up' ? '↑ want up' : '↓ want down';
  return `<button class="scard ${focus === key ? 'is-focused' : ''}" data-focus="${key}" style="--accent:${accent}">
    <span class="scard__label">${label} <small class="scard__goal">${arrow}</small></span>
    <span class="scard__num">${cur.toLocaleString()}<small>${prettyMonth(AGG.months[idx])}</small></span>
    <span class="verdict ${v.cls}">${v.label}${v.pct != null ? ` · 12-mo ${fmtPct(v.pct)}` : ''}</span>
  </button>`;
}
function renderSummary() {
  $('#summary-cards').innerHTML =
    summaryCard('cfs_drug', 'Drug-activity reports', 'var(--c-orange, #e08a3c)') +
    summaryCard('dealer_arrests', 'Dealer arrests', 'var(--c-green, #2e9e6b)');
  $('#summary-cards').querySelectorAll('.scard').forEach(b => b.onclick = () => setFocus(b.dataset.focus));
}

// ── detail strip under the chart ──
function cmp(key, label, cur, ref, refLabel) {
  if (ref == null) return `<div class="cmp"><span class="cmp__h">${label}</span><span class="cmp__v">—</span></div>`;
  const pct = ref ? (cur - ref) / ref : null;
  return `<div class="cmp ${dirClass(key, pct)}"><span class="cmp__h">${label}</span>
    <span class="cmp__v">${fmtPct(pct)}</span><span class="cmp__r">${refLabel}</span></div>`;
}
function renderDetail(key) {
  const idx = evalIdx(key);
  const cwOnly = sig(key).citywide_only;
  const series = cwOnly ? sig(key).series.Citywide : seriesFor(key, active);
  const city = sig(key).series.Citywide;
  const cur = series[idx], y = yoy(series, idx), typical = allTimeAvg(series.slice(0, idx + 1));
  const cityT = trend12(city, idx);
  let shareLine = '';
  if (!cwOnly) {
    const shareNow = city[idx] ? cur / city[idx] : null;
    let d = 0, c = 0;
    for (let i = 0; i <= idx; i++) { d += series[i]; c += city[i]; }
    const shareAvg = c ? d / c : null;
    shareLine = ` · ${active} is ${shareNow != null ? (shareNow * 100).toFixed(0) + '%' : '—'} of citywide
      (typically ${shareAvg != null ? (shareAvg * 100).toFixed(0) + '%' : '—'})`;
  }
  $('#detail-strip').innerHTML = `
    <div class="cmps">
      ${cmp(key, 'vs last month', cur, series[idx - 1], prettyMonth(AGG.months[idx - 1]))}
      ${cmp(key, 'vs a year ago', cur, y && y.prior, y && y.prior != null ? prettyMonth(AGG.months[idx - 12]) : '')}
      ${cmp(key, 'vs a typical month', cur, typical, `avg ${typical.toFixed(0)}`)}
    </div>
    <div class="ctx-line"><span>In SF context:</span>
      citywide 12-mo ${cityT ? fmtPct(cityT.pct) : '—'}${shareLine}</div>`;
}

// ── focused chart ──
function renderFocusChart() {
  const fi = focusInfo();
  const series = fi.citywideOnly ? sig(fi.key).series.Citywide : seriesFor(fi.key, active);
  const city = sig(fi.key).series.Citywide;
  const months = AGG.months, partialIdx = months.indexOf(AGG.current_partial_month);
  const maxD = Math.max(1, ...series), maxC = Math.max(1, ...city);
  const unsettledFromIdx = sig(fi.key).settles ? monthIndex(AGG, AGG.latest_settled_month) + 1 : undefined;
  renderChart($('#chart'), {
    months, values: series, partialIdx, unsettledFromIdx,
    overlays: {
      trend: trailing12Line(series),
      priorYear: priorYearLine(series),
      citywideScaled: fi.citywideOnly ? null : city.map(v => v * (maxD / maxC)),
    },
    noun: sig(fi.key).axis === 'enforcement' ? 'arrest' : 'report',
  });
  let note = fi.note || '';
  if (sig(fi.key).excluded_from_trend) note = '⚠ Excluded from the trend read. ' + note;
  $('#chart-note').textContent = note;
  renderDetail(fi.key);
}

function buildChartSelector() {
  $('#chart-selector').innerHTML = CHART_SIGNALS.map(([k, lab]) =>
    `<button class="seg ${focus === k ? 'is-active' : ''}" data-f="${k}">${lab}</button>`).join('');
  $('#chart-selector').querySelectorAll('.seg').forEach(b => b.onclick = () => setFocus(b.dataset.f));
}
function setFocus(f) {
  focus = f;
  renderSummary();
  buildChartSelector();
  renderFocusChart();
}

// ── composition: what drug arrests are made of (dealer vs churn) ──
function buildCompositionControls() {
  const opts = [['district', active], ['citywide', 'Citywide']];
  $('#composition-controls').innerHTML = opts.map(([k, lab]) =>
    `<button class="seg ${compScope === k ? 'is-active' : ''}" data-c="${k}">${lab}</button>`).join('');
  $('#composition-controls').querySelectorAll('.seg').forEach(b =>
    b.onclick = () => { compScope = b.dataset.c; renderComposition(); });
}
function renderComposition() {
  buildCompositionControls();
  const dist = compScope === 'citywide' ? 'Citywide' : active;
  const months = AGG.months, partialIdx = months.indexOf(AGG.current_partial_month);
  const layers = COMP.map(c => ({ label: c.label, color: c.color, values: AGG.signals[c.key].series[dist] }));
  renderStacked($('#composition-chart'), { months, layers, partialIdx });

  const idx = monthIndex(AGG, AGG.latest_settled_month);
  const dealer = AGG.signals.dealer_arrests.series[dist];
  const para = AGG.signals.paraphernalia.series[dist];
  const total = COMP.reduce((s, c) => s + AGG.signals[c.key].series[dist][idx], 0);
  const dealerShare = total ? Math.round(dealer[idx] / total * 100) : 0;
  const paraShare = total ? Math.round(para[idx] / total * 100) : 0;
  const dT = trend12(dealer, idx), pT = trend12(para, idx);
  $('#composition-lead').innerHTML = `
    <p>In <strong>${prettyMonth(AGG.months[idx])}</strong>, ${compScope === 'citywide' ? 'citywide' : active}
      drug arrests were <strong style="color:var(--c-red,#d64545)">${paraShare}% paraphernalia</strong>
      and only <strong style="color:var(--c-green,#2e9e6b)">${dealerShare}% dealer</strong>.
      Over the past year, dealer arrests are ${dT ? fmtPct(dT.pct) : '—'} and paraphernalia arrests are
      ${pT ? fmtPct(pT.pct) : '—'} — much of the enforcement volume is catch-and-release churn, not supply
      disruption.</p>`;
  $('#composition-note').textContent = AGG.groups.arrest_mix.note;
}

// ── transition / displacement map (presence only) ──
async function renderMap() {
  if (!transitionData[mapSignal]) transitionData[mapSignal] = await loadTransitions(mapSignal);
  if (pendingRestore) queueRestore(pendingRestore.cell);
  focusDistrict($('#map'), GEO, active);
  const counts = renderCells(transitionData[mapSignal], active, visibleCats);
  setMarkers(mapSignal, () => loadMarkers(mapSignal));
  $('#map-legend').innerHTML = Object.entries(CATEGORY).map(([k, m]) => `
    <button class="legend-item ${visibleCats.has(k) ? '' : 'is-off'}" data-cat="${k}"
            style="--cat:${m.color}" title="Click to show/hide on the map" aria-pressed="${visibleCats.has(k)}">
      <span class="legend-top"><span class="legend-dot"></span><span class="legend-label">${m.label}</span></span>
      <span class="legend-count">${counts[k] || 0}</span>
      <span class="legend-blurb">${m.blurb}</span>
    </button>`).join('');
  $('#map-legend').querySelectorAll('.legend-item').forEach(b =>
    b.onclick = () => { const c = b.dataset.cat; visibleCats.has(c) ? visibleCats.delete(c) : visibleCats.add(c); renderMap(); });
  const sigMeta = TMETA.signals[mapSignal];
  const tide = sigMeta.district_tide[active];
  const hot = sigMeta.hot_rate_per_month;
  $('#map-note').innerHTML =
    `Each dot is a ~block (≈110 m) reaching at least <strong>${hot} drug-activity calls/month</strong>, ` +
    `classified by how its “hot now” rate (last 3 complete months) compares to pre-Lurie (2023–24), ` +
    `<strong>normalized against ${active}’s overall change</strong> (×${tide} pre→now) so citywide growth ` +
    `doesn’t read as local change. Built on community drug-activity reports only (never enforcement). ` +
    `This is the displacement view — where activity persisted, cooled, or emerged as people were moved around. ` +
    `<strong>Click a block</strong> to pin its trend and a shareable link; <strong>zoom in</strong> for individual reports.`;

  if (pendingRestore) {
    const r = pendingRestore; pendingRestore = null;
    $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    restoreMapView(r.center, r.zoom);
  }
}

// ── nav ──
function buildNav() {
  $('#district-nav').innerHTML = DISTRICTS.map(d => `<a href="#${d.toLowerCase()}" data-d="${d}">${d}</a>`).join('');
}
function routeFromHash() {
  const h = (location.hash || '').replace('#', '').toLowerCase();
  renderDistrict(DISTRICTS.find(d => d.toLowerCase() === h) || 'Northern');
}
function renderDistrict(name) {
  active = name;
  document.querySelectorAll('.district-nav a').forEach(a => a.classList.toggle('is-active', a.dataset.d === name));
  renderSummary();
  buildChartSelector();
  renderFocusChart();
  renderComposition();
  renderMap();
}

// ── methodology (D5 / D7 / D9) ──
function renderMethodology() {
  const s = PROV.signals;
  const q = url => `<a href="${url}" target="_blank" rel="noopener">query ↗</a>`;
  const row = (key, why) => {
    const p = s[key];
    return `<li><strong>${AGG.signals[key].label}</strong> — ${why}
      <br><small>${p.dataset_name} (<code>${p.dataset_id}</code>) · ${q(p.query_url)}</small></li>`;
  };
  document.getElementById('methodology-body').innerHTML = `
    <p class="meth-lead">Every signal names its dataset and links a runnable Socrata query, so each number
      ties back to source data.</p>

    <h3>The two headline metrics</h3>
    <ul class="meth-list">
      ${row('cfs_drug', 'the problem signal — community 911 “suspicious person, drug-noted” calls (emergent-map’s drug-activity channel, ~95% drug-related). Citizen-perception and robust to enforcement levels. <strong>Down = good.</strong>')}
      ${row('dealer_arrests', 'SFPD drug arrests narrowed to <em>dealing/distribution</em> charges, counted as distinct incidents. Given the fentanyl crisis we elevate this from context to a goal: <strong>up = good</strong> (supply disruption). Caveat: arrest counts are partly reflexive — a rise can reflect enforcement effort, not only more dealers.')}
    </ul>

    <h3>What we leave OUT of dealer arrests — and why</h3>
    <p class="meth-out-lead">The dealer metric deliberately excludes the bulk of drug-arrest volume, because
      those arrests are catch-and-release that rarely lead to charges — they measure enforcement churn, not
      supply disruption:</p>
    <ul class="meth-list meth-list--out">
      ${row('paraphernalia', 'possessing drug paraphernalia (pipes, etc.). The single largest drug-arrest type and the entire recent surge — but it’s user-level churn, not dealing.')}
      ${row('other_drug_arrests', 'simple/ambiguous possession, under-the-influence, and loitering-where-sold. Also user-level, also excluded from the dealer metric.')}
    </ul>
    <p class="meth-caveat"><strong>Honesty note:</strong> the incident dataset (<code>wg3w-h783</code>) records
      the <em>arrest</em>, not the District Attorney’s charging decision. “Rarely leads to charges” is the
      documented SF practice of declining/diverting paraphernalia and simple-possession cases — it is the
      policy reality that justifies excluding them, not something this dataset proves on its own. We exclude on
      <strong>charge type</strong>; the no-charge outcome is the reason why.</p>

    <h3>Removed entirely — needle / syringe reports</h3>
    <ul class="meth-list meth-list--out">
      <li><strong>Needle / syringe 311 reports</strong> — deliberately <strong>not shown</strong>. They look
        like a clean “drugs are down” story (citywide ${q(s.needles?.query_url || '#')} ≈ −18% year-over-year,
        and ~4× lower than 2018), but that fall is the shift from <em>injecting</em> to <em>smoking</em>
        fentanyl, not less drug use — so trending it would mislead. We checked whether any single district
        bucked the trend (which would have been worth showing): none do — Northern −26%, Central −15%,
        Tenderloin −17%, Mission −2%, all flat-to-down. With no district-level signal and a high risk of
        misreading, we leave needles out rather than caveat a misleading chart.
        <br><small>SF 311 Cases (<code>vw6y-z8j6</code>)${s.needles ? ` · ${q(s.needles.query_url)}` : ''}</small></li>
    </ul>

    <h3>The hotspot map — how to read it</h3>
    <p>Built on <strong>community drug-activity reports only</strong> (never arrests, to avoid the
      reflexivity trap). It uses the same method as the
      <a href="../unhoused/" target="_blank" rel="noopener">unhoused dashboard</a> — a
      <strong>difference-in-differences</strong> on the fixed <strong>Lurie-inauguration split (Jan 2025)</strong>:
      each ~block (≈110 m) is scored by its rate in the <strong>last 3 complete months</strong> versus its
      <strong>2023–24 (pre-Lurie) baseline</strong>, then <em>normalized against how its whole district moved</em>
      over the same span (the district “tide”). So a block is judged on whether it out- or under-ran its
      district, not on raw counts — which absorbs citywide growth, seasonality, and reporting changes.</p>
    <ul class="meth-list">
      <li><strong>Persistently hot</strong> — hot in 2023–24 <em>and</em> still hot, roughly tracking its district.</li>
      <li><strong>Newly emerged</strong> — was cold pre-Lurie, hot now, and rose <em>faster</em> than its district.</li>
      <li><strong>Cooled</strong> — was hot, has fallen relative to its district (includes emerged-then-cooled).</li>
    </ul>
    <p class="meth-caveat"><strong>Why most blocks read “emerged.”</strong> The baseline is ~two years back, and
      drug activity has spread into many blocks that were quiet in 2023–24 — so those read as newly emerged,
      while only chronically-hot areas (above all the <strong>Tenderloin</strong>, whose level barely changed)
      show as persistent. That is the real spread-and-displacement story, not an artifact; the unhoused map
      shows the same emerged-heavy shape for the same reason. Read “emerged” as <em>“hot now, wasn’t before
      2025,”</em> and use the district-tide figure (in the note under the map) to see how much of that is the
      district rising overall versus this specific block.</p>

    <p class="meth-foot">${PROV.settle_note}<br>Data current to ${PROV.generated}. History from
      ${PROV.history_start}. Seasonality-aware, observational (not causal).</p>`;
}

// ── boot ──
async function main() {
  try {
    [AGG, PROV, TMETA] = await Promise.all([loadAggregates(), loadProvenance(), loadTransitionMeta()]);
    GEO = await fetch('./data/police_districts.geojson').then(r => r.json());
    $('#data-asof').textContent =
      `Data current to ${AGG.generated} · drug reports evaluate ${prettyMonth(AGG.latest_complete_month)}, ` +
      `arrests evaluate ${prettyMonth(AGG.latest_settled_month)} (latest settled)`;
    setSparkMeta(TMETA.months, TMETA.lurie_month);
    pendingRestore = parseMapParams();
    if (pendingRestore && pendingRestore.sig === 'cfs_drug') mapSignal = pendingRestore.sig;
    onMapState(writeMapUrl);
    buildNav();
    renderMethodology();
    window.addEventListener('hashchange', () => { pendingRestore = null; writeMapUrl(null); routeFromHash(); });
    routeFromHash();
  } catch (e) {
    const s = $('#status'); s.hidden = false; s.textContent = 'Failed to load data: ' + e.message;
    console.error(e);
  }
}
main();
