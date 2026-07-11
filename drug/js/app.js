// ──────────────────────────────────────────────────────────────────────
// Drug-activity dashboard — per-district pages (hash router) over pre-baked JSON.
// TWO co-headline cards with OPPOSITE goals (plan D9):
//   • Drug-activity reports (cfs_drug)  — community 911, want DOWN
//   • Dealer arrests (dealer_arrests)   — supply disruption, want UP
// A focused chart (reports · dealer arrests · needles), the "what drug arrests
// are made of" composition (dealer vs paraphernalia vs other), and the fixed-Lurie
// displacement map built on presence only (D2). Methodology footnotes per D5/D7/D9.
// ──────────────────────────────────────────────────────────────────────
import { loadAggregates, loadProvenance, loadTransitionMeta, loadTransitions, loadMarkers } from '../../shared/data.js';
import { renderChart, renderStacked } from '../../shared/chart.js';
import {
  monthIndex, prettyMonth, trend12, trailing12Line, priorYearLine, fmtPct, momentumN,
} from '../../shared/rollup.js';
import {
  CATEGORY, focusDistrict, renderCells, setSparkMeta, setMarkers,
  onMapState, notifyState, queueRestore, restoreMapView, setTodFilter,
  setSplitView, getSplitView,
} from '../../shared/transition-map.js';
import { classifyCells, ymRange, districtTide } from '../../shared/classify.js';
import { wireSplitToggle, refreshSplitToggle, wireSearch } from '../../shared/hotspots-panel.js';

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
let todFilter = 'both';                  // 'both' | 'day' | 'night' — the page-level time-of-day filter
const visibleCats = new Set(['persistent', 'cooled', 'emerged']);
const transitionData = {};

// ── global time window (the scrubber) — indices into AGG.months (the chart axis) ──
// Drives ONLY the map; the chart hosts it (band); the cards ignore it. Baseline is the FIXED
// pre-Lurie 24-mo normal (TMETA.pre_window). See ../plan-scrubber.md §2.
let win = null;                         // {lo, hi}
let lurieIdx = 0, latestCompleteIdx = 0, MIN_WIN = 3;
let PRESETS = [];

// ── deep-linkable state (query string; district stays in the hash) ──
// One writer for BOTH the analysis window (w=startYM_endYM) and the pinned-cell map view
// (z/ll/sig/cl), so the two never clobber each other's params.
let pendingRestore = null;
let lastMapState = null;
function parseUrlParams() {
  const p = new URLSearchParams(location.search);
  const out = { win: null, map: null };
  const w = p.get('w');
  if (w && w.includes('_')) {
    const [a, b] = w.split('_');
    const lo = AGG.months.indexOf(a), hi = AGG.months.indexOf(b);
    if (lo >= 0 && hi >= lo) out.win = { lo, hi };
  }
  if (p.has('z') && p.has('ll')) {
    const [lat, lng] = (p.get('ll') || '').split(',').map(Number);
    const zoom = parseInt(p.get('z'), 10);
    if ([lat, lng, zoom].every(Number.isFinite))
      out.map = { center: { lat, lng }, zoom, sig: p.get('sig'), cell: p.get('cl') };
  }
  return out;
}
function syncUrl() {
  const p = new URLSearchParams();
  // omit the window param when it's the default (since-Lurie) so plain links stay clean
  if (win && !(win.lo === lurieIdx && win.hi === latestCompleteIdx))
    p.set('w', `${AGG.months[win.lo]}_${AGG.months[win.hi]}`);
  if (lastMapState) {
    p.set('z', String(lastMapState.zoom));
    p.set('ll', `${lastMapState.center.lat.toFixed(5)},${lastMapState.center.lng.toFixed(5)}`);
    p.set('sig', mapSignal);
    if (lastMapState.cell) p.set('cl', lastMapState.cell);
  }
  const qs = p.toString();
  history.replaceState(null, '', qs ? `${location.pathname}?${qs}${location.hash}` : location.pathname + location.hash);
}
function onMapStateChange(state) { lastMapState = state; syncUrl(); }

