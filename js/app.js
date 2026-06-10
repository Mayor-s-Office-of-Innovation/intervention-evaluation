// ──────────────────────────────────────────────────────────────────────
// Orchestration: inputs → live query → analysis → render.
// The data point (drug / overflowing cans / dumping / health-hazard) is
// chosen from the "What do you expect to change?" dropdown and drives the
// whole query. The date-range slider window is the analysis window (D12):
// verdict + stats + chart + map all reflect it, before/after split at the date.
// ──────────────────────────────────────────────────────────────────────

import { DATAPOINTS, getDataPoint } from './datapoints.js';
import { fetchEvents, datasetLabel } from './soda.js';
import { bucketSeries, chooseGranularity, analyzeWindow, detectWindowStart, addDays, daysBetween } from './analyze.js';
import { renderChart } from './chart.js';
import { initPicker, renderEvents } from './map.js';

// Page & Buchanan — NE corner of Koshland Park (exact intersection point).
const KOSHLAND = { lat: 37.77346, lng: -122.42736 };
const DEFAULT_DATE = '2026-05-13';
const FULL_START = '2023-01-01';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const $ = id => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtNice = iso => { const [y, m, d] = iso.split('-'); return `${MONTHS[+m - 1]} ${+d}, ${y}`; };
const fmtMonthYear = ym => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };

let loc = { ...KOSHLAND };
let radiusM = 250;       // adjustable via the radius slider
let hasRun = false;
let allEvents = [];
let dateISO = DEFAULT_DATE;
let dp = DATAPOINTS[0]; // selected data point
let runSeq = 0;         // guards against overlapping fetches (latest wins)
let picker = null;
let urlWindow = null;   // {start,end} parsed from a shared link; overrides smart-default once
let curStart = null;    // current analysis window (ISO), tracked for the shareable URL
let curEnd = null;

async function init() {
  await customElements.whenDefined('wa-input');
  await customElements.whenDefined('wa-select');

  const shared = readParams(); // a shared link overrides the defaults above

  // populate the data-point dropdown from the registry
  const sel = $('in-expect');
  sel.innerHTML = DATAPOINTS.map(d => `<wa-option value="${d.key}">${d.label}</wa-option>`).join('');
  sel.value = dp.key;
  setDescription();
  sel.addEventListener('change', () => {
    dp = getDataPoint(sel.value);
    setDescription();
    syncURL();
    if (hasRun) run(); // data point changed → refetch
  });

  $('in-when').value = dateISO;
  $('in-when').addEventListener('input', () => { dateISO = $('in-when').value || DEFAULT_DATE; syncURL(); });
  $('in-what').addEventListener('input', syncURL);
  updateReadout();
  picker = initPicker($('picker-map'), loc, p => {
    loc = p;
    updateReadout();
    syncURL();
    if (hasRun) run();
  }, radiusM);

  // radius slider: live-update the circle + readout while dragging; refetch on release
  await customElements.whenDefined('wa-slider');
  const radiusSlider = $('radius-slider');
  radiusSlider.value = radiusM;
  const applyRadius = () => { radiusM = +radiusSlider.value; picker.setRadius(radiusM); updateReadout(); };
  radiusSlider.addEventListener('input', applyRadius);
  radiusSlider.addEventListener('change', () => { applyRadius(); syncURL(); if (hasRun) run(); });

  $('run-btn').addEventListener('click', () => run(true));
  $('copy-link-btn').addEventListener('click', copyShareLink);

  if (shared) run(true); // a shared link auto-runs AND scrolls to the results (copy button at top)
}

// ── Shareable URL: state ⇄ query params (live re-query, no backend) ──
// Params: dp, date, lat, lng, r, from, to, what. Plain & readable; the data
// itself is never stored — it's re-queried live from Socrata on open (D1).
function readParams() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return false;
  const k = p.get('dp'); if (k && getDataPoint(k)) dp = getDataPoint(k);
  const lat = parseFloat(p.get('lat')), lng = parseFloat(p.get('lng'));
  if (isFinite(lat) && isFinite(lng)) loc = { lat, lng };
  const r = parseInt(p.get('r'), 10);
  if (isFinite(r)) radiusM = Math.min(1000, Math.max(100, Math.round(r / 50) * 50));
  const d = p.get('date'); if (d) dateISO = d;
  const from = p.get('from'), to = p.get('to');
  if (from && to) urlWindow = { start: from, end: to };
  const what = p.get('what'); if (what) $('in-what').value = what;
  $('radius-slider') && ($('radius-slider').value = radiusM);
  return true;
}

