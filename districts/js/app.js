// ──────────────────────────────────────────────────────────────────────
// Orchestration: load pre-baked data → render rollup cards, the seasonal
// trend chart, and the map — all driven by ONE global time window so they
// stay in sync. A Play button slides that window forward month by month.
// (../plan.md §5; signals are data-driven, Encampment is the default.)
// ──────────────────────────────────────────────────────────────────────

import { loadAggregates, loadPoints } from './data.js';
import { renderChart } from './chart.js';
import * as M from './map.js';
import {
  monthIndex, prettyMonth, trailing12Line, priorYearLine,
  sumRange, windowYoY, windowShare, fmtPct, deltaClass,
} from './rollup.js';

const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const DISTRICT_ACCENT = {
  Central: 'var(--d-central)', Northern: 'var(--d-northern)',
  Mission: 'var(--d-mission)', Tenderloin: 'var(--d-tenderloin)', Citywide: 'var(--d-citywide)',
};
const PLAY_MS = 1400;

const state = {
  agg: null,
  signalKey: 'encampment',
  focus: 'Citywide',
  overlays: { trend: true, priorYear: true, citywide: false },
  points: null,
  mapMode: 'heat',
  lo: 0, hi: 0,         // active window: inclusive month indices
  playing: false, timer: null,
  _applying: false,     // guard so programmatic slider writes don't re-fire input
};

function status(msg, kind) {
  const s = $('#status');
  if (!msg) { s.hidden = true; return; }
  s.hidden = false; s.className = `status status--${kind}`; s.textContent = msg;
}

async function init() {
  try {
    status('Loading data…', 'loading');
    state.agg = await loadAggregates();
    status('');
    buildSignalSelect();
    $('#data-asof').textContent = `Data through ${prettyMonth(state.agg.latest_complete_month)} · built ${state.agg.generated}`;
    buildTimeBar();
    buildFocusTabs();
    await initMap();      // draws boundaries, builds modes, loads default-signal points
    applyWindow();        // first full render of cards + chart + map
    renderMethodology();
  } catch (e) {
    console.error(e);
    status(`Could not load the dashboard data. ${e.message}`, 'error');
  }
}

const sig = () => state.agg.signals[state.signalKey];
const focusSeries = () => sig().series[state.focus];
const citywideSeries = () => sig().series.Citywide;
const lastIdx = () => state.agg.months.length - 1;
const latestCompleteIdx = () => monthIndex(state.agg, state.agg.latest_complete_month);

// ───────────── Signal selector ─────────────
function buildSignalSelect() {
  const sel = $('#signal-select');
  sel.innerHTML = '';
  for (const [key, s] of Object.entries(state.agg.signals)) {
    const opt = document.createElement('wa-option');
    opt.value = key; opt.textContent = s.label;
    sel.appendChild(opt);
  }
  sel.value = state.signalKey;
  sel.addEventListener('change', async () => {
    state.signalKey = sel.value;
    state.points = null;
    buildFocusTabs();
    renderMethodology();
    applyWindow();
    await loadAndDrawPoints();
  });
}

// ───────────── Global time window ─────────────
function monthRangeLabel(lo, hi) {
  const n = hi - lo + 1;
  return `${prettyMonth(state.agg.months[lo])} – ${prettyMonth(state.agg.months[hi])} · ${n} month${n === 1 ? '' : 's'}`;
}

function buildTimeBar() {
  const total = state.agg.months.length;
  const hi = latestCompleteIdx();          // default window = last 6 complete months
  const lo = Math.max(0, hi - 5);
  state.lo = lo; state.hi = hi;

  const slider = $('#time-range');
  slider.min = 0; slider.max = total - 1;
  slider.minValue = lo; slider.maxValue = hi;
  slider.addEventListener('input', () => {
    if (state._applying) return;
    stopPlay();
    setWindow(Math.round(slider.minValue), Math.round(slider.maxValue));
  });

  $('#play-btn').addEventListener('click', togglePlay);
}

/** Single source of truth: set the window, sync the slider, re-render everything. */
function setWindow(lo, hi) {
  lo = Math.max(0, Math.min(lo, lastIdx()));
  hi = Math.max(lo, Math.min(hi, lastIdx()));
  state.lo = lo; state.hi = hi;
  const slider = $('#time-range');
  state._applying = true;
  slider.minValue = lo; slider.maxValue = hi;
  state._applying = false;
  applyWindow();
}

