// ──────────────────────────────────────────────────────────────────────
// Orchestration: inputs → live query → analysis → render.
// The data point (drug / overflowing cans / dumping / health-hazard) is
// chosen from the "What do you expect to change?" dropdown and drives the
// whole query. The date-range slider window is the analysis window (D12):
// verdict + stats + chart + map all reflect it, before/after split at the date.
// ──────────────────────────────────────────────────────────────────────

import { DATAPOINTS, LEVERS } from './datapoints.js';
import { fetchEvents, datasetLabel, ROW_CAP } from './soda.js';
import { bucketSeries, chooseGranularity, analyzeWindow, detectWindowStart, addDays, daysBetween } from './analyze.js';
import { renderChart } from './chart.js';
import { initPicker, renderEvents } from './map.js';
import { createFullIntervention, updateIntervention, getIntervention } from '../../js/interventions-client.js';

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
let locSet = false;      // true once the user drops a pin (or an edited record supplies coords)
let radiusM = 250;       // adjustable via the radius slider
let hasRun = false;
let dateISO = DEFAULT_DATE;
let dps = [DATAPOINTS[0]];   // selected data points (one panel each)
let panelData = [];          // per-lever: { dp, color, events, queries }
let runSeq = 0;         // guards against overlapping fetches (latest wins)

// Categorical palette indexed by selection order — reused for each lever's
// panel swatch, its map dots, and the legend so a lever reads the same everywhere.
const LEVER_COLORS = ['#3b82f6', '#f97316', '#a855f7', '#22c55e', '#ef4444', '#0ea5e9', '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e', '#84cc16'];

// Strict key → data point (no drug fallback); used when resolving levers from
// the dropdown, a shared link, or an edited record.
const resolveKey = k => DATAPOINTS.find(d => d.key === k) || null;
// The currently-selected data points, de-duped and order-preserving; never empty.
function selectedDps() {
  const seen = new Set();
  const out = [];
  for (const k of getSelectedLevers()) {
    const d = resolveKey(k);
    if (d && !seen.has(d.key)) { seen.add(d.key); out.push(d); }
  }
  return out.length ? out : [DATAPOINTS[0]];
}
let picker = null;
let urlWindow = null;   // {start,end} parsed from a shared link; overrides smart-default once
let curStart = null;    // current analysis window (ISO), tracked for the shareable URL
let curEnd = null;

// Edit mode: if URL has ?edit=ID, we load that intervention and update instead of create
let editId = null;
let editRecord = null;