// ── series helpers ──
const sig = key => AGG.signals[key];
// Day/Night filter (plan-time-of-day.md §3): 'both' → the total series (unchanged); a single bucket →
// that day/night slice. Works for both signal and group nodes; falls back to total if no split exists.
const seriesBlock = node => (todFilter === 'both' ? node.series : (node.series_tod?.[todFilter] || node.series));
const seriesFor = (key, dist) => { const s = seriesBlock(sig(key)); return s[dist] || s.Citywide; };
// each signal evaluates at the freshest month it can trust: settling signals hold back the lag months.
const evalIdx = key =>
  monthIndex(AGG, sig(key).settles ? AGG.latest_settled_month : AGG.latest_complete_month);

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
// The cards are the decoupled "where things stand now" header — always the latest month, never the
// scrubber window (plan D4/D5). One authoritative verdict (12-mo trend) + a subordinate row of
// momentum chips at 1/3/12-mo horizons, each goal-colored (short ones aren't season-adjusted).
function momentumChips(key, series, idx) {
  const horizons = [['month', 1], ['3-mo', 3], ['yr', 12]];
  return `<span class="scard__chips">` + horizons.map(([lab, n]) => {
    const pct = momentumN(series, idx, n);
    const tip = n < 12 ? ' title="recent momentum — not season-adjusted"' : ' title="12-mo trend — season-neutral"';
    return `<span class="chip ${dirClass(key, pct)}"${tip}><span class="chip__h">${lab}</span> ${fmtPct(pct)}</span>`;
  }).join('') + `</span>`;
}
function summaryCard(key, label, accent) {
  const idx = evalIdx(key), series = seriesFor(key, active), cur = series[idx], v = verdict(key, series, idx);
  const arrow = sig(key).goal === 'up' ? '↑ want up' : '↓ want down';
  return `<button class="scard ${focus === key ? 'is-focused' : ''}" data-focus="${key}" style="--accent:${accent}">
    <span class="scard__label">${label} <small class="scard__goal">${arrow}</small></span>
    <span class="scard__num">${cur.toLocaleString()}<small>${prettyMonth(AGG.months[idx])}</small></span>
    <span class="verdict ${v.cls}">${v.label}${v.pct != null ? ` · 12-mo ${fmtPct(v.pct)}` : ''}</span>
    ${momentumChips(key, series, idx)}
  </button>`;
}
function renderSummary() {
  $('#summary-cards').innerHTML =
    summaryCard('cfs_drug', 'Drug-activity reports', 'var(--c-orange, #e08a3c)') +
    summaryCard('dealer_arrests', 'Dealer arrests', 'var(--c-green, #2e9e6b)');
  $('#summary-cards').querySelectorAll('.scard').forEach(b => b.onclick = () => setFocus(b.dataset.focus));
}

// ── citywide context card (above the chart) ──
// Mirrors the headline-card format for the FOCUSED signal but at citywide scope — the macro picture
// the district cards drill into. Replaces the old per-district "vs last month/year/typical" strip,
// whose comparisons now live on the card pills (plan: cards decoupled, citywide gets its own slot).
function renderCitywide(key) {
  const cwOnly = sig(key).citywide_only;
  const city = seriesBlock(sig(key)).Citywide;
  const idx = evalIdx(key);
  const cur = city[idx];
  let shareLine = '';
  if (!cwOnly) {
    const dseries = seriesFor(key, active);
    const shareNow = city[idx] ? dseries[idx] / city[idx] : null;
    let d = 0, c = 0;
    for (let i = 0; i <= idx; i++) { d += dseries[i]; c += city[i]; }
    const shareAvg = c ? d / c : null;
    shareLine = `<span class="cw__share">${active} is <strong>${shareNow != null ? Math.round(shareNow * 100) + '%' : '—'}</strong> ` +
      `of citywide <small>(typically ${shareAvg != null ? Math.round(shareAvg * 100) + '%' : '—'})</small></span>`;
  }
  $('#citywide-card').innerHTML = `
    <span class="cw__label">Citywide · ${sig(key).label}</span>
    <span class="cw__num">${cur.toLocaleString()}<small>${prettyMonth(AGG.months[idx])}</small></span>
    ${momentumChips(key, city, idx)}
    ${shareLine}`;
}

// ── focused chart ──
function renderFocusChart() {
  const fi = focusInfo();
  const series = fi.citywideOnly ? seriesBlock(sig(fi.key)).Citywide : seriesFor(fi.key, active);
  const city = seriesBlock(sig(fi.key)).Citywide;
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
    window: win, onBrush: onChartBrush, maxSel: latestCompleteIdx, minWin: MIN_WIN,
  });
  let note = fi.note || '';
  if (sig(fi.key).excluded_from_trend) note = '⚠ Excluded from the trend read. ' + note;
  $('#chart-note').textContent = note;
  renderCitywide(fi.key);
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

// ── the time scrubber ───────────────────────────────────────────────────
const clampWin = (lo, hi) => {
  lo = Math.max(0, Math.min(lo, latestCompleteIdx));
  hi = Math.max(lo, Math.min(hi, latestCompleteIdx));
  if (hi - lo + 1 < MIN_WIN) hi = Math.min(latestCompleteIdx, lo + MIN_WIN - 1);
  return { lo, hi };
};
const sameWin = (a, b) => a && b && a.lo === b.lo && a.hi === b.hi;
// the transitions axis omits the partial month; keep a resolved window range inside it
const clampToAxis = r => ({
  lo: Math.max(0, r.lo),
  hi: r.hi < 0 ? TMETA.months.length - 1 : Math.min(TMETA.months.length - 1, r.hi),
});

