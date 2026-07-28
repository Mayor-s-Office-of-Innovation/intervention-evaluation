import { parseTSV, groupBy } from './tsv.js';
import { listInterventions, closeIntervention, reopenIntervention, updateIntervention } from './interventions-client.js';
import { LEVERS } from '../hypothesis/js/datapoints.js';

const DISTRICTS = ['Northern', 'Central', 'Mission', 'Tenderloin'];

// Base OKR definitions (shared across districts)
const OKR_DEFS = {
  drug: {
    id: 'drug',
    title: 'Reduce visible disorder: Drugs',
    href: './drug/',
    eyebrow: 'Drug activity',
    dataPath: './drug/data/aggregates.json',
    krs: [
      { signal: 'cfs_drug', label: '911 drug complaints', goal: 'down' },
      { signal: 'dealer_arrests', label: 'Dealer arrests', goal: 'up' },
    ]
  },
  unhoused: {
    id: 'unhoused',
    title: 'Reduce unsheltered homelessness',
    href: './unhoused/',
    eyebrow: 'Unhoused presence',
    dataPath: './unhoused/data/aggregates.json',
    krs: [
      { signal: 'encampment', label: 'Encampment reports', goal: 'down' },
      { signal: 'cfs_homeless', label: '911 unhoused calls', goal: 'down' },
    ]
  },
  theft: {
    id: 'theft',
    title: 'Reduce property & street crime',
    href: './theft/',
    eyebrow: 'Property & street crime',
    dataPath: './theft/data/aggregates.json',
    krs: [
      { signal: 'shoplifting', label: 'Shoplifting', goal: 'down' },
      { signal: 'commercial', label: 'Commercial burglary & robbery', goal: 'down' },
    ]
  },
};

// District-specific KR #3 for property & street crime
// Each district tracks shoplifting + commercial (shared) plus one emerging local issue
const DISTRICT_KR3 = {
  Northern: { signal: 'fraud', label: 'Fraud reports', goal: 'down' },
  Central: { signal: 'dog_bites', label: 'Dog bites', goal: 'down' },
  Mission: { signal: 'street_robbery', label: 'Street robbery', goal: 'down' },
  Tenderloin: { signal: 'dog_bites', label: 'Dog bites', goal: 'down' },
};

// Build district-specific OKRs
function getOKRsForDistrict(district) {
  const kr3 = DISTRICT_KR3[district];
  return [
    OKR_DEFS.drug,
    OKR_DEFS.unhoused,
    {
      ...OKR_DEFS.theft,
      krs: [
        ...OKR_DEFS.theft.krs,
        kr3,
      ]
    },
  ];
}

const STATUS_LABELS = {
  active: 'Active',
  completed: 'Completed',
  planned: 'Planned',
  open_in_progress: 'Open · In progress',
  closed_completed: 'Closed · Completed',
  at_risk_on_hold: 'At risk · On hold',
};
const WORKING_LABELS = { yes: 'Working', no: 'Not working', inconclusive: 'Inconclusive' };

// Map KR labels to their parent OKR for color-coding
const KR_TO_OKR = {
  '911 drug complaints': 'drug',
  'Dealer arrests': 'drug',
  'Encampment reports': 'unhoused',
  '911 unhoused calls': 'unhoused',
  'Shoplifting': 'theft',
  'Commercial burglary & robbery': 'theft',
  'Fraud reports': 'theft',
  'Dog bites': 'theft',
  'Street robbery': 'theft',
};

// Socrata queries for district-specific emerging signals (fetched live)
const EMERGING_SIGNALS = {
  fraud: {
    where: "incident_category = 'Fraud'",
  },
  dog_bites: {
    where: "incident_description = 'Dog, Bite or Attack'",
  },
  street_robbery: {
    where: "incident_subcategory = 'Robbery - Street'",
  },
};

let currentDistrict = DISTRICTS[0];
let editingId = null;             // id of the row being edited inline (only one at a time)
let interventionsByDistrict = {};
let aggregatesData = {};
let emergingSignalsCache = {};
let savedInterventions = [];   // saved hypotheses fetched live from the Worker (see loadSaved)

function initDistrict() {
  const h = (location.hash || '').replace('#', '').toLowerCase();
  const match = DISTRICTS.find(d => d.toLowerCase() === h);
  if (match) currentDistrict = match;
}