function applyWindow() {
  $('#time-readout').textContent = monthRangeLabel(state.lo, state.hi);
  renderCards();
  renderChartView();
  drawMap();
}

// ───────────── Play ─────────────
function togglePlay() { state.playing ? stopPlay() : startPlay(); }

function startPlay() {
  state.playing = true;
  $('#play-btn').setAttribute('aria-pressed', 'true');
  $('#play-icon').setAttribute('name', 'pause');
  $('#play-label').textContent = 'Pause';
  const width = state.hi - state.lo;
  state.timer = setInterval(() => {
    let lo = state.lo + 1, hi = state.hi + 1;
    if (hi > lastIdx()) { lo = 0; hi = width; }   // loop back to the start
    setWindow(lo, hi);
  }, PLAY_MS);
}

function stopPlay() {
  if (!state.playing) return;
  state.playing = false;
  clearInterval(state.timer); state.timer = null;
  $('#play-btn').setAttribute('aria-pressed', 'false');
  $('#play-icon').setAttribute('name', 'play');
  $('#play-label').textContent = 'Play';
}

// ───────────── Rollup cards (window-driven) ─────────────
function renderCards() {
  const host = $('#cards');
  host.innerHTML = '';
  $('#rollup-month').textContent = `· ${monthRangeLabel(state.lo, state.hi)}`;
  const { lo, hi } = state;

  for (const name of [...state.agg.districts, 'Citywide']) {
    const series = sig().series[name];
    const y = windowYoY(series, lo, hi);
    const card = el('div', `card${name === 'Citywide' ? ' card--citywide' : ''}`);
    card.style.setProperty('--accent', DISTRICT_ACCENT[name]);
    card.appendChild(el('div', 'card__name', name));
    card.appendChild(el('div', 'card__value', `${y.cur.toLocaleString()} <small>reports</small>`));

    if (y.prior != null) {
      const row = el('div', 'card__row');
      row.innerHTML = `<span class="card__delta ${deltaClass(y.pct)}">${fmtPct(y.pct)}</span><span>vs a year earlier</span>`;
      card.appendChild(row);
    }
    if (name !== 'Citywide') {
      const sh = windowShare(series, citywideSeries(), lo, hi);
      if (sh != null) card.appendChild(el('div', 'card__sub', `${(sh * 100).toFixed(0)}% of citywide`));
    }
    host.appendChild(card);
  }
}

// ───────────── Focus tabs + overlay toggles ─────────────
function buildFocusTabs() {
  const host = $('#focus-tabs');
  host.innerHTML = '';
  for (const name of ['Citywide', ...state.agg.districts]) {
    const b = el('button', 'tab', name);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(name === state.focus));
    b.style.setProperty('--accent', DISTRICT_ACCENT[name]);
    b.addEventListener('click', () => { state.focus = name; buildFocusTabs(); renderChartView(); });
    host.appendChild(b);
  }
}

function renderOverlayToggles() {
  const host = $('#chart-overlays');
  const opts = [
    { key: 'trend', label: '12-mo average', color: 'var(--c-ink)', dash: 'solid' },
    { key: 'priorYear', label: 'Prior year', color: '#0d9488', dash: 'dashed' },
  ];
  if (state.focus !== 'Citywide') opts.push({ key: 'citywide', label: 'Citywide (scaled)', color: '#db2777', dash: 'dotted' });
  host.innerHTML = '';
  for (const o of opts) {
    const lab = el('label');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!state.overlays[o.key];
    cb.addEventListener('change', () => { state.overlays[o.key] = cb.checked; renderChartView(); });
    const sw = el('span', 'swatch');
    sw.style.borderTopColor = o.color; sw.style.borderTopStyle = o.dash;
    lab.append(cb, sw, document.createTextNode(o.label));
    host.appendChild(lab);
  }
}

