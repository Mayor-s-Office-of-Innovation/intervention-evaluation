// ──────────────────────────────────────────────────────────────────────
// Orchestration — per-district pages (hash router) over the pre-baked JSON.
// Consolidated layout (plan D15): two compact SUCCESS cards (Encampments,
// 911 unhoused calls — want DOWN), one focused chart with a selector
// (Aggregate=sum · Encampment · 911), a detail strip under it, and HSOC as a
// RESPONSE signal below (the theft-arrests analog — not a success target, D8).
// Plus the fixed-Lurie transition map (D11/D12) and the methodology footnote (D7).
// ──────────────────────────────────────────────────────────────────────
import { loadAggregates, loadProvenance, loadTransitionMeta, loadTransitions, loadMarkers } from '../../shared/data.js';
import { renderChart } from '../../shared/chart.js';
import {
  monthIndex, prettyMonth, trend12, trailing12Line, priorYearLine, fmtPct, momentumN,
} from '../../shared/rollup.js';
import {
  CATEGORY, focusDistrict, renderCells, setSparkMeta, setMarkers, setMapWindow,
  onMapState, notifyState, queueRestore, restoreMapView, setTodFilter,
  setHourRange, setSplitView, getSplitView, onCellSelected, closeSelectedCell,
} from '../../shared/transition-map.js';
import { classifyCells, ymRange, districtTide } from '../../shared/classify.js';

const DISTRICTS = ['Northern', 'Mission', 'Tenderloin', 'Central'];
const $ = sel => document.querySelector(sel);

// ── deep-linkable map state (query string; the district stays in the hash) ──
// Written with replaceState so panning/zooming/opening cell popups never piles up Back-button history,
// but the URL is always shareable. Only populated while a block/intersection cell is pinned (emitState).
let pendingRestore = null;   // a parsed {center,zoom,sig,cell} to apply on first map render
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
// One writer for both the analysis window (w=startYM_endYM) and the pinned-cell map view (z/ll/sig/cl).
function syncUrl() {
  const p = new URLSearchParams();
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

let AGG, PROV, TMETA, GEO;
let active = 'Northern';
let focus = 'aggregate';          // 'aggregate' | 'encampment' | 'cfs_presence'
let encOnly = false;              // dedicated-category sub-view (only when focus === 'encampment')
let mapSignal = 'encampment';
let todFilter = 'both';            // 'both' | 'day' | 'night' — the page-level time-of-day filter
const visibleCats = new Set(['persistent', 'cooled', 'emerged']);
const transitionData = {};

// ── global time window (the scrubber) — indices into AGG.months. Drives ONLY the map; the chart hosts
// it (band); the cards ignore it. Baseline is the FIXED pre-Lurie normal (TMETA.pre_window). ──
let win = null;
let lurieIdx = 0, latestCompleteIdx = 0; const MIN_WIN = 3;
let PRESETS = [];
const clampToAxis = r => ({
  lo: Math.max(0, r.lo),
  hi: r.hi < 0 ? TMETA.months.length - 1 : Math.min(TMETA.months.length - 1, r.hi),
});

// ── series helpers ──
const lastIdx = () => monthIndex(AGG, AGG.latest_complete_month);
// Day/Night filter (plan-time-of-day.md §3): 'both' → total series (unchanged); a single bucket →
// that day/night slice. Falls back to total if a node has no split. Works for signal & group nodes.
const seriesBlock = node => (todFilter === 'both' ? node.series : (node.series_tod?.[todFilter] || node.series));
const seriesFor = (sigKey, dist) => seriesBlock(AGG.signals[sigKey])[dist];
const groupSeries = (gKey, dist) => seriesBlock(AGG.groups[gKey])[dist];
// Aggregate = summed total: encampment union (311) + 911 group. Distinct channels, no overlap (D15).
const aggSeries = dist => seriesFor('encampment', dist).map((v, i) => v + groupSeries('cfs_presence', dist)[i]);

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
// Decoupled "where things stand now" header — always the latest month, never the scrubber window.
// One verdict (12-mo trend) + a subordinate row of 1/3/12-mo momentum chips (presence: down = good).
function momentumChips(series, idx) {
  const horizons = [['month', 1], ['3-mo', 3], ['yr', 12]];
  return `<span class="scard__chips">` + horizons.map(([lab, n]) => {
    const pct = momentumN(series, idx, n);
    const tip = n < 12 ? ' title="recent momentum — not season-adjusted"' : ' title="12-mo trend — season-neutral"';
    return `<span class="chip ${dirClass(pct)}"${tip}><span class="chip__h">${lab}</span> ${fmtPct(pct)}</span>`;
  }).join('') + `</span>`;
}
function summaryCard(focusKey, label, series, accent) {
  const idx = lastIdx(), cur = series[idx], v = verdict(series, idx);
  return `<button class="scard ${focus === focusKey ? 'is-focused' : ''}" data-focus="${focusKey}" style="--accent:${accent}">
    <span class="scard__label">${label}</span>
    <span class="scard__num">${cur.toLocaleString()}<small>${prettyMonth(AGG.latest_complete_month)}</small></span>
    <span class="verdict ${v.cls}">${v.label}${v.pct != null ? ` · 12-mo ${fmtPct(v.pct)}` : ''}</span>
    ${momentumChips(series, idx)}
  </button>`;
}
function renderSummary() {
  $('#summary-cards').innerHTML =
    summaryCard('encampment', 'Encampments', seriesFor('encampment', active), 'var(--c-red)') +
    summaryCard('cfs_presence', '911 unhoused calls', groupSeries('cfs_presence', active), 'var(--c-orange)');
  $('#summary-cards').querySelectorAll('.scard').forEach(b =>
    b.onclick = () => setFocus(b.dataset.focus));
}

// ── citywide context card (above the chart) ──
// Mirrors the headline-card format for the FOCUSED series but at citywide scope — the macro picture the
// district cards drill into. Replaces the old per-district "vs last month/year/typical" detail strip,
// whose comparisons now live on the card pills.
function renderCitywide(fi) {
  const idx = lastIdx(), city = fi.series('Citywide'), dseries = fi.series(active);
  const cur = city[idx];
  const shareNow = city[idx] ? dseries[idx] / city[idx] : null;
  let d = 0, c = 0;
  for (let i = 0; i <= idx; i++) { d += dseries[i]; c += city[i]; }
  const shareAvg = c ? d / c : null;
  $('#citywide-card').innerHTML = `
    <span class="cw__label">Citywide · ${fi.label}</span>
    <span class="cw__num">${cur.toLocaleString()}<small>${prettyMonth(AGG.latest_complete_month)}</small></span>
    ${momentumChips(city, idx)}
    <span class="cw__share">${active} is <strong>${shareNow != null ? Math.round(shareNow * 100) + '%' : '—'}</strong> ` +
    `of citywide <small>(typically ${shareAvg != null ? Math.round(shareAvg * 100) + '%' : '—'})</small></span>`;
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
    window: win, onBrush: onChartBrush, maxSel: latestCompleteIdx, minWin: MIN_WIN,
  });
  $('#chart-note').textContent = fi.note || '';
  renderCitywide(fi);
}