function buildPresets() {
  const L = latestCompleteIdx;
  PRESETS = [
    { id: 'lurie', label: 'Since Lurie', lo: lurieIdx, hi: L },
    { id: '12mo', label: 'Last 12 mo', lo: Math.max(0, L - 11), hi: L },
    { id: '3mo', label: 'Last 3 mo', lo: Math.max(0, L - 2), hi: L },
    { id: 'all', label: 'All time', lo: 0, hi: L },
  ];
}

function renderScrubber() {
  const activePreset = PRESETS.find(p => p.lo === win.lo && p.hi === win.hi);
  $('#scrubber-presets').innerHTML = PRESETS.map(p =>
    `<button class="seg ${activePreset && activePreset.id === p.id ? 'is-active' : ''}" data-preset="${p.id}">${p.label}</button>`
    ).join('') + (activePreset ? '' : '<span class="seg is-custom" aria-disabled="true">Custom</span>');
  $('#scrubber-presets').querySelectorAll('button[data-preset]').forEach(b =>
    b.onclick = () => { const p = PRESETS.find(x => x.id === b.dataset.preset); setWindow(p.lo, p.hi); });
  const span = `${prettyMonth(AGG.months[win.lo])} – ${prettyMonth(AGG.months[win.hi])}`;
  const n = win.hi - win.lo + 1;
  $('#scrubber-label').innerHTML =
    `<strong>Analyzing ${span}</strong> <small>(${n} mo)</small> · map compares this to the ` +
    `<strong>pre-Lurie 2023–24 baseline</strong>`;
}

// preset / programmatic change → repaint chart (to move the band) + reclassify map
function setWindow(lo, hi) {
  win = clampWin(lo, hi);
  renderScrubber();
  renderFocusChart();
  renderMap();
  syncUrl();
}
// live brush from the chart → move the band live (chart already did) + label; reclassify only on commit
function onChartBrush(lo, hi, committed) {
  win = clampWin(lo, hi);
  renderScrubber();
  if (committed) { renderMap(); syncUrl(); }
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
  const layers = COMP.map(c => ({ label: c.label, color: c.color, values: seriesBlock(AGG.signals[c.key])[dist] }));
  renderStacked($('#composition-chart'), { months, layers, partialIdx });

  const idx = monthIndex(AGG, AGG.latest_settled_month);
  const dealer = seriesBlock(AGG.signals.dealer_arrests)[dist];
  const para = seriesBlock(AGG.signals.paraphernalia)[dist];
  const total = COMP.reduce((s, c) => s + seriesBlock(AGG.signals[c.key])[dist][idx], 0);
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

  // Reclassify every candidate block against the SELECTED window vs the fixed pre-Lurie baseline,
  // normalized by the district tide recomputed over the same window (classify.js — parity-checked).
  const sigMeta = TMETA.signals[mapSignal];
  const knobs = { hot: sigMeta.hot_rate_per_month, floor: TMETA.knobs.floor, band: TMETA.knobs.tide_band };
  const winSpan = [AGG.months[win.lo], AGG.months[win.hi]];
  const w = clampToAxis(ymRange(TMETA.months, winSpan));
  const b = ymRange(TMETA.months, TMETA.pre_window);
  // Day/Night filter: classify the cells off the matching histogram + district tide (plan §3/§5).
  const monthlyKey = todFilter === 'both' ? 'monthly' : `monthly_${todFilter}`;
  const dm = (todFilter === 'both' ? sigMeta.district_monthly : sigMeta[`district_monthly_${todFilter}`])
             || sigMeta.district_monthly;
  setTodFilter(todFilter);   // cell-details breakdown honors the same filter
  const classified = classifyCells(transitionData[mapSignal], dm, w, b, knobs, monthlyKey);
  const counts = renderCells(classified, active, visibleCats);
  setMarkers(mapSignal, () => loadMarkers(mapSignal));   // lazy-loaded for the per-cell "See details" breakdown
  $('#map-legend').innerHTML = Object.entries(CATEGORY).map(([k, m]) => `
    <button class="legend-item ${visibleCats.has(k) ? '' : 'is-off'}" data-cat="${k}"
            style="--cat:${m.color}" title="Click to show/hide on the map" aria-pressed="${visibleCats.has(k)}">
      <span class="legend-top"><span class="legend-dot"></span><span class="legend-label">${m.label}</span></span>
      <span class="legend-count">${counts[k] || 0}</span>
      <span class="legend-blurb">${m.blurb}</span>
    </button>`).join('');
  $('#map-legend').querySelectorAll('.legend-item').forEach(b =>
    b.onclick = () => { const c = b.dataset.cat; visibleCats.has(c) ? visibleCats.delete(c) : visibleCats.add(c); renderMap(); });
  const tide = +districtTide(dm[active], w, b).toFixed(2);
  const hot = sigMeta.hot_rate_per_month;
  const span = `${prettyMonth(AGG.months[win.lo])}–${prettyMonth(AGG.months[win.hi])}`;
  $('#map-note').innerHTML =
    `Each dot is a ~block (≈110 m) reaching at least <strong>${hot} drug-activity calls/month</strong>, ` +
    `classified by how its rate over <strong>${span}</strong> compares to its <strong>pre-Lurie (2023–24) baseline</strong>, ` +
    `<strong>normalized against ${active}’s overall change</strong> (×${tide} baseline→window) so citywide growth ` +
    `doesn’t read as local change. Built on community drug-activity reports only (never enforcement). ` +
    `This is the displacement view — where activity persisted, cooled, or emerged as people were moved around. ` +
    `<strong>Drag the chart above</strong> to change the window; <strong>click a block</strong> for its monthly trend, ` +
    `a breakdown of report types, and a shareable link.`;

  if (pendingRestore) {
    const r = pendingRestore; pendingRestore = null;
    $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    restoreMapView(r.center, r.zoom);
  }
}