function syncURL() {
  const p = new URLSearchParams();
  p.set('dp', dp.key);
  const when = $('in-when').value; if (when) p.set('date', when);
  p.set('lat', loc.lat.toFixed(5));
  p.set('lng', loc.lng.toFixed(5));
  p.set('r', radiusM);
  if (curStart && curEnd) { p.set('from', curStart); p.set('to', curEnd); }
  const what = ($('in-what').value || '').trim(); if (what) p.set('what', what);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

let copyResetTimer = null;
async function copyShareLink() {
  syncURL(); // make sure the URL reflects the latest state before copying
  const icon = $('copy-icon'), label = $('copy-label'), status = $('copy-status');
  try {
    await navigator.clipboard.writeText(location.href);
    // Transient confirmation on the button itself, then revert.
    icon.name = 'check';
    label.textContent = 'Copied!';
    status.textContent = '✓ Shareable link copied to clipboard.';
    status.classList.remove('copy-status--error');
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      icon.name = 'copy';
      label.textContent = 'Copy shareable link';
      status.textContent = '';
    }, 2500);
  } catch {
    // Clipboard blocked (e.g. insecure context) — show the URL to copy manually.
    status.textContent = location.href;
    status.classList.add('copy-status--error');
  }
}

function updateReadout() {
  $('coords-readout').textContent = `Pin: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)} · ${radiusM} m radius`;
}

const sourcesOf = d => d.sources || [d];
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Sets the dropdown description (with a jump link) and refreshes the
// methodology section's static content (live query links fill in on run).
function setDescription() {
  $('expect-desc').innerHTML = `${dp.description} <a class="method-jump" href="#methodology">How this is measured ↓</a>`;
  $('methodology-body').innerHTML = methodologyHtml(dp, null);
}

// "How this is measured" — per-source filtering description + exact live query.
function methodologyHtml(d, queries) {
  const pre = `<p class="method-pre">Every figure on this page comes from a live query to SF OpenData (Socrata), ` +
    `restricted to within <strong>${radiusM} m</strong> of the pin and to reports since <strong>Jan 1, 2023</strong>. ` +
    `Open a query link to inspect the raw records.</p>`;
  const blocks = sourcesOf(d).map((src, i) => {
    const q = queries && queries[i];
    const link = q
      ? `<a href="${q.url}" target="_blank" rel="noopener">▶ Open this exact query on data.sfgov.org</a>`
      : `<span class="method-pending">Run the analysis to generate the live query link.</span>`;
    return `<div class="method-src">
      <div class="method-src__head">${datasetLabel(src.dataset)} <a class="method-ds" href="https://data.sfgov.org/d/${src.dataset}" target="_blank" rel="noopener">${src.dataset}</a></div>
      <p class="method-src__desc">${src.filterDesc || ''}</p>
      <code class="method-src__filter">${escHtml(src.signalWhere || '')}</code>
      <p class="method-src__link">${link}</p>
    </div>`;
  }).join('');
  return pre + blocks;
}

async function run(scroll = false) {
  const myRun = ++runSeq;
  dateISO = $('in-when').value || DEFAULT_DATE;
  setStatus('Querying live SF OpenData…', 'loading');
  $('run-btn').loading = true;
  try {
    const { events, queries } = await fetchEvents(dp, { lat: loc.lat, lng: loc.lng, radiusM: radiusM });
    if (myRun !== runSeq) return; // a newer run started — discard this stale result
    allEvents = events;
    const now = todayISO();
    // A shared link carries its own window; otherwise use the smart default.
    const fromURL = urlWindow;
    const ws = fromURL || detectWindowStart(allEvents, dateISO, FULL_START);
    const winStart = ws.start;
    const winEnd = (fromURL && fromURL.end) || now;
    urlWindow = null; // consumed — later re-runs (e.g. radius change) recompute the default

    $('results').hidden = false;
    $('chart-title').textContent = `${dp.title} over time`;
    $('methodology-body').innerHTML = methodologyHtml(dp, queries);
    $('chart-note').innerHTML = `Sources &amp; exact queries: <a href="#methodology">How this is measured ↓</a>`;

    await setupSlider(now, winStart, winEnd);
    renderWindow(winStart, winEnd, { updateMap: true, recenter: true });
    $('range-suggest').textContent = fromURL
      ? `Showing the shared report’s saved date range. Drag the handles to change.`
      : ws.method === 'regime'
        ? `Default range starts at the detected rise in activity (~${fmtMonthYear(ws.onsetMonth)}) so the before/after isn't diluted by quiet history. Drag the handles to change.`
        : `Default range = recent window (signal too sparse to detect a clear spike). Drag the handles to change.`;

    hasRun = true;
    clearStatus();
    syncURL();
    if (scroll) $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (myRun === runSeq) setStatus(`Couldn't load data: ${err.message}`, 'error');
  } finally {
    if (myRun === runSeq) $('run-btn').loading = false;
  }
}