async function init() {
  await customElements.whenDefined('wa-input');
  await customElements.whenDefined('wa-select');
  await customElements.whenDefined('wa-textarea');

  // Check for edit mode first
  const urlParams = new URLSearchParams(location.search);
  editId = urlParams.get('edit');

  const shared = readParams(); // a shared link overrides the defaults above

  // populate the data-point dropdown from the registry (now with all levers)
  const sel = $('in-expect');
  const leverOptions = LEVERS || DATAPOINTS;
  sel.innerHTML = leverOptions.map(d => `<wa-option value="${d.key}">${d.label}</wa-option>`).join('');
  if (!editId) sel.value = dps.map(d => d.key); // multi-select: array of keys
  setDescription();
  sel.addEventListener('change', () => {
    dps = selectedDps();
    setDescription();
    syncURL();
    if (hasRun) run(); // selection changed → refetch every selected lever
  });

  $('in-when').value = dateISO;
  $('in-when').addEventListener('input', () => { dateISO = $('in-when').value || DEFAULT_DATE; syncURL(); });
  $('in-what').addEventListener('input', syncURL);
  updateReadout();
  picker = initPicker($('picker-map'), loc, p => {
    loc = p;
    locSet = true;
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

  // Main button: submit or update
  $('run-btn').addEventListener('click', handleSubmit);
  $('copy-link-btn')?.addEventListener('click', copyShareLink);

  // Keep the clickable links preview in sync as the user edits the field
  $('in-links')?.addEventListener('input', () => renderLinksPreview());

  // Load existing record if in edit mode
  if (editId) {
    await loadEditRecord();
  } else if (shared) {
    run(true); // a shared link auto-runs AND scrolls to the results
  }
}

async function loadEditRecord() {
  try {
    editRecord = await getIntervention(editId);
    if (!editRecord) throw new Error('Not found');

    // Update page title
    $('page-title').textContent = 'Edit intervention';
    $('page-sub').textContent = 'Update this intervention and track its impact.';
    $('form-title').textContent = 'Edit intervention';
    $('submit-label').textContent = 'Update intervention';

    // Populate form fields
    $('in-what').value = editRecord.intervention || editRecord.what || '';
    $('in-description').value = editRecord.description || '';
    $('in-evidence').value = editRecord.evidence || '';
    $('in-tactics').value = editRecord.tactics || '';
    $('in-owner').value = editRecord.owner || '';
    $('in-agencies').value = editRecord.agencies || '';
    $('in-status').value = editRecord.status || 'open_in_progress';
    $('in-district').value = editRecord.district || 'Central';
    $('in-when').value = editRecord.start_date || editRecord.date || '';
    $('in-roadblock').value = editRecord.roadblock || '';
    $('in-outcomes').value = editRecord.outcomes || '';
    $('in-notes').value = editRecord.notes || '';
    $('in-links').value = (editRecord.links || []).join('\n');
    renderLinksPreview(editRecord.links);
    $('in-submitter').value = editRecord.person_submitted || '';

    // Set levers (multi-select) and drive the analysis from them (not the drug default).
    if (editRecord.levers?.length) {
      $('in-expect').value = editRecord.levers;
    } else if (editRecord.dp) {
      $('in-expect').value = [editRecord.dp];
    }
    dps = selectedDps();
    setDescription();

    // Set location
    if (editRecord.lat && editRecord.lng) {
      loc = { lat: editRecord.lat, lng: editRecord.lng };
      locSet = true;
      picker?.setLocation(loc);
    }
    if (editRecord.radius) {
      radiusM = editRecord.radius;
      $('radius-slider').value = radiusM;
      picker?.setRadius(radiusM);
    }

    updateReadout();
    dateISO = editRecord.start_date || editRecord.date || DEFAULT_DATE;

    // Auto-run the analysis
    run(false);
  } catch (e) {
    console.error('Failed to load intervention:', e);
    alert('Could not load intervention for editing.');
  }
}

async function handleSubmit() {
  // Validate required fields
  const title = ($('in-what').value || '').trim();
  const submitter = ($('in-submitter').value || '').trim();
  const district = $('in-district').value;

  if (!title) {
    alert('Please enter an intervention title.');
    $('in-what').focus();
    return;
  }
  if (!submitter) {
    alert('Please enter your name.');
    $('in-submitter').focus();
    return;
  }

  // Gather form data
  const data = {
    intervention: title,
    description: ($('in-description').value || '').trim(),
    evidence: ($('in-evidence').value || '').trim(),
    tactics: ($('in-tactics').value || '').trim(),
    owner: ($('in-owner').value || '').trim(),
    agencies: ($('in-agencies').value || '').trim(),
    levers: getSelectedLevers(),
    status: $('in-status').value || 'open_in_progress',
    district,
    start_date: $('in-when').value || todayISO(),
    roadblock: ($('in-roadblock').value || '').trim(),
    outcomes: ($('in-outcomes').value || '').trim(),
    notes: ($('in-notes').value || '').trim(),
    links: parseLinks($('in-links').value),
    person_submitted: submitter,
    // Only send coordinates when a pin was actually placed — otherwise an edit would silently
    // overwrite a record's stored location with the default Koshland pin.
    ...(locSet ? { lat: loc.lat, lng: loc.lng } : {}),
    radius: radiusM,
  };

  const btn = $('run-btn');
  btn.loading = true;
  btn.disabled = true;

  try {
    if (editId) {
      data.edited_by = submitter;
      await updateIntervention(editId, data);
      alert('Intervention updated successfully!');
    } else {
      await createFullIntervention(data);
      alert('Intervention submitted successfully!');
      // Redirect to homepage after creating
      window.location.href = '../';
    }
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.loading = false;
    btn.disabled = false;
    $('submit-label').textContent = editId ? 'Update intervention' : 'Submit intervention';
  }
}

function getSelectedLevers() {
  const sel = $('in-expect');
  if (!sel.value) return [];
  return Array.isArray(sel.value) ? sel.value : [sel.value];
}

// Parse the "Related documents" textarea (one URL per line) into a clean array of links.
// Bare hostnames get an https:// prefix; blanks are dropped; capped at 20.
function parseLinks(text) {
  return (text || '')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(u => /^https?:\/\//i.test(u) ? u : `https://${u}`)
    .slice(0, 20);
}

// Render the current links as clickable items under the textarea. Pass an explicit array (on edit
// load) or omit it to derive from the field's current text (live while typing).
function renderLinksPreview(links) {
  const el = $('links-preview');
  if (!el) return;
  const list = Array.isArray(links) ? links : parseLinks($('in-links').value);
  el.innerHTML = list.map(u => {
    const href = encodeURI(u).replace(/"/g, '%22');
    return `<a class="link-chip" href="${href}" target="_blank" rel="noopener">${escHtml(u)}</a>`;
  }).join('');
}

// ── Shareable URL: state ⇄ query params (live re-query, no backend) ──
// Params: dp, date, lat, lng, r, from, to, what. Plain & readable; the data
// itself is never stored — it's re-queried live from Socrata on open (D1).
function readParams() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return false;
  const k = p.get('dp');
  if (k) {
    const picked = k.split(',').map(s => resolveKey(s.trim())).filter(Boolean);
    if (picked.length) dps = picked;
  }
  const lat = parseFloat(p.get('lat')), lng = parseFloat(p.get('lng'));
  if (isFinite(lat) && isFinite(lng)) loc = { lat, lng };
  const r = parseInt(p.get('r'), 10);
  if (isFinite(r)) radiusM = Math.min(1000, Math.max(10, Math.round(r / 10) * 10));
  const d = p.get('date'); if (d) dateISO = d;
  const from = p.get('from'), to = p.get('to');
  if (from && to) urlWindow = { start: from, end: to };
  const what = p.get('what'); if (what) $('in-what').value = what;
  $('radius-slider') && ($('radius-slider').value = radiusM);
  return true;
}

function syncURL() {
  const p = new URLSearchParams();
  if (editId) p.set('edit', editId);   // keep edit mode across reloads / the auto-run's syncURL
  p.set('dp', dps.map(d => d.key).join(','));
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
  const desc = dps.length === 1
    ? (dps[0].description || '')
    : `${dps.length} outcomes selected — each is analyzed separately below.`;
  $('expect-desc').innerHTML = `${desc} <a class="method-jump" href="#methodology">How this is measured ↓</a>`;
  $('methodology-body').innerHTML = allMethodologyHtml(null);
}

// Intro paragraph for the methodology section (shown once).
function methodologyPre() {
  return `<p class="method-pre">Every figure on this page comes from a live query to SF OpenData (Socrata), ` +
    `restricted to within <strong>${radiusM} m</strong> of the pin and to reports since <strong>Jan 1, 2023</strong>. ` +
    `Open a query link to inspect the raw records.</p>`;
}

// Per-source filtering description + exact live query for one data point.
function methodologySources(d, queries) {
  return sourcesOf(d).map((src, i) => {
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
}

// "How this is measured" for every selected lever. `queriesByKey` maps a
// data-point key → its live queries (null before a run, so links show pending).
function allMethodologyHtml(queriesByKey) {
  return methodologyPre() + dps.map(d =>
    `<div class="method-lever"><h3 class="method-lever__title">${escHtml(d.title || d.label)}</h3>` +
    `${methodologySources(d, queriesByKey && queriesByKey[d.key])}</div>`
  ).join('');
}

// Build the empty per-lever panel skeletons (verdict + stat cards + chart host).
// renderAllWindows() fills them; hosts are addressed by their data-* index.
function buildPanels() {
  $('panels').innerHTML = panelData.map((p, i) => `
    <article class="lever-panel" data-i="${i}">
      <header class="lever-panel__head">
        <span class="lever-swatch" style="background:${p.color}"></span>
        <h2 class="panel__title">${escHtml(p.dp.title || p.dp.label)} over time</h2>
      </header>
      <wa-callout class="lever-verdict" variant="neutral">
        <wa-icon slot="icon" name="wand-magic-sparkles"></wa-icon>
        <div class="verdict-body" data-verdict="${i}"></div>
      </wa-callout>
      <div class="wa-grid wa-gap-l stat-cards" data-stats="${i}" style="--min-column-size: 13rem;"></div>
      <wa-card class="panel"><div class="chart-host" data-chart="${i}"></div></wa-card>
    </article>`).join('');
}

async function run(scroll = false) {
  const myRun = ++runSeq;
  dateISO = $('in-when').value || DEFAULT_DATE;
  if (!dps.length) dps = [DATAPOINTS[0]];
  setStatus('Querying live SF OpenData…', 'loading');
  $('run-btn').loading = true;
  try {
    const opts = { lat: loc.lat, lng: loc.lng, radiusM: radiusM };
    const results = await Promise.all(dps.map(d => fetchEvents(d, opts)));
    if (myRun !== runSeq) return; // a newer run started — discard this stale result
    panelData = dps.map((d, i) => {
      const evs = results[i].events;
      // When a fetch hit the row cap, the oldest loaded day is the truncation
      // floor — data before it is missing. renderAllWindows warns if the window
      // starts earlier than this.
      const earliest = results[i].truncated
        ? evs.reduce((m, e) => (e.day && (!m || e.day < m)) ? e.day : m, null)
        : null;
      return {
        dp: d,
        color: LEVER_COLORS[i % LEVER_COLORS.length],
        events: evs,
        queries: results[i].queries,
        truncated: results[i].truncated,
        earliest,
      };
    });
    const combined = panelData.flatMap(p => p.events); // default window spans all levers
    const now = todayISO();
    // A shared link carries its own window; otherwise use the smart default.
    const fromURL = urlWindow;
    const ws = fromURL || detectWindowStart(combined, dateISO, FULL_START);
    const winStart = ws.start;
    const winEnd = (fromURL && fromURL.end) || now;
    urlWindow = null; // consumed — later re-runs (e.g. radius change) recompute the default

    $('results').hidden = false;
    buildPanels();
    const qByKey = {};
    panelData.forEach(p => { qByKey[p.dp.key] = p.queries; });
    $('methodology-body').innerHTML = allMethodologyHtml(qByKey);
    $('chart-note').innerHTML = `Sources &amp; exact queries: <a href="#methodology">How this is measured ↓</a>`;

    await setupSlider(now, winStart, winEnd);
    renderAllWindows(winStart, winEnd, { updateMap: true, recenter: true });
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
      renderAllWindows(dayOf(slider.minValue), dayOf(slider.maxValue), { updateMap: false });
    });
    slider.addEventListener('change', () => {
      renderAllWindows(dayOf(slider.minValue), dayOf(slider.maxValue), { updateMap: true, recenter: false });
      syncURL(); // committed window → update the shareable link
    });
    slider._wired = true;
  }
}

// Render every lever panel (chart + verdict + stat cards) over the same window,
// then draw the one shared color-coded map from all panels' windowed events.
function renderAllWindows(startDay, endDay, { updateMap = true, recenter = false } = {}) {
  if (endDay <= startDay) endDay = addDays(startDay, 1);
  curStart = startDay; curEnd = endDay; // remember the window for the shareable URL
  const gran = chooseGranularity(startDay, endDay);
  const host = $('panels');

  panelData.forEach((p, i) => {
    const series = bucketSeries(p.events, startDay, endDay, gran);
    renderChart(host.querySelector(`[data-chart="${i}"]`), series,
      { interventionISO: dateISO, breaks: p.dp.breaks, noun: p.dp.noun, title: p.dp.title });
    // D12 — the slider window is the analysis window; verdict + stats recompute live.
    const w = analyzeWindow(p.events, dateISO, startDay, endDay);
    let vhtml = verdictHtml(w, p.dp);
    if (p.truncated && p.earliest && curStart < p.earliest) {
      vhtml += `<div class="verdict-warn">⚠ This lever hit the ${ROW_CAP.toLocaleString()}-record query cap, so only reports since <strong>${fmtNice(p.earliest)}</strong> are loaded at this radius. Earlier reports in the selected range are missing — narrow the radius or shorten the date range for a complete before/after.</div>`;
    }
    host.querySelector(`[data-verdict="${i}"]`).innerHTML = vhtml;
    host.querySelector(`[data-stats="${i}"]`).innerHTML = statCards(w, p.dp);
  });

  if (updateMap) {
    const groups = panelData.map(p => ({
      color: p.color,
      label: p.dp.title || p.dp.label,
      events: p.events.filter(e => e.day && e.day >= startDay && e.day <= endDay),
    }));
    renderEvents($('events-map'), loc, radiusM, groups, { recenter });
    $('map-legend').innerHTML = groups.map(g =>
      `<span class="map-legend__item"><span class="map-legend__dot" style="background:${g.color}"></span>${escHtml(g.label)}</span>`
    ).join('');
  }

  const granLabel = gran === 'day' ? 'daily' : gran === 'week' ? 'weekly' : 'monthly';
  $('range-readout').textContent = `${fmtNice(startDay)} – ${fmtNice(endDay)} · ${granLabel} bars`;
}

function verdictHtml(w, dp) {
  const pctValue = isFinite(w.pct) ? Math.abs(w.pct).toFixed(0) : null;
  const dirWord = w.direction === 'down' ? 'down' : w.direction === 'up' ? 'up' : 'unchanged';

  // Anchor the summary to the intervention date
  let html;
  if (pctValue !== null) {
    html = `Since this intervention was logged on <strong>${fmtNice(dateISO)}</strong>, ` +
      `${dp.noun || 'report'}s within ${radiusM} m are <strong>${dirWord} ${pctValue}%</strong> ` +
      `vs. the ${w.preDays} day${w.preDays === 1 ? '' : 's'} before it ` +
      `(${w.pre} → ${w.post}, or ≈${w.preRate.toFixed(1)} → ≈${w.postRate.toFixed(1)} per 30 days).`;
  } else {
    html = `Since this intervention was logged on <strong>${fmtNice(dateISO)}</strong>, ` +
      `there have been <strong>${w.post}</strong> ${dp.noun || 'report'}${w.post === 1 ? '' : 's'} ` +
      `within ${radiusM} m (vs. ${w.pre} in the ${w.preDays} days before).`;
  }

  html += `<div class="verdict-note">Observational data only — compare carefully with the timeline above.</div>`;

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
  // Settled-month caveat for datasets with report-approval lag (SFPD incidents).
  // Only relevant when the window's trailing edge reaches into the still-settling
  // recent months, which is exactly where a spurious "drop" would appear.
  if (dp.settle && daysBetween(addDays(todayISO(), -dp.settle.lagMonths * 31), curEnd) > 0) {
    html += `<div class="verdict-warn">⚠ ${dp.settle.note}</div>`;
  }
  return html;
}

function statCards(w, dp) {
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