function syncUrlHash() {
  const hash = '#' + currentDistrict.toLowerCase();
  if (location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sumLast(arr, n) {
  if (!arr || arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0);
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// Find the week index whose Monday-start date is closest to (isoWeek + dayOffset days). Used to pair a
// week with its ~52-week-prior partner via a −364-day lookup — date-based so it survives 53-week ISO
// years where a fixed idx−52 would mis-pair. −364 is a multiple of 7, so on a contiguous axis it lands
// exactly on a prior Monday.
function nearestWeekIndex(weeks, isoWeek, dayOffset) {
  if (!weeks || !weeks.length) return -1;
  const target = new Date(isoWeek + 'T00:00:00Z');
  target.setUTCDate(target.getUTCDate() + dayOffset);
  const t = target.getTime();
  let best = -1, bestDiff = Infinity;
  for (let i = 0; i < weeks.length; i++) {
    const diff = Math.abs(new Date(weeks[i] + 'T00:00:00Z').getTime() - t);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best;
}

function getKRData(okrId, kr, district) {
  // Check if this is an emerging signal (fetched from Socrata)
  if (EMERGING_SIGNALS[kr.signal]) {
    const cached = emergingSignalsCache[`${kr.signal}_${district}`];
    if (!cached) return null;
    return { change1mo: cached.change1mo, change3mo: cached.change3mo, change2wk: cached.change2wk ?? null, goal: kr.goal };
  }

  const data = aggregatesData[okrId];
  if (!data) return null;

  const signal = data.signals?.[kr.signal];
  if (!signal) return null;

  // Handle different data structures:
  // - drug/unhoused: signal.series[district] is an array
  // - theft: signal.series[district].reported is an array
  let series = signal.series?.[district];
  if (series && typeof series === 'object' && !Array.isArray(series)) {
    series = series.reported;
  }
  if (!series) {
    const districtKey = district.toLowerCase();
    series = signal[districtKey]?.reported;
  }

  if (!series || series.length < 13) return null;

  // Per-signal settle: drug bakes an explicit `settles` per signal (community-911 is creation-stamped
  // even though the dashboard also carries laggy arrest signals); theft/unhoused don't, so fall back to
  // whether the dashboard has a settled-month pointer at all (theft yes, unhoused no).
  const settles = signal.settles ?? (data.latest_settled_month != null);

  // Anchor every chip to the latest SETTLED month for laggy signals (theft ~2mo, drug arrests ~1mo),
  // else the latest complete month. endIdx is the count up to & including the anchor month.
  const anchorMonth = (settles && data.latest_settled_month) || data.latest_complete_month || data.current_partial_month;
  const mi = data.months ? data.months.indexOf(anchorMonth) : -1;
  const endIdx = mi >= 0 ? mi + 1 : (data.current_partial_month != null ? series.length - 1 : series.length);

  // 1-month change: compare last settled month vs same month last year
  const last1 = series[endIdx - 1];
  const prior1 = series[endIdx - 13];
  const change1mo = pctChange(last1, prior1);

  // 3-month change: compare last 3 months vs same 3 months last year
  const last3 = sumLast(series.slice(0, endIdx), 3);
  const prior3 = sumLast(series.slice(0, endIdx - 12), 3);
  const change3mo = pctChange(last3, prior3);

  // 2-week change: latest settled fortnight vs the same fortnight ~52 weeks prior (YoY, from series_weekly).
  let change2wk = null;
  let weekly = signal.series_weekly?.[district];
  if (weekly && typeof weekly === 'object' && !Array.isArray(weekly)) weekly = weekly.reported;   // theft shape
  const weeks = data.weeks;
  const anchorWeek = (settles && data.latest_settled_week) || data.latest_complete_week;
  if (weekly && weeks && anchorWeek) {
    const wEnd = weeks.indexOf(anchorWeek);
    const pIdx = nearestWeekIndex(weeks, anchorWeek, -364);
    if (wEnd >= 1 && pIdx >= 1) {
      const last2 = sumLast(weekly.slice(0, wEnd + 1), 2);
      const prior2 = sumLast(weekly.slice(0, pIdx + 1), 2);
      change2wk = pctChange(last2, prior2);
    }
  }

  return { change1mo, change3mo, change2wk, goal: kr.goal };
}

function renderChangeBadge(change, goal, label) {
  if (change === null) {
    return `<span class="kr-ticker__badge kr-ticker--nodata" title="${label}">—</span>`;
  }
  const isUp = change > 0;
  const isDown = change < 0;
  const isGood = (goal === 'down' && isDown) || (goal === 'up' && isUp);
  const arrow = isUp ? '↑' : (isDown ? '↓' : '→');
  const cls = isGood ? 'kr-ticker--good' : 'kr-ticker--bad';
  return `<span class="kr-ticker__badge ${cls}" title="${label}">${arrow}${Math.abs(change)}%</span>`;
}

function renderKRTicker(okr, district) {
  const items = okr.krs.map(kr => {
    const data = getKRData(okr.id, kr, district);
    if (!data) {
      return `<div class="kr-ticker"><span class="kr-ticker__label">${esc(kr.label)}</span><span class="kr-ticker__badges"><span class="kr-ticker__badge kr-ticker--nodata">—</span></span></div>`;
    }

    return `
      <div class="kr-ticker">
        <span class="kr-ticker__label">${esc(kr.label)}</span>
        <span class="kr-ticker__badges">
          ${renderChangeBadge(data.change2wk, data.goal, '2 weeks vs last year (latest settled fortnight)')}
          ${renderChangeBadge(data.change1mo, data.goal, '1 month vs last year')}
          ${renderChangeBadge(data.change3mo, data.goal, '3 months vs last year')}
        </span>
      </div>
    `;
  });

  const header = `
    <div class="kr-ticker kr-ticker--header" aria-hidden="true">
      <span class="kr-ticker__label"></span>
      <span class="kr-ticker__badges">
        <span class="kr-ticker__col kr-ticker__col--link" title="Why the 2-week figure uses the latest settled fortnight — see methodology below">2wk</span>
        <span class="kr-ticker__col">1mo</span>
        <span class="kr-ticker__col">3mo</span>
      </span>
    </div>
  `;
  return `<div class="kr-tickers">${header}${items.join('')}</div>`;
}

function renderDistrictTabs() {
  return `
    <div class="district-tabs" role="tablist" aria-label="Select district">
      ${DISTRICTS.map(d => `
        <button class="district-tab${d === currentDistrict ? ' is-active' : ''}"
                role="tab"
                aria-selected="${d === currentDistrict}"
                data-district="${d}">
          <span class="district-tab__dot"></span>
          ${esc(d)}
        </button>
      `).join('')}
    </div>
  `;
}


function renderOKRCards() {
  const okrs = getOKRsForDistrict(currentDistrict);
  return `
    <div class="okr-grid">
      ${okrs.map(o => `
        <a class="okr-card" href="${o.href}#${currentDistrict.toLowerCase()}">
          <div class="okr-card__body">
            <span class="okr-card__eyebrow">${esc(o.eyebrow)}</span>
            <h3 class="okr-card__title">${esc(o.title)}</h3>
            ${renderKRTicker(o, currentDistrict)}
          </div>
          <wa-icon class="okr-card__arrow" name="arrow-right" label="Open dashboard"></wa-icon>
        </a>
      `).join('')}
    </div>
  `;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderImpactBadge(impact) {
  if (!impact) return '—';
  const num = parseFloat(impact);
  if (isNaN(num)) return esc(impact);
  const isGood = num < 0;
  const cls = isGood ? 'impact-badge--good' : 'impact-badge--bad';
  const arrow = isGood ? '↓' : '↑';
  const display = Math.abs(num) + '%';
  return `<span class="impact-badge ${cls}">${arrow}${display}</span>`;
}

function renderKRBadge(kr) {
  if (!kr) return '—';
  const okrId = KR_TO_OKR[kr];
  const cls = okrId ? `kr-badge--${okrId}` : '';
  return `<span class="kr-badge ${cls}">${esc(kr)}</span>`;
}

const isStaleEval = i => i.last_evaluated && (Date.now() - new Date(i.last_evaluated).getTime()) > 30 * 24 * 60 * 60 * 1000;

// Table columns in order. `always` columns always render; the rest render only when at least one row
// has a value — so columns we don't have data for yet are hidden until data fills them.
// Where a row links to see its live results. Prefer the record's own read-only
// view page (reconstructs the analysis from its fields, no editable form); fall
// back to a stored shareable link only for curated rows that have no id.
const viewHref = i => (i.id ? `./hypothesis/?view=${encodeURIComponent(i.id)}` : i.eval_link || null);

const INTERVENTION_COLUMNS = [
  { header: 'ID', cls: 'id', always: true, cell: i => `<span class="mono">${esc(i.intervention_id || i.id?.slice(0,8) || '—')}</span>` },
  { header: 'Intervention', cls: 'name', always: true, cell: i => {
      const h = viewHref(i), name = esc(i.intervention || '');
      return h ? `<a class="intervention-link" href="${esc(h)}">${name}</a>` : `<strong>${name}</strong>`;
    } },
  { header: 'Levers', cls: 'levers', has: i => i.levers?.length || i.target_kr, cell: i => renderLeverBadges(i.levers, i.target_kr) },
  { header: 'Status', cls: 'status', always: true, cell: i => renderStatusBadge(i.status) },
  { header: 'Owner', cls: 'owner', has: i => i.owner, cell: i => esc(i.owner || '') },
  { header: 'Started', cls: 'start', has: i => i.start_date, cell: i => formatDate(i.start_date) },
  { header: 'Submitted by', cls: 'submitted', always: true, cell: i => esc(i.person_submitted || '—') },
  { header: 'Last edited', cls: 'edited', always: true, cell: i => formatDate(i.last_edited) },
  { header: '', cls: 'actions', always: true, cell: renderActions },
];

function renderLeverBadges(levers, targetKr) {
  if (levers?.length) {
    return levers.map(l => {
      const okrId = KR_TO_OKR[l] || 'default';
      return `<span class="kr-badge kr-badge--${okrId}">${esc(l)}</span>`;
    }).join(' ');
  }
  if (targetKr) return renderKRBadge(targetKr);
  return '—';
}

function renderStatusBadge(status) {
  const s = status || 'open_in_progress';
  const label = STATUS_LABELS[s] || s;
  const cls = s.replace(/_/g, '-');
  return `<span class="status-badge status--${cls}">${label}</span>`;
}

function renderActions(i) {
  // Saved records edit inline (Archive/Restore live inside the editor). Curated rows
  // without an id just link out to their shared analysis.
  if (i.id) {
    return i.id === editingId
      ? `<span class="action-editing">Editing…</span>`
      : `<button class="action-edit" type="button" data-id="${esc(i.id)}">Edit</button>`;
  }
  if (i.eval_link) return `<a href="${esc(i.eval_link)}" class="eval-link">Evaluate</a>`;
  return '—';
}

function renderInterventionRow(i, cols) {
  const isEditing = i.id && i.id === editingId;
  const h = isEditing ? null : viewHref(i);   // no click-to-view while editing this row
  const row = `<tr class="intervention-row${h ? ' is-clickable' : ''}${isEditing ? ' is-editing' : ''}"${h ? ` data-href="${esc(h)}"` : ''}>${cols.map(c =>
    `<td class="intervention-cell intervention-cell--${c.cls}${c.tdClass ? ' ' + c.tdClass(i) : ''}">${c.cell(i)}</td>`
  ).join('')}</tr>`;
  if (!isEditing) return row;
  return row + `<tr class="intervention-edit-row"><td colspan="${cols.length}">${renderEditor(i)}</td></tr>`;
}

// Inline editor for one saved record — all fields except location (pin/radius stay in the full
// tool). Fields carry data-ed keys; values are populated after render (populateEditor) so web
// components are upgraded first. Footer: Save · Cancel · Archive|Restore.
function renderEditor(i) {
  const isClosed = i.status === 'closed_completed';
  const leverOpts = LEVERS.map(l => `<wa-option value="${esc(l.key)}">${esc(l.label)}</wa-option>`).join('');
  const loc = (i.lat && i.lng)
    ? `${(+i.lat).toFixed(5)}, ${(+i.lng).toFixed(5)}${i.radius ? ` · ${i.radius} m radius` : ''}`
    : 'No pin set';

  return `<div class="intervention-editor" data-id="${esc(i.id)}">
    <div class="editor-grid">
      <wa-input data-ed="intervention" label="Intervention (title)" class="editor-full"></wa-input>
      <wa-input data-ed="owner" label="Owner"></wa-input>
      <wa-input data-ed="agencies" label="Associated agencies"></wa-input>
      <wa-select data-ed="status" label="Status"${isClosed ? ' disabled hint="Archived — use Restore to reopen"' : ''}>
        <wa-option value="open_in_progress">Open · In progress</wa-option>
        <wa-option value="at_risk_on_hold">At risk · On hold</wa-option>
      </wa-select>
      <wa-select data-ed="levers" label="Levers" multiple class="editor-full">${leverOpts}</wa-select>
      <wa-input data-ed="start_date" type="date" label="Start date"></wa-input>
      <wa-input data-ed="end_date" type="date" label="End date"></wa-input>
      <wa-textarea data-ed="description" label="Description" rows="2" class="editor-full"></wa-textarea>
      <wa-textarea data-ed="evidence" label="Evidence" rows="2" class="editor-full"></wa-textarea>
      <wa-textarea data-ed="tactics" label="Tactics" rows="2" class="editor-full"></wa-textarea>
      <wa-textarea data-ed="roadblock" label="Roadblock / flag" rows="2" class="editor-full"></wa-textarea>
      <wa-textarea data-ed="outcomes" label="Outcomes" rows="2" class="editor-full"></wa-textarea>
      <wa-textarea data-ed="notes" label="Notes" rows="2" class="editor-full"></wa-textarea>
      <wa-textarea data-ed="links" label="Related documents" rows="2" class="editor-full"
                   hint="One URL per line."></wa-textarea>
      <wa-input data-ed="edited_by" label="Edited by" placeholder="Your name" required
                hint="Recorded with your change."></wa-input>
    </div>

    <div class="editor-location">
      <span class="editor-location__label">Location</span>
      <span class="editor-location__val">${esc(loc)}</span>
    </div>
    <p class="editor-location__note">Location can't be changed here. To move it, archive this
      intervention and <a href="./hypothesis/?district=${esc(currentDistrict)}">create a new one</a>
      with the new location.</p>

    <p class="editor-error" role="alert" hidden></p>
    <div class="editor-actions">
      ${isClosed
        ? `<button class="action-btn editor-restore" type="button" data-id="${esc(i.id)}" data-name="${esc(i.intervention)}">Restore</button>`
        : `<button class="action-btn editor-archive" type="button" data-id="${esc(i.id)}" data-name="${esc(i.intervention)}">Archive</button>`}
      <span class="editor-actions__spacer"></span>
      <button class="action-btn editor-cancel" type="button">Cancel</button>
      <wa-button class="editor-save" size="small" variant="brand" appearance="accent" data-id="${esc(i.id)}">Save changes</wa-button>
    </div>
  </div>`;
}

// Target KR label per hypothesis datapoint — mirrors the titles in hypothesis/js/datapoints.js.
const KR_LABEL = {
  drug: 'Drug-related complaints', overflow: 'Overflowing trash cans', dumping: 'Illegal dumping',
  hazard: 'Health-hazard waste', homeless_presence: 'Homelessness presence',
};
const sentenceCase = s => { s = (s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };

// Map a saved hypothesis (KV) to an interventions-table row. Now includes all tracker fields.
function savedToRow(s) {
  return {
    id: s.id,
    intervention_id: s.intervention_id || null,
    intervention: s.intervention || sentenceCase(s.what) || 'Saved intervention',
    description: s.description || '',
    evidence: s.evidence || '',
    tactics: s.tactics || '',
    owner: s.owner || '',
    agencies: s.agencies || '',
    levers: s.levers || [],
    target_kr: KR_LABEL[s.dp] || (s.dp ? sentenceCase(s.dp) : ''),
    status: s.status || 'open_in_progress',
    start_date: s.start_date || s.date || '',
    end_date: s.end_date || '',
    roadblock: s.roadblock || '',
    outcomes: s.outcomes || '',
    notes: s.notes || '',
    person_submitted: s.person_submitted || '',
    last_edited: s.last_edited || s.created || '',
    // Location — carried through so the inline editor can show the current pin (read-only).
    lat: s.lat, lng: s.lng, radius: s.radius,
    eval_link: s.url,
  };
}

function renderInterventions() {
  const curated = interventionsByDistrict[currentDistrict] || [];
  const saved = savedInterventions
    .filter(s => (s.district || 'Other') === currentDistrict)
    .map(savedToRow);
  const allRows = [...curated, ...saved];

  // Archived (closed) interventions are NEVER shown here — there is no toggle to reveal them.
  // Match defensively: anything whose status begins with "closed" (incl. legacy `closed`,
  // current `closed_completed`) is treated as archived and dropped.
  const isArchived = r => /^closed/.test(r.status || '');
  const rows = allRows.filter(r => !isArchived(r));
  // Make it obvious the list is scoped to the district picked in the tabs at the top.
  const head = `<div class="interventions-scope">
    <span class="interventions-scope__dot" aria-hidden="true"></span>
    <span class="interventions-scope__text">Showing <strong>${esc(currentDistrict)}</strong> district
      <span class="interventions-scope__hint">· switch with the district tabs above</span></span>
  </div>`;

  if (rows.length === 0) {
    return head + '<p class="intervention-empty">No interventions recorded for this district yet.</p>';
  }

  // Only show columns that have data in at least one row (plus the always-on ones).
  const cols = INTERVENTION_COLUMNS.filter(c => c.always || rows.some(r => c.has(r)));

  return head + `
    <div class="intervention-table-wrap">
      <table class="intervention-table">
        <thead><tr>${cols.map(c => `<th>${c.header}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => renderInterventionRow(r, cols)).join('')}</tbody>
      </table>
    </div>
  `;
}


// Carry the district the user is viewing into the "Add intervention" tool so the
// form's (required) District field pre-populates. The card is static in index.html.
function updateAddLink() {
  const card = document.querySelector('.tool-card');
  if (card) card.href = `./hypothesis/?district=${encodeURIComponent(currentDistrict)}`;
}

function render(container) {
  container.innerHTML = `
    ${renderDistrictTabs()}
    <section class="section-okrs">
      <h2 class="section-label">OKRs</h2>
      ${renderOKRCards()}
    </section>
    <div class="section-divider"></div>
    <section class="section-interventions">
      <h2 class="section-label">Interventions</h2>
      ${renderInterventions()}
    </section>
  `;
  container.removeAttribute('aria-busy');   // real content is in; drop the skeleton's busy flag
  wireEvents(container);
  updateAddLink();
}

function wireEvents(container) {
  container.querySelectorAll('.district-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDistrict = btn.dataset.district;
      syncUrlHash();
      render(container);
    });
  });

  // Whole-row click opens the intervention's results — except when the click is on
  // an action link/button (Edit / Close / the name link), which handle themselves.
  container.querySelectorAll('.intervention-row.is-clickable').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('a, button')) return;
      const href = row.dataset.href;
      if (href) window.location.href = href;
    });
  });


  // Enter inline edit mode for a row
  container.querySelectorAll('.action-edit').forEach(btn => {
    btn.addEventListener('click', () => { editingId = btn.dataset.id; render(container); });
  });

  // If a row is expanded into its editor, populate + wire it
  const editor = container.querySelector('.intervention-editor');
  if (editor) wireEditor(container, editor);
}

// Populate + wire the inline editor for the currently-edited row.
async function wireEditor(container, editor) {
  const id = editor.dataset.id;
  const rec = savedInterventions.find(s => s.id === id);
  if (!rec) { editingId = null; return; }

  // Wire actions first so Cancel/Archive/Restore work even before web components finish upgrading.
  editor.querySelector('.editor-cancel')?.addEventListener('click', () => { editingId = null; render(container); });
  editor.querySelector('.editor-save')?.addEventListener('click', () => saveEditor(container, editor, rec));
  editor.querySelector('.editor-archive')?.addEventListener('click', () => {
    if (!confirm(`Archive "${rec.intervention}"? It will be removed from this list.`)) return;
    mutateAndRefresh(container, id, () => closeIntervention(id), 'Could not archive — please try again.');
  });
  editor.querySelector('.editor-restore')?.addEventListener('click', () => {
    mutateAndRefresh(container, id, () => reopenIntervention(id), 'Could not restore — please try again.');
  });

  await populateEditor(editor, rec);
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Fill editor fields from a record. Awaits component upgrade so `.value` assignments stick.
async function populateEditor(editor, rec) {
  await Promise.all([
    customElements.whenDefined('wa-input'),
    customElements.whenDefined('wa-select'),
    customElements.whenDefined('wa-textarea'),
  ]);
  const set = (key, val) => { const el = editor.querySelector(`[data-ed="${key}"]`); if (el) el.value = val; };
  set('intervention', rec.intervention || '');
  set('owner', rec.owner || '');
  set('agencies', rec.agencies || '');
  set('status', rec.status === 'at_risk_on_hold' ? 'at_risk_on_hold' : 'open_in_progress');
  set('start_date', (rec.start_date || rec.date || '').slice(0, 10));
  set('end_date', (rec.end_date || '').slice(0, 10));
  set('description', rec.description || '');
  set('evidence', rec.evidence || '');
  set('tactics', rec.tactics || '');
  set('roadblock', rec.roadblock || '');
  set('outcomes', rec.outcomes || '');
  set('notes', rec.notes || '');
  set('links', (rec.links || []).join('\n'));
  set('edited_by', '');
  // levers is a multi-select: assign the array to the property (not an attribute).
  const lev = editor.querySelector('[data-ed="levers"]');
  if (lev) lev.value = Array.isArray(rec.levers) && rec.levers.length ? rec.levers : (rec.dp ? [rec.dp] : []);
}

// Gather editor fields → PATCH the record → update cache → collapse. Location is omitted, so the
// Worker's partial merge preserves the stored pin/radius.
async function saveEditor(container, editor, rec) {
  const id = editor.dataset.id;
  const g = key => { const el = editor.querySelector(`[data-ed="${key}"]`); return el ? el.value : undefined; };
  const errEl = editor.querySelector('.editor-error');
  const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } };

  const title = (g('intervention') || '').trim();
  if (!title) { showErr('Intervention title is required.'); editor.querySelector('[data-ed="intervention"]')?.focus?.(); return; }

  const editedBy = (g('edited_by') || '').trim();
  if (!editedBy) { showErr('Please enter your name in “Edited by” to save a change.'); editor.querySelector('[data-ed="edited_by"]')?.focus?.(); return; }

  const leversEl = editor.querySelector('[data-ed="levers"]');
  const levers = leversEl ? (Array.isArray(leversEl.value) ? leversEl.value : [leversEl.value].filter(Boolean)) : [];

  const data = {
    intervention: title,
    description: (g('description') || '').trim(),
    evidence: (g('evidence') || '').trim(),
    tactics: (g('tactics') || '').trim(),
    owner: (g('owner') || '').trim(),
    agencies: (g('agencies') || '').trim(),
    levers,
    start_date: g('start_date') || '',
    end_date: g('end_date') || '',
    roadblock: (g('roadblock') || '').trim(),
    outcomes: (g('outcomes') || '').trim(),
    notes: (g('notes') || '').trim(),
    links: parseLinks(g('links')),
    edited_by: editedBy,
  };
  // Status is managed by Archive/Restore for closed records — don't reopen one on save.
  if (rec.status !== 'closed_completed') data.status = g('status') || 'open_in_progress';

  const saveBtn = editor.querySelector('.editor-save');
  saveBtn.loading = true; saveBtn.disabled = true;
  try {
    const { item } = await updateIntervention(id, data);
    const idx = savedInterventions.findIndex(s => s.id === id);
    if (idx >= 0) savedInterventions[idx] = item;
    editingId = null;
    render(container);
  } catch (e) {
    saveBtn.loading = false; saveBtn.disabled = false;
    showErr('Could not save — ' + e.message);
  }
}

// Shared close/restore flow: run the mutation, refresh the cached record, collapse the editor.
async function mutateAndRefresh(container, id, fn, errMsg) {
  try {
    const { item } = await fn();
    const idx = savedInterventions.findIndex(s => s.id === id);
    if (idx >= 0) savedInterventions[idx] = item;
    editingId = null;
    render(container);
  } catch (e) {
    alert(errMsg);
  }
}

// One URL per line (or comma-separated); bare hosts get https://; capped. Mirrors the form's parser.
function parseLinks(text) {
  return (text || '')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(u => /^https?:\/\//i.test(u) ? u : `https://${u}`)
    .slice(0, 20);
}

async function loadAggregates() {
  const allOkrs = [OKR_DEFS.drug, OKR_DEFS.unhoused, OKR_DEFS.theft];
  const results = await Promise.allSettled(
    allOkrs.map(async o => {
      const res = await fetch(o.dataPath);
      if (!res.ok) return null;
      return { id: o.id, data: await res.json() };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      aggregatesData[r.value.id] = r.value.data;
    }
  }
}

async function fetchEmergingSignal(signalKey, district) {
  const sig = EMERGING_SIGNALS[signalKey];
  if (!sig) return null;

  const now = new Date();
  // wg3w-h783 incident reports settle on a ~2-month approval lag, so — like the baked laggy signals —
  // anchor to the latest SETTLED month, not the calendar-latest complete one. lastEnd is the exclusive
  // end of the latest settled month; every window below is measured back from there (month-aligned).
  const lastEnd = new Date(now.getFullYear(), now.getMonth() - 2, 1);        // exclusive: settled-month boundary
  const last1Start = new Date(lastEnd.getFullYear(), lastEnd.getMonth() - 1, 1);
  const last3Start = new Date(lastEnd.getFullYear(), lastEnd.getMonth() - 3, 1);
  const priorEnd = new Date(lastEnd.getFullYear() - 1, lastEnd.getMonth(), 1); // same point, one year back
  const prior1Start = new Date(priorEnd.getFullYear(), priorEnd.getMonth() - 1, 1);
  const prior3Start = new Date(priorEnd.getFullYear(), priorEnd.getMonth() - 3, 1);

  // 2-week settled fortnight: the 14 days ending at the settled-month boundary, vs the same 14 days
  // ~52 weeks (364 days) earlier. Mirrors the baked series_weekly 2wk chip in spirit (approximate,
  // day-aligned rather than Monday-aligned — the emerging signals are a live approximation).
  const daysBack = (d, n) => { const x = new Date(d); x.setDate(x.getDate() - n); return x; };
  const last2Start = daysBack(lastEnd, 14);
  const prior2End = daysBack(lastEnd, 364);
  const prior2Start = daysBack(prior2End, 14);

  const fmt = d => d.toISOString().slice(0, 10);
  const base = `https://data.sfgov.org/resource/wg3w-h783.json`;

  const countQuery = (start, end) => {
    const where = `${sig.where} AND police_district='${district}' AND incident_date>='${fmt(start)}' AND incident_date<'${fmt(end)}'`;
    return `${base}?$select=count(*)&$where=${encodeURIComponent(where)}`;
  };
  const count = res => parseInt(res[0]?.count || 0, 10);

  try {
    const [last1Res, prior1Res, last3Res, prior3Res, last2Res, prior2Res] = await Promise.all([
      fetch(countQuery(last1Start, lastEnd)).then(r => r.json()),
      fetch(countQuery(prior1Start, priorEnd)).then(r => r.json()),
      fetch(countQuery(last3Start, lastEnd)).then(r => r.json()),
      fetch(countQuery(prior3Start, priorEnd)).then(r => r.json()),
      fetch(countQuery(last2Start, lastEnd)).then(r => r.json()),
      fetch(countQuery(prior2Start, prior2End)).then(r => r.json()),
    ]);

    const last1 = count(last1Res), prior1 = count(prior1Res);
    const last3 = count(last3Res), prior3 = count(prior3Res);
    const last2 = count(last2Res), prior2 = count(prior2Res);
    // All windows end at the latest settled month; 1-mo/3-mo YoY month-aligned, 2wk YoY 14-day-aligned.
    return {
      last1, prior1, change1mo: pctChange(last1, prior1),
      last3, prior3, change3mo: pctChange(last3, prior3),
      last2, prior2, change2wk: pctChange(last2, prior2),
    };
  } catch (e) {
    console.error(`Failed to fetch ${signalKey} for ${district}:`, e);
    return null;
  }
}

async function loadEmergingSignals() {
  const tasks = [];
  for (const district of DISTRICTS) {
    const kr3 = DISTRICT_KR3[district];
    if (kr3 && EMERGING_SIGNALS[kr3.signal]) {
      tasks.push(
        fetchEmergingSignal(kr3.signal, district).then(data => {
          if (data) emergingSignalsCache[`${kr3.signal}_${district}`] = data;
        })
      );
    }
  }
  await Promise.allSettled(tasks);
}

// Saved hypotheses — always live from the Worker. Fetched independently of the main render so a Worker
// outage never blocks the homepage; the table re-renders once they arrive.
async function loadSaved(container) {
  try {
    savedInterventions = await listInterventions();
  } catch (e) {
    console.warn('saved interventions unavailable —', e.message);
    return;   // table degrades to curated (TSV) rows only
  }
  render(container);
}

// Homepage methodology — the three district KR#3 "emerging signals" are the ONLY numbers computed
// here (live, in-browser) rather than on a dashboard with its own footnotes. Expose each one's dataset,
// filter, and a runnable monthly-series query so the district-card badges are traceable too. The baked
// KR tickers (drug/unhoused/theft) defer to their dashboards, which carry the full provenance.
function renderMethodology() {
  const host = document.getElementById('home-methodology');
  if (!host) return;
  const DS = 'wg3w-h783';
  const q = soql => `https://data.sfgov.org/resource/${DS}.json?${new URLSearchParams({ '$query': soql })}`;
  // Monthly counts for the signal in one district — the series both the 1-mo and 3-mo YoY badges derive from.
  const monthly = (where, district) => q(
    `SELECT date_trunc_ym(incident_date) AS month, count(*) AS n `
    + `WHERE (${where}) AND police_district='${district}' `
    + `GROUP BY month ORDER BY month`);
  const rows = DISTRICTS
    .map(d => ({ d, kr3: DISTRICT_KR3[d] }))
    .filter(x => x.kr3 && EMERGING_SIGNALS[x.kr3.signal])
    .map(({ d, kr3 }) => {
      const where = EMERGING_SIGNALS[kr3.signal].where;
      return `<li><strong>${kr3.label} — ${d}.</strong> `
        + `Change vs. the same period a year ago (last complete month, and last 3 months). `
        + `Filter <code>${esc(where)}</code>, scoped to <code>police_district='${d}'</code>. `
        + `<a href="${monthly(where, d)}" target="_blank" rel="noopener">run the monthly series ↗</a></li>`;
    }).join('');
  host.innerHTML =
    `<details class="home-methodology__d">`
    + `<summary>Sources &amp; method</summary>`
    + `<p>Each KR card shows three year-over-year change chips — <strong>2wk</strong>, <strong>1mo</strong>, `
    + `and <strong>3mo</strong> — each comparing the most recent period against the same period a year `
    + `earlier. Year-over-year comparison controls for seasonality (theft and street activity swing with `
    + `the calendar), so a chip isolates the real change rather than the time of year.</p>`
    + `<p>The chips read the latest <strong>settled</strong> period — the most recent fully-approved window, `
    + `not the calendar-latest. Some sources lag: SFPD incident reports (theft, and the emerging signals `
    + `below) appear only after supervisor approval (~2 months), and drug-dealer arrests settle ~1 month. `
    + `For those signals the <strong>2wk</strong> chip reflects the latest settled fortnight, which sits `
    + `several weeks in the past; creation-stamped signals (community 911 calls, homelessness reports) `
    + `have no lag, so their 2-week chip is genuinely the last two weeks.</p>`
    + `<p>Each objective's Key Results are computed on its own dashboard — open a dashboard to see the `
    + `dataset and the exact query behind every number. The one exception is the third KR on each `
    + `district's property-&amp;-crime card (an emerging local issue), computed live here from the SFPD `
    + `incident dataset (<a href="https://data.sfgov.org/d/${DS}" target="_blank" rel="noopener">${DS}</a>):</p>`
    + `<ul class="home-methodology__list">${rows}</ul>`;
}

async function init() {
  const container = document.getElementById('districts-container');
  if (!container) return;

  try {
    // Gate first paint on LOCAL files only (TSV + baked aggregates.json). Live Socrata
    // (emerging signals) and the Worker (saved) are slow/external — kept out of this
    // barrier so the districts block paints fast and doesn't jump. See plan-layout-shift.md.
    const [interventionsRes] = await Promise.all([
      fetch('./data/interventions.tsv'),
      loadAggregates(),
    ]);

    const text = await interventionsRes.text();
    const interventions = parseTSV(text);
    interventionsByDistrict = groupBy(interventions, 'district');

    initDistrict();
    render(container);
    renderMethodology();   // static; no data dependency

    // Fill fixed-size slots after first paint — no layout shift:
    // - emerging signals update the theft KR3 badge (already rendered as a sized "—")
    // - saved interventions append into the height-reserved table
    loadEmergingSignals().then(() => render(container));
    loadSaved(container);   // fire-and-forget; re-renders the table when the saved items arrive

    window.addEventListener('popstate', () => {
      initDistrict();
      render(container);
    });

    // Esc cancels inline edit mode, wherever focus is.
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && editingId) { editingId = null; render(container); }
    });
  } catch (err) {
    console.error('Failed to load data:', err);
    container.innerHTML = '<p class="error">Failed to load data.</p>';
  }
}

init();
