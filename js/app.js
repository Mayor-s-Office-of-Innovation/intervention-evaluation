import { parseTSV, groupBy } from './tsv.js';
import { listInterventions, deleteIntervention } from './interventions-client.js';

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

const STATUS_LABELS = { active: 'Active', completed: 'Completed', planned: 'Planned' };
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
let currentTab = 'okrs';
let interventionsByDistrict = {};
let aggregatesData = {};
let emergingSignalsCache = {};
let savedInterventions = [];   // saved hypotheses fetched live from the Worker (see loadSaved)

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

function renderContentTabs() {
  return `
    <div class="content-tabs" role="tablist" aria-label="View type">
      <button class="content-tab${currentTab === 'okrs' ? ' is-active' : ''}"
              role="tab"
              aria-selected="${currentTab === 'okrs'}"
              data-tab="okrs">
        OKRs
      </button>
      <button class="content-tab${currentTab === 'interventions' ? ' is-active' : ''}"
              role="tab"
              aria-selected="${currentTab === 'interventions'}"
              data-tab="interventions">
        Interventions
      </button>
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
// has a value — so columns we don't have data for yet (tactics/owner/agencies/status/impact/last-eval)
// are hidden, and reappear automatically once curated data fills them.
const INTERVENTION_COLUMNS = [
  { header: 'Intervention', cls: 'name', always: true, cell: i => `<strong>${esc(i.intervention || '')}</strong>` },
  { header: 'Target KR', cls: 'kr', has: i => i.target_kr, cell: i => renderKRBadge(i.target_kr) },
  { header: 'Tactics', cls: 'tactics', has: i => i.tactics, cell: i => esc(i.tactics || '') },
  { header: 'Owner', cls: 'owner', has: i => i.owner, cell: i => esc(i.owner || '') },
  { header: 'Agencies', cls: 'agencies', has: i => i.agencies, cell: i => esc(i.agencies || '') },
  { header: 'Status', cls: 'status', has: i => i.status, cell: i => `<span class="status-badge status--${i.status}">${STATUS_LABELS[i.status] || i.status}</span>` },
  { header: 'Started', cls: 'start', has: i => i.start_date, cell: i => formatDate(i.start_date) },
  { header: 'Impact', cls: 'impact', has: i => i.impact, cell: i => renderImpactBadge(i.impact) },
  { header: 'Last Evaluated', cls: 'eval', has: i => i.last_evaluated, tdClass: i => isStaleEval(i) ? 'is-stale' : '',
    cell: i => `${formatDate(i.last_evaluated)}${isStaleEval(i) ? ' <span class="stale-flag" title="Over 30 days since last evaluation">stale</span>' : ''}` },
  { header: '', cls: 'actions', always: true, cell: i =>
    `${i.eval_link ? `<a href="${esc(i.eval_link)}" class="eval-link">Evaluate</a>` : ''}` +
    `${i.id ? `<button class="intervention-delete" type="button" data-id="${esc(i.id)}" data-name="${esc(i.intervention)}" aria-label="Remove ${esc(i.intervention)}" title="Remove"><wa-icon name="trash" label=""></wa-icon></button>` : ''}` || '—' },
];

function renderInterventionRow(i, cols) {
  return `<tr class="intervention-row">${cols.map(c =>
    `<td class="intervention-cell intervention-cell--${c.cls}${c.tdClass ? ' ' + c.tdClass(i) : ''}">${c.cell(i)}</td>`
  ).join('')}</tr>`;
}

// Target KR label per hypothesis datapoint — mirrors the titles in hypothesis/js/datapoints.js.
const KR_LABEL = {
  drug: 'Drug-related complaints', overflow: 'Overflowing trash cans', dumping: 'Illegal dumping',
  hazard: 'Health-hazard waste', homeless_presence: 'Homelessness presence',
};
const sentenceCase = s => { s = (s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };

// Map a saved hypothesis (KV) to an interventions-table row. URL-derived columns are filled; the
// curation columns (tactics/owner/agencies/status) and impact/last-evaluated are blank → render as "—"
// (Phases 2–4). `eval_link` reopens the saved evaluation.
function savedToRow(s) {
  return {
    id: s.id,   // present only on saved (KV) rows → enables the delete button
    intervention: sentenceCase(s.what) || 'Saved intervention',
    target_kr: KR_LABEL[s.dp] || (s.dp ? sentenceCase(s.dp) : ''),
    tactics: '', owner: '', agencies: '', status: '',
    start_date: s.date || '', impact: '', last_evaluated: '',
    eval_link: s.url,
  };
}

function renderInterventions() {
  const curated = interventionsByDistrict[currentDistrict] || [];
  const saved = savedInterventions
    .filter(s => (s.district || 'Other') === currentDistrict)
    .map(savedToRow);
  const rows = [...curated, ...saved];
  const head = `<p class="interventions-head">${esc(currentDistrict)} — ${rows.length} intervention${rows.length === 1 ? '' : 's'}</p>`;
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

function renderContent() {
  return currentTab === 'okrs' ? renderOKRCards() : renderInterventions();
}

function render(container) {
  container.innerHTML = `
    ${renderDistrictTabs()}
    ${renderContentTabs()}
    <div class="tab-content">
      ${renderContent()}
    </div>
  `;
  wireEvents(container);
}

function wireEvents(container) {
  container.querySelectorAll('.district-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDistrict = btn.dataset.district;
      render(container);
    });
  });

  container.querySelectorAll('.content-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      render(container);
    });
  });

  // Soft-delete a saved intervention from its table row (curated TSV rows have no id → no button).
  container.querySelectorAll('.intervention-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, name } = btn.dataset;
      if (!confirm(`Remove "${name}"?`)) return;
      btn.disabled = true;
      try {
        await deleteIntervention(id);
        savedInterventions = savedInterventions.filter(s => s.id !== id);
        render(container);
      } catch (e) {
        btn.disabled = false;
        alert('Could not remove — please try again.');
      }
    });
  });
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
// outage never blocks the homepage; the table re-renders once they arrive (if it's the visible tab).
async function loadSaved(container) {
  try {
    savedInterventions = await listInterventions();
  } catch (e) {
    console.warn('saved interventions unavailable —', e.message);
    return;   // table degrades to curated (TSV) rows only
  }
  if (currentTab === 'interventions') render(container);
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

    render(container);
    loadSaved(container);   // fire-and-forget; re-renders the table when the saved items arrive
  } catch (err) {
    console.error('Failed to load data:', err);
    container.innerHTML = '<p class="error">Failed to load data.</p>';
  }
}

init();
