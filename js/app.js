import { parseTSV, groupBy } from './tsv.js';
import { listInterventions, closeIntervention, reopenIntervention } from './interventions-client.js';

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
let showClosed = false;           // whether to show closed interventions
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

function getKRData(okrId, kr, district) {
  // Check if this is an emerging signal (fetched from Socrata)
  if (EMERGING_SIGNALS[kr.signal]) {
    const cached = emergingSignalsCache[`${kr.signal}_${district}`];
    if (!cached) return null;
    return { change1mo: cached.change, change3mo: cached.change, goal: kr.goal };
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

  const len = series.length;
  const hasPartial = data.current_partial_month != null;
  const endIdx = hasPartial ? len - 1 : len;

  // 1-month change: compare last settled month vs same month last year
  const last1 = series[endIdx - 1];
  const prior1 = series[endIdx - 13];
  const change1mo = pctChange(last1, prior1);

  // 3-month change: compare last 3 months vs same 3 months last year
  const last3 = sumLast(series.slice(0, endIdx), 3);
  const prior3 = sumLast(series.slice(0, endIdx - 12), 3);
  const change3mo = pctChange(last3, prior3);

  return { change1mo, change3mo, goal: kr.goal };
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
// Where a row links to see its live results. Prefer a stored shareable link when
// present (curated/quick-saved rows reconstruct the exact analysis from it);
// otherwise the view page for a saved record (reconstructs from its fields).
const viewHref = i => i.eval_link || (i.id ? `./hypothesis/?view=${encodeURIComponent(i.id)}` : null);

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
  const parts = [];
  // Edit link
  if (i.id) {
    parts.push(`<a href="./hypothesis/?edit=${esc(i.id)}" class="action-link">Edit</a>`);
  } else if (i.eval_link) {
    parts.push(`<a href="${esc(i.eval_link)}" class="eval-link">Evaluate</a>`);
  }
  // Close/Reopen button
  if (i.id) {
    const isClosed = i.status === 'closed_completed';
    if (isClosed) {
      parts.push(`<button class="action-btn action-reopen" type="button" data-id="${esc(i.id)}" data-name="${esc(i.intervention)}">Reopen</button>`);
    } else {
      parts.push(`<button class="action-btn action-close" type="button" data-id="${esc(i.id)}" data-name="${esc(i.intervention)}">Close</button>`);
    }
  }
  return parts.join(' ') || '—';
}

function renderInterventionRow(i, cols) {
  const h = viewHref(i);
  return `<tr class="intervention-row${h ? ' is-clickable' : ''}"${h ? ` data-href="${esc(h)}"` : ''}>${cols.map(c =>
    `<td class="intervention-cell intervention-cell--${c.cls}${c.tdClass ? ' ' + c.tdClass(i) : ''}">${c.cell(i)}</td>`
  ).join('')}</tr>`;
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
    eval_link: s.url,
  };
}