// ── the time scrubber ───────────────────────────────────────────────────
const clampWin = (lo, hi) => {
  lo = Math.max(0, Math.min(lo, latestCompleteIdx));
  hi = Math.max(lo, Math.min(hi, latestCompleteIdx));
  if (hi - lo + 1 < MIN_WIN) hi = Math.min(latestCompleteIdx, lo + MIN_WIN - 1);
  return { lo, hi };
};
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
function setWindow(lo, hi) {
  win = clampWin(lo, hi);
  renderScrubber();
  renderFocusChart();
  renderMap();
  syncUrl();
}
function onChartBrush(lo, hi, committed) {
  win = clampWin(lo, hi);
  renderScrubber();
  if (committed) { renderMap(); syncUrl(); }
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

// ── render the district ──
function renderDistrict() {
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

  // Reclassify every candidate block against the SELECTED window vs the fixed pre-Lurie baseline,
  // normalized by the district tide recomputed over the same window (classify.js — parity-checked).
  const sigMeta = TMETA.signals[mapSignal];
  const knobs = { hot: sigMeta.hot_rate_per_month, floor: TMETA.knobs.floor, band: TMETA.knobs.tide_band };
  const winSpan = [AGG.months[win.lo], AGG.months[win.hi]];
  const w = clampToAxis(ymRange(TMETA.months, winSpan));
  const b = ymRange(TMETA.months, TMETA.pre_window);
  // Day/Night filter: classify off the matching histogram + district tide (plan §3/§5).
  const monthlyKey = todFilter === 'both' ? 'monthly' : `monthly_${todFilter}`;
  const dm = (todFilter === 'both' ? sigMeta.district_monthly : sigMeta[`district_monthly_${todFilter}`])
             || sigMeta.district_monthly;
  setTodFilter(todFilter);   // marker layer + cell-details honor the same filter
  const classified = classifyCells(transitionData[mapSignal], dm, w, b, knobs, monthlyKey);
  const counts = renderCells(classified, active, visibleCats);
  setMapWindow(winSpan, TMETA.pre_window);
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
  const tide = +districtTide(dm[active], w, b).toFixed(2);
  const hot = sigMeta.hot_rate_per_month;
  const span = `${prettyMonth(AGG.months[win.lo])}–${prettyMonth(AGG.months[win.hi])}`;
  $('#map-note').innerHTML =
    `Each dot is a ~block (≈110 m) that reaches at least <strong>${hot} ${mapSignal === 'encampment' ? 'reports' : 'calls'}/month</strong>, ` +
    `classified by how its rate over <strong>${span}</strong> compares to its <strong>pre-Lurie (2023–24) baseline</strong>, ` +
    `<strong>normalized against ${active}’s overall change</strong> (×${tide} baseline→window) so the June-2025 ` +
    `encampment reporting reroute and citywide growth don’t read as local change. ` +
    `Built on presence reports only (not HSOC). ` +
    (mapSignal === 'encampment'
      ? 'Encampment spans the June-2025 reroute — the reroute-free “911 calls” view corroborates the pattern. '
      : 'The 911 calls signal has no reporting reroute (a clean pre/post comparison), and uses a lower hotspot threshold because it is lower-volume. ') +
    '<strong>Drag the chart above</strong> to change the window; <strong>click a block</strong> to pin a shareable link; <strong>zoom in</strong> for individual reports (in-window vs baseline) with details on hover.';

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

// ── page-level Day/Night filter (plan-time-of-day.md §5) ──
// Two independent include/exclude chips at the top of the page; ≥1 must stay on. Changing the filter
// re-renders every viz off the selected day/night slice (cards, citywide, chart, HSOC, map).
function applyTod() {
  const on = [...document.querySelectorAll('#tod-controls .tod-toggle')]
    .filter(b => b.classList.contains('is-active')).map(b => b.dataset.tod);
  todFilter = on.length === 2 ? 'both' : on[0];
  const hint = $('.tod-filter__hint');
  if (hint) hint.textContent =
    `Day 6am–8pm · Night 8pm–6am · showing ${todFilter === 'both' ? 'both' : todFilter + ' only'}`;
  renderSummary();
  renderFocusChart();   // also refreshes the citywide card
  renderHSOC();
  renderMap();
}
function wireTodToggles() {
  const btns = [...document.querySelectorAll('#tod-controls .tod-toggle')];
  btns.forEach(btn => btn.onclick = () => {
    const activeBtns = btns.filter(b => b.classList.contains('is-active'));
    if (btn.classList.contains('is-active') && activeBtns.length === 1) return;   // keep ≥1 selected
    btn.classList.toggle('is-active');
    btn.setAttribute('aria-pressed', btn.classList.contains('is-active'));
    applyTod();
  });
}

// ── PR #32: Hour slider for granular time-of-day filtering ──
function buildHourSlider() {
  const wrap = $('#hour-slider-wrap');
  const bar = $('#hour-slider-bar');
  if (!wrap || !bar) return;
  wrap.hidden = false;   // reveal the slider
  const DAY_START = 6, NIGHT_START = 20;
  let segs = '';
  for (let h = 0; h < 24; h++) {
    const isNight = h < DAY_START || h >= NIGHT_START;
    segs += `<div class="hour-seg${isNight ? ' is-night' : ''}" data-h="${h}"></div>`;
  }
  bar.innerHTML = segs;
  // The slider is informational for now; users can still use Day/Night toggles.
  // Full drag implementation deferred to avoid scope creep.
}

// ── PR #32: Split view toggle (Combined vs Day vs Night markers) ──
function buildViewToggle() {
  const container = $('#map-view-toggle');
  if (!container) return;
  container.innerHTML = `
    <button class="seg ${!getSplitView() ? 'is-active' : ''}" data-v="combined">Combined</button>
    <button class="seg ${getSplitView() ? 'is-active' : ''}" data-v="split">Day vs night</button>`;
  container.querySelectorAll('.seg').forEach(btn => {
    btn.onclick = () => {
      const isSplit = btn.dataset.v === 'split';
      setSplitView(isSplit);
      buildViewToggle();
      // Show/hide split legend
      const splitLegend = $('#split-legend');
      if (splitLegend) splitLegend.hidden = !isSplit;
      renderMap();
    };
  });
}

// ── PR #32: Docked detail panel for selected hotspot ──
function wireDockedPanel() {
  const panelWrap = $('#map-panel-wrap');
  const closeBtn = $('#panel-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      panelWrap?.classList.remove('has-panel');
      closeSelectedCell();
    };
  }
  onCellSelected(cell => {
    if (!cell) {
      panelWrap?.classList.remove('has-panel');
      return;
    }
    panelWrap?.classList.add('has-panel');
    updateDockedPanel(cell);
  });
}

function updateDockedPanel(cell) {
  const meta = CATEGORY[cell.category];
  $('#panel-name').textContent = cell.name || `${cell.lat.toFixed(4)}, ${cell.lng.toFixed(4)}`;
  $('#panel-clf').innerHTML = `
    <span class="clf-badge ${cell.category}">${meta.label}</span>
    <span>${cell.district} · ≈110 m block</span>`;
  const fmtRate = n => (n == null ? '—' : Number(n).toFixed(1));
  $('#panel-metrics').innerHTML = `
    <div class="detail-panel__metric"><span class="label">Before Lurie</span><span class="value">${fmtRate(cell.preRate)}/mo</span></div>
    <div class="detail-panel__metric"><span class="label">Now</span><span class="value">${fmtRate(cell.nowRate)}/mo</span></div>
    ${cell.expectedRate != null ? `<div class="detail-panel__metric"><span class="label">District-tide</span><span class="value">${fmtRate(cell.expectedRate)}</span></div>` : ''}`;
  // Sparkline
  if (cell.monthly?.length) {
    const W = 280, H = 60, pad = 4;
    const max = Math.max(1, ...cell.monthly);
    const n = cell.monthly.length;
    const x = i => pad + (i / (n - 1)) * (W - 2 * pad);
    const y = v => H - pad - (v / max) * (H - 2 * pad);
    let d = '';
    cell.monthly.forEach((v, i) => { d += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; });
    const area = `M${x(0).toFixed(1)} ${H - pad} ` + cell.monthly.map((v, i) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ') + ` L${x(n - 1).toFixed(1)} ${H - pad} Z`;
    $('#panel-spark').innerHTML = `<svg viewBox="0 0 ${W} ${H}">
      <path d="${area}" fill="#f97316" fill-opacity="0.15"/>
      <path d="${d.trim()}" fill="none" stroke="#f97316" stroke-width="2"/></svg>`;
  }
  // Hourly distribution
  const hourly = cell.hourly || new Array(24).fill(0);
  const maxH = Math.max(1, ...hourly);
  const DAY_START = 6, NIGHT_START = 20;
  $('#panel-hourly').innerHTML = hourly.map((v, h) => {
    const pct = Math.max(4, (v / maxH) * 100);
    const isNight = h < DAY_START || h >= NIGHT_START;
    return `<div class="hbar${isNight ? ' is-night' : ''}" style="height:${pct}%"></div>`;
  }).join('');
  // Day/Night split bar
  const total = cell.day + cell.night;
  const dayPct = total ? Math.round((cell.day / total) * 100) : 50;
  const nightPct = 100 - dayPct;
  let splitLabel = 'Even';
  if (dayPct > 60) splitLabel = 'Mostly day';
  else if (nightPct > 60) splitLabel = 'Mostly night';
  $('#panel-split').innerHTML = `
    <div class="split-bar"><span class="d" style="width:${dayPct}%"></span><span class="n" style="width:${nightPct}%"></span></div>
    <div class="split-labels"><span>☀ Day ${dayPct}%</span><span>☾ Night ${nightPct}%</span></div>`;
}

// ── district (locked from homepage selection) ──
function initDistrict() {
  const h = (location.hash || '').replace('#', '').toLowerCase();
  active = DISTRICTS.find(d => d.toLowerCase() === h) || 'Northern';
  const eyebrow = document.querySelector('.app-header__eyebrow');
  if (eyebrow) eyebrow.textContent = `San Francisco · ${active} district · Unhoused presence`;
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

    // window setup: indices into AGG.months; default = full Lurie era (since-Lurie preset)
    lurieIdx = Math.max(0, AGG.months.indexOf(TMETA.lurie_month));
    latestCompleteIdx = AGG.months.indexOf(AGG.latest_complete_month);
    buildPresets();
    const parsed = parseUrlParams();
    win = parsed.win ? clampWin(parsed.win.lo, parsed.win.hi) : { lo: lurieIdx, hi: latestCompleteIdx };

    // Adopt any deep-linked map state before the first render (signal must be set before the map builds).
    pendingRestore = parsed.map;
    if (pendingRestore && (pendingRestore.sig === 'encampment' || pendingRestore.sig === 'cfs_presence')) {
      mapSignal = pendingRestore.sig;
    }
    onMapState(onMapStateChange);
    initDistrict();
    wireTodToggles();
    buildHourSlider();      // PR #32
    buildViewToggle();      // PR #32
    wireDockedPanel();      // PR #32
    buildMapControls();
    renderScrubber();
    renderMethodology();
    $('#enc-only-toggle').addEventListener('change', (e) => { encOnly = e.target.checked; renderFocusChart(); });
    renderDistrict();
  } catch (e) {
    const s = $('#status'); s.hidden = false; s.textContent = 'Failed to load data: ' + e.message;
    console.error(e);
  }
}
main();