// ── page-level Day/Night filter (plan-time-of-day.md §5) ──
// Two independent include/exclude chips at the top of the page; ≥1 must stay on. Changing the filter
// re-renders every viz off the selected day/night slice (cards, citywide, chart, composition, map).
function applyTod() {
  const on = [...document.querySelectorAll('#tod-controls .tod-toggle')]
    .filter(b => b.classList.contains('is-active')).map(b => b.dataset.tod);
  todFilter = on.length === 2 ? 'both' : on[0];
  // Split markers are a lens on the FULL day/night mix; a day- or night-only filter would make the
  // pie contradict the (filtered) marker size, so exclude → force Combined view. (See plan §guardrails.)
  if (todFilter !== 'both' && getSplitView()) { setSplitView(false); refreshSplitToggle(); }
  const hint = $('.tod-filter__hint');
  if (hint) hint.textContent =
    `Day 6am–8pm · Night 8pm–6am · showing ${todFilter === 'both' ? 'both' : todFilter + ' only'}`;
  renderSummary();
  renderFocusChart();   // also refreshes the citywide card
  renderComposition();
  renderMap();
}
function wireTodToggles() {
  const btns = [...document.querySelectorAll('#tod-controls .tod-toggle')];
  btns.forEach(btn => btn.onclick = () => {
    const active = btns.filter(b => b.classList.contains('is-active'));
    if (btn.classList.contains('is-active') && active.length === 1) return;   // keep ≥1 selected
    btn.classList.toggle('is-active');
    btn.setAttribute('aria-pressed', btn.classList.contains('is-active'));
    applyTod();
  });
}

// Split-view toggle callback: split markers are a lens on the FULL day/night mix, so entering split
// resets the page Day/Night filter to both (keeps marker size and the day/night pie on the same data).
function enterSplitView(isSplit) {
  if (isSplit) {
    document.querySelectorAll('#tod-controls .tod-toggle').forEach(b => {
      b.classList.add('is-active'); b.setAttribute('aria-pressed', 'true');
    });
    applyTod();     // recomputes todFilter='both', updates hint, and renderMap() draws split markers
  } else {
    renderMap();    // back to combined
  }
}

// ── district (locked from homepage selection) ──
function initDistrict() {
  const h = (location.hash || '').replace('#', '').toLowerCase();
  active = DISTRICTS.find(d => d.toLowerCase() === h) || 'Northern';
  // Update header to show which district we're viewing
  const eyebrow = document.querySelector('.app-header__eyebrow');
  if (eyebrow) eyebrow.textContent = `San Francisco · ${active} district · Drug activity`;
}
function renderDistrict() {
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

    // window setup: indices into AGG.months; default = full Lurie era (since-Lurie preset)
    lurieIdx = Math.max(0, AGG.months.indexOf(AGG.lurie_inauguration.slice(0, 7)));
    latestCompleteIdx = AGG.months.indexOf(AGG.latest_complete_month);
    buildPresets();
    const parsed = parseUrlParams();
    win = parsed.win ? clampWin(parsed.win.lo, parsed.win.hi) : { lo: lurieIdx, hi: latestCompleteIdx };

    pendingRestore = parsed.map;
    if (pendingRestore && pendingRestore.sig === 'cfs_drug') mapSignal = pendingRestore.sig;
    onMapState(onMapStateChange);
    initDistrict();
    wireTodToggles();
    wireSplitToggle({ onChange: enterSplitView });
    wireSearch();
    renderScrubber();
    renderMethodology();
    renderDistrict();
  } catch (e) {
    const s = $('#status'); s.hidden = false; s.textContent = 'Failed to load data: ' + e.message;
    console.error(e);
  }
}
main();