function renderInterventions() {
  const curated = interventionsByDistrict[currentDistrict] || [];
  const saved = savedInterventions
    .filter(s => (s.district || 'Other') === currentDistrict)
    .map(savedToRow);
  const allRows = [...curated, ...saved];

  // Split into open and closed
  const openRows = allRows.filter(r => r.status !== 'closed_completed');
  const closedRows = allRows.filter(r => r.status === 'closed_completed');
  const rows = showClosed ? allRows : openRows;

  const openCount = openRows.length;
  const closedCount = closedRows.length;
  const head = `<p class="interventions-head">
    ${esc(currentDistrict)} — ${allRows.length} intervention${allRows.length === 1 ? '' : 's'}
    <span class="interventions-counts">${openCount} open · ${closedCount} closed</span>
  </p>`;

  if (rows.length === 0 && closedCount === 0) {
    return head + '<p class="intervention-empty">No interventions recorded for this district yet.</p>';
  }

  // Only show columns that have data in at least one row (plus the always-on ones).
  const cols = INTERVENTION_COLUMNS.filter(c => c.always || rows.some(r => c.has(r)));

  const toggleLink = closedCount > 0
    ? `<button class="view-closed-toggle" type="button">${showClosed ? 'Hide' : 'View'} closed interventions (${closedCount})</button>`
    : '';

  return head + `
    <div class="intervention-table-wrap">
      <table class="intervention-table">
        <thead><tr>${cols.map(c => `<th>${c.header}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => renderInterventionRow(r, cols)).join('')}</tbody>
      </table>
    </div>
    ${toggleLink}
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
      <p class="section-label">OKRs</p>
      ${renderOKRCards()}
    </section>
    <div class="section-divider"></div>
    <section class="section-interventions">
      <p class="section-label">Interventions</p>
      ${renderInterventions()}
    </section>
  `;
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


  // Close an intervention
  container.querySelectorAll('.action-close').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, name } = btn.dataset;
      if (!confirm(`Close "${name}"?`)) return;
      btn.disabled = true;
      try {
        const { item } = await closeIntervention(id);
        // Update local cache
        const idx = savedInterventions.findIndex(s => s.id === id);
        if (idx >= 0) savedInterventions[idx] = item;
        render(container);
      } catch (e) {
        btn.disabled = false;
        alert('Could not close — please try again.');
      }
    });
  });

  // Reopen an intervention
  container.querySelectorAll('.action-reopen').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, name } = btn.dataset;
      btn.disabled = true;
      try {
        const { item } = await reopenIntervention(id);
        const idx = savedInterventions.findIndex(s => s.id === id);
        if (idx >= 0) savedInterventions[idx] = item;
        render(container);
      } catch (e) {
        btn.disabled = false;
        alert('Could not reopen — please try again.');
      }
    });
  });

  // Toggle showing closed interventions
  const toggleBtn = container.querySelector('.view-closed-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      showClosed = !showClosed;
      render(container);
    });
  }
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
  const last3End = new Date(now.getFullYear(), now.getMonth(), 1);
  const last3Start = new Date(last3End.getFullYear(), last3End.getMonth() - 3, 1);
  const prior3End = new Date(last3End.getFullYear() - 1, last3End.getMonth(), 1);
  const prior3Start = new Date(prior3End.getFullYear(), prior3End.getMonth() - 3, 1);

  const fmt = d => d.toISOString().slice(0, 10);
  const base = `https://data.sfgov.org/resource/wg3w-h783.json`;

  const countQuery = (start, end) => {
    const where = `${sig.where} AND police_district='${district}' AND incident_date>='${fmt(start)}' AND incident_date<'${fmt(end)}'`;
    return `${base}?$select=count(*)&$where=${encodeURIComponent(where)}`;
  };

  try {
    const [last3Res, prior3Res] = await Promise.all([
      fetch(countQuery(last3Start, last3End)).then(r => r.json()),
      fetch(countQuery(prior3Start, prior3End)).then(r => r.json()),
    ]);

    const last3 = parseInt(last3Res[0]?.count || 0, 10);
    const prior3 = parseInt(prior3Res[0]?.count || 0, 10);
    const change = pctChange(last3, prior3);

    return { last3, prior3, change };
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

async function init() {
  const container = document.getElementById('districts-container');
  if (!container) return;

  try {
    const [interventionsRes] = await Promise.all([
      fetch('./data/interventions.tsv'),
      loadAggregates(),
      loadEmergingSignals(),
    ]);

    const text = await interventionsRes.text();
    const interventions = parseTSV(text);
    interventionsByDistrict = groupBy(interventions, 'district');

    initDistrict();
    render(container);
    loadSaved(container);   // fire-and-forget; re-renders the table when the saved items arrive

    window.addEventListener('popstate', () => {
      initDistrict();
      render(container);
    });
  } catch (err) {
    console.error('Failed to load data:', err);
    container.innerHTML = '<p class="error">Failed to load data.</p>';
  }
}

init();