// ───────────── Chart ─────────────
function renderChartView() {
  renderOverlayToggles();
  const months = state.agg.months;
  const values = focusSeries();
  const partialIdx = monthIndex(state.agg, state.agg.current_partial_month);

  const overlays = {};
  if (state.overlays.trend) overlays.trend = trailing12Line(values);
  if (state.overlays.priorYear) overlays.priorYear = priorYearLine(values);
  if (state.focus !== 'Citywide' && state.overlays.citywide) {
    const city = citywideSeries();
    const cityMax = Math.max(...city), focusMax = Math.max(...values);
    const k = cityMax ? focusMax / cityMax : 1;
    overlays.citywideScaled = city.map(v => v * k);
  }

  $('#chart-title').textContent = `${sig().label} — ${state.focus}`;
  renderChart($('#chart-host'), {
    months, values, partialIdx, overlays,
    breaks: sig().breaks || [],
    window: { lo: state.lo, hi: state.hi },
    noun: 'report',
  });

  const note = [`Shaded band = the active time window (cards & map summarise it). Bars outside it are dimmed.`];
  if (state.overlays.citywide && state.focus !== 'Citywide') note.push('Citywide line is scaled to this district’s axis to compare shape, not level.');
  const brk = (sig().breaks || [])[0];
  if (brk) note.push(`Amber marker (${prettyMonth(brk.month)}): ${brk.label}.`);
  $('#chart-note').textContent = note.join(' ');
}

// ───────────── Map ─────────────
async function initMap() {
  const geo = await fetch('./data/police_districts.geojson').then(r => r.json());
  M.drawBoundaries($('#map'), geo);
  buildMapModes();
  await loadAndDrawPoints();
}

function buildMapModes() {
  const host = $('#map-modes');
  host.innerHTML = '';
  for (const [m, label] of [['heat', 'Heatmap'], ['dots', 'Individual reports']]) {
    const b = el('button', 'tab', label);
    b.setAttribute('aria-selected', String(m === state.mapMode));
    b.addEventListener('click', () => { state.mapMode = m; M.setMode(m); buildMapModes(); drawMap(); });
    host.appendChild(b);
  }
}

function monthToDayBounds(monthIdx, end) {
  const epoch = new Date(state.agg.epoch + 'T00:00:00');
  const [y, m] = state.agg.months[monthIdx].split('-').map(Number);
  const d = end ? new Date(y, m, 0) : new Date(y, m - 1, 1);
  return Math.round((d - epoch) / 86400000);
}

async function loadAndDrawPoints() {
  try {
    state.points = await loadPoints(state.signalKey, state.agg.epoch);
    drawMap();
  } catch (e) {
    console.error(e);
    $('#map-note').textContent = `Could not load map points: ${e.message}`;
  }
}

function drawMap() {
  if (!state.points) return;
  const from = monthToDayBounds(state.lo, false);
  const to = monthToDayBounds(state.hi, true);
  const res = M.renderPoints(state.points, from, to);
  if (!res) return;
  if (state.mapMode === 'dots' && res.shown < res.total) {
    $('#map-note').textContent = `Showing ${res.shown.toLocaleString()} of ${res.total.toLocaleString()} reports in range (sampled to stay responsive). Switch to Heatmap to see all.`;
  } else {
    $('#map-note').textContent = state.mapMode === 'heat'
      ? `Heatmap of ${res.total.toLocaleString()} reports in the window. Switch to Individual reports to read each one.`
      : `${res.total.toLocaleString()} reports in the window. Click a dot for the date.`;
  }
}

// ───────────── Methodology ─────────────
function renderMethodology() {
  const s = sig();
  const brk = (s.breaks || [])[0];
  const body = $('#methodology-body');
  body.innerHTML = '';
  const wrap = el('div', 'method-body');
  wrap.appendChild(el('p', null,
    `<strong>${s.label}.</strong> Community-reported reports assigned to a police district by ` +
    `point-in-polygon against the SFPD district boundaries, then rolled up to monthly counts per district ` +
    `and citywide. A small share of reports with imprecise coordinates fall outside every district ` +
    `boundary, so the per-district counts won't sum exactly to the citywide total. ` +
    `Full history from 2023; the current month is partial and shown faintly.`));
  if (s.caveat) wrap.appendChild(el('div', 'method-warn', `<strong>Read with care:</strong> ${s.caveat}`));
  if (brk) wrap.appendChild(el('div', 'method-warn', `<strong>Reporting change, ${prettyMonth(brk.month)}:</strong> ${brk.detail}`));
  wrap.appendChild(el('p', 'repro-note',
    `Headline cards total the reports in the selected time window and compare to the same window a year ` +
    `earlier (same season). Observational, not causal — counts reflect reporting behavior as well as ` +
    `conditions on the ground.`));
  body.appendChild(wrap);
}

init();