// ── date-range slider (dual-thumb) over day indices from FULL_START ──
async function setupSlider(nowISO, startDay, endDay = nowISO) {
  await customElements.whenDefined('wa-slider');
  const slider = $('range-slider');
  const totalDays = daysBetween(FULL_START, nowISO);
  const dayOf = idx => addDays(FULL_START, Math.round(idx));
  const clamp = iso => Math.max(0, Math.min(totalDays, daysBetween(FULL_START, iso)));

  slider.min = 0;
  slider.max = totalDays;
  slider.minValue = clamp(startDay);
  slider.maxValue = clamp(endDay);
  slider.valueFormatter = idx => fmtNice(dayOf(idx));

  if (!slider._wired) {
    slider.addEventListener('input', () => {
      renderWindow(dayOf(slider.minValue), dayOf(slider.maxValue), { updateMap: false });
    });
    slider.addEventListener('change', () => {
      renderWindow(dayOf(slider.minValue), dayOf(slider.maxValue), { updateMap: true, recenter: false });
      syncURL(); // committed window → update the shareable link
    });
    slider._wired = true;
  }
}

function renderWindow(startDay, endDay, { updateMap = true, recenter = false } = {}) {
  if (endDay <= startDay) endDay = addDays(startDay, 1);
  curStart = startDay; curEnd = endDay; // remember the window for the shareable URL
  const gran = chooseGranularity(startDay, endDay);
  const series = bucketSeries(allEvents, startDay, endDay, gran);
  renderChart($('chart-host'), series, { interventionISO: dateISO, breaks: dp.breaks });

  // D12 — the slider window is the analysis window; verdict + stats recompute live.
  const w = analyzeWindow(allEvents, dateISO, startDay, endDay);
  $('verdict-body').innerHTML = verdictHtml(w);
  $('stat-cards').innerHTML = statCards(w);

  const windowed = allEvents.filter(e => e.day && e.day >= startDay && e.day <= endDay);
  if (updateMap) renderEvents($('events-map'), loc, radiusM, windowed, { recenter });

  const granLabel = gran === 'day' ? 'daily' : gran === 'week' ? 'weekly' : 'monthly';
  $('range-readout').textContent = `${fmtNice(startDay)} – ${fmtNice(endDay)} · ${granLabel} bars`;
}

function verdictHtml(w) {
  const arrow = w.direction === 'down' ? '▼' : w.direction === 'up' ? '▲' : '▬';
  const pct = isFinite(w.pct) ? `${arrow} ${Math.abs(w.pct).toFixed(0)}%` : '—';
  const plural = n => `${dp.noun}${n === 1 ? '' : 's'}`;
  let html =
    `<strong>${w.pre}</strong> ${plural(w.pre)} in the ${w.preDays} day${w.preDays === 1 ? '' : 's'} before → ` +
    `<strong>${w.post}</strong> in the ${w.postDays} day${w.postDays === 1 ? '' : 's'} after ` +
    `(≈${w.preRate.toFixed(1)} → ≈${w.postRate.toFixed(1)} per 30 days, ${pct}).`;
  html += `<div class="verdict-note">Preliminary, descriptive only — a plain-language AI verdict will land here in a later version.</div>`;
  if (!w.interventionInWindow) {
    html += `<div class="verdict-warn">⚠ The intervention date (${fmtNice(dateISO)}) is outside the selected range — widen the date slider to span it for a before/after comparison.</div>`;
  } else if (w.shortWindow) {
    html += `<div class="verdict-warn">⚠ Short post-intervention window (${w.postDays} days). Too little data yet for a confident before/after read — interpret with caution.</div>`;
  }
  // Known reporting breaks (e.g. a sensor feed ending) — warn only when the analysis
  // window spans the break, since that's exactly when before/after isn't comparable.
  for (const b of (dp.breaks || [])) {
    if (curStart < b.date && b.date < curEnd) {
      html += `<div class="verdict-warn">⚠ This window crosses a known reporting change (${fmtNice(b.date)}): ${b.detail}</div>`;
    }
  }
  return html;
}

function statCards(w) {
  const pctLabel = isFinite(w.pct) ? `${w.pct > 0 ? '+' : ''}${w.pct.toFixed(0)}%` : '—';
  const dirSub = w.direction === 'down' ? 'fewer per day' : w.direction === 'up' ? 'more per day' : 'no change';
  const cards = [
    [`Before · ${w.preDays} days`, w.pre, `≈${w.preRate.toFixed(1)} / 30 days`],
    [`After · ${w.postDays} days`, w.post, `≈${w.postRate.toFixed(1)} / 30 days`],
    ['Rate change', pctLabel, dirSub],
    ['In view', w.total, `${dp.noun}s in selected range`],
  ];
  return cards
    .map(([l, v, s]) => `<div class="stat"><span class="stat__label">${l}</span><span class="stat__value">${v}</span><span class="stat__sub">${s}</span></div>`)
    .join('');
}

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status status--${kind}`;
  el.hidden = false;
}
function clearStatus() { $('status').hidden = true; }

init();
