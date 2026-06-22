import { parseTSV, groupBy } from './tsv.js';

const DISTRICTS = ['Northern', 'Central', 'Mission', 'Tenderloin'];

// Base OKR definitions with data sources
const OKR_DEFS = {
  drug: {
    id: 'drug',
    title: 'Reduce visible disorder: Drugs',
    href: './drug/',
    eyebrow: 'Drug activity',
    dataPath: './drug/data/aggregates.json',
  },
  unhoused: {
    id: 'unhoused',
    title: 'Reduce unsheltered homelessness',
    href: './unhoused/',
    eyebrow: 'Unhoused presence',
    dataPath: './unhoused/data/aggregates.json',
  },
  theft: {
    id: 'theft',
    title: 'Restore merchant confidence',
    href: './theft/',
    eyebrow: 'Theft from merchants',
    dataPath: './theft/data/aggregates.json',
  },
};

// District-specific OKRs and KRs
const DISTRICT_OKRS = {
  Northern: [
    {
      ...OKR_DEFS.drug,
      krs: [
        { signal: 'cfs_drug', label: '911 drug complaints', goal: 'down' },
        { signal: 'dealer_arrests', label: 'Dealer arrests', goal: 'up' },
      ]
    },
    {
      ...OKR_DEFS.unhoused,
      krs: [
        { signal: 'encampment', label: 'Encampment reports', goal: 'down' },
        { signal: 'cfs_homeless', label: '911 unhoused calls', goal: 'down' },
      ]
    },
    {
      ...OKR_DEFS.theft,
      title: 'Reduce non-violent crime',
      krs: [
        { signal: 'shoplifting', label: 'Shoplifting', goal: 'down' },
        { signal: 'commercial', label: 'Commercial burglary & robbery', goal: 'down' },
      ]
    },
  ],
  Central: [
    {
      ...OKR_DEFS.drug,
      krs: [
        { signal: 'cfs_drug', label: '911 drug complaints', goal: 'down' },
        { signal: 'dealer_arrests', label: 'Dealer arrests', goal: 'up' },
      ]
    },
    {
      ...OKR_DEFS.unhoused,
      krs: [
        { signal: 'encampment', label: 'Encampment reports', goal: 'down' },
        { signal: 'cfs_homeless', label: '911 unhoused calls', goal: 'down' },
      ]
    },
    {
      ...OKR_DEFS.theft,
      krs: [
        { signal: 'shoplifting', label: 'Shoplifting', goal: 'down' },
        { signal: 'commercial', label: 'Commercial burglary & robbery', goal: 'down' },
      ]
    },
  ],
  Mission: [
    {
      ...OKR_DEFS.drug,
      krs: [
        { signal: 'cfs_drug', label: '911 drug complaints', goal: 'down' },
        { signal: 'dealer_arrests', label: 'Dealer arrests', goal: 'up' },
      ]
    },
    {
      ...OKR_DEFS.unhoused,
      krs: [
        { signal: 'encampment', label: 'Encampment reports', goal: 'down' },
        { signal: 'cfs_homeless', label: '911 unhoused calls', goal: 'down' },
      ]
    },
    {
      ...OKR_DEFS.theft,
      krs: [
        { signal: 'shoplifting', label: 'Shoplifting', goal: 'down' },
        { signal: 'commercial', label: 'Commercial burglary & robbery', goal: 'down' },
      ]
    },
  ],
  Tenderloin: [
    {
      ...OKR_DEFS.drug,
      krs: [
        { signal: 'cfs_drug', label: '911 drug complaints', goal: 'down' },
        { signal: 'dealer_arrests', label: 'Dealer arrests', goal: 'up' },
      ]
    },
    {
      ...OKR_DEFS.unhoused,
      krs: [
        { signal: 'encampment', label: 'Encampment reports', goal: 'down' },
        { signal: 'cfs_homeless', label: '911 unhoused calls', goal: 'down' },
      ]
    },
    {
      ...OKR_DEFS.theft,
      krs: [
        { signal: 'shoplifting', label: 'Shoplifting', goal: 'down' },
        { signal: 'commercial', label: 'Commercial burglary & robbery', goal: 'down' },
      ]
    },
  ],
};

// Helper to get OKRs for current district
function getOKRs() {
  return DISTRICT_OKRS[currentDistrict] || [];
}

// Flat list for KR dropdown in form
function getAllOKRs() {
  return Object.values(OKR_DEFS);
}

const LEVERS = ['Enforcement', 'Environmental', 'Outreach', 'Cleaning', 'Infrastructure', 'Policy'];
const STATUSES = ['In progress', 'Closed'];
const OUTCOMES = [
  { value: '', label: 'In progress' },
  { value: 'worked', label: '✓ Worked' },
  { value: 'didnt', label: '✗ Didn\'t work' },
  { value: 'inconclusive', label: '~ Inconclusive' },
];

let currentDistrict = DISTRICTS[0];
let currentTab = 'okrs';
let interventionsByDistrict = {};
let aggregatesData = {};
let showForm = false;

function esc(s) {
  if (!s) return '';
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
  const data = aggregatesData[okrId];
  if (!data) return null;

  const signal = data.signals?.[kr.signal];
  if (!signal) return null;

  let series = signal.series?.[district];
  if (!series) {
    const districtKey = district.toLowerCase();
    series = signal[districtKey]?.reported;
  }

  if (!series || series.length < 13) return null;

  const len = series.length;
  const hasPartial = data.current_partial_month != null;
  const endIdx = hasPartial ? len - 1 : len;

  const last3 = sumLast(series.slice(0, endIdx), 3);
  const prior3 = sumLast(series.slice(0, endIdx - 12), 3);
  const change = pctChange(last3, prior3);

  return { change, goal: kr.goal };
}

function renderKRTicker(okr, district) {
  const items = okr.krs.map(kr => {
    const data = getKRData(okr.id, kr, district);
    if (!data || data.change === null) {
      return `<div class="kr-ticker"><span class="kr-ticker__label">${esc(kr.label)}</span><span class="kr-ticker__badge kr-ticker--nodata">—</span></div>`;
    }

    const isUp = data.change > 0;
    const isDown = data.change < 0;
    const isGood = (data.goal === 'down' && isDown) || (data.goal === 'up' && isUp);
    const arrow = isUp ? '↑' : (isDown ? '↓' : '→');
    const cls = isGood ? 'kr-ticker--good' : 'kr-ticker--bad';

    return `
      <div class="kr-ticker">
        <span class="kr-ticker__label">${esc(kr.label)}</span>
        <span class="kr-ticker__badge ${cls}">${arrow}${Math.abs(data.change)}%</span>
      </div>
    `;
  });

  return `<div class="kr-tickers">${items.join('')}</div>`;
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
  const districtHash = `#${currentDistrict.toLowerCase()}`;
  const okrs = getOKRs();
  return `
    <div class="okr-grid">
      ${okrs.map(o => `
        <a class="okr-card" href="${o.href}${districtHash}">
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

function getLeverClass(lever) {
  const map = { Outreach: 'outreach', Cleaning: 'cleaning', Environmental: 'env', Infrastructure: 'infra' };
  return map[lever] || '';
}

function getWorkingLabel(i) {
  if (!i.working) return { label: '—', cls: 'gray' };
  if (i.working === 'yes' || i.working === 'worked') return { label: 'Working', cls: 'good' };
  if (i.working === 'no' || i.working === 'didnt') return { label: 'Not working', cls: 'bad' };
  if (i.working === 'inconclusive') return { label: 'Inconclusive', cls: 'amber' };
  return { label: '—', cls: 'gray' };
}

function getOutcomeLabel(outcome) {
  if (!outcome) return '';
  if (outcome === 'worked') return '✓ Worked';
  if (outcome === 'didnt') return '✗ Didn\'t work';
  if (outcome === 'inconclusive') return '~ Inconclusive';
  return '';
}

function renderInterventionRow(i, idx) {
  const okr = getAllOKRs().find(o => o.id === i.target_okr);
  const krLabel = okr ? `KR: ${okr.title}` : (i.target_okr || '<span class="iv-unmapped">Not mapped</span>');
  const leverCls = getLeverClass(i.lever);
  const working = getWorkingLabel(i);
  const outcome = getOutcomeLabel(i.working);
  const outcomeCls = i.working === 'worked' ? 'good' : (i.working === 'didnt' ? 'bad' : '');

  return `
    <tr>
      <td>
        <div class="iv-name">${esc(i.name)}</div>
        <div class="iv-problem">${esc(i.description)}</div>
      </td>
      <td class="iv-owner">${esc(i.owner) || '—'}${i.agencies ? `<div class="iv-agencies">+ ${esc(i.agencies)}</div>` : ''}</td>
      <td>${i.lever ? `<span class="iv-lever ${leverCls}">${esc(i.lever)}</span>` : '—'}</td>
      <td class="iv-kr">${krLabel}</td>
      <td><span class="iv-effect iv-effect--${working.cls}">${working.label}</span></td>
      <td>${outcome ? `<span class="iv-outcome ${outcomeCls}">${outcome}</span>` : '—'}</td>
    </tr>
  `;
}

function renderAddForm() {
  if (!showForm) return '';

  return `
    <div class="iv-form">
      <h3>New intervention</h3>
      <p class="iv-form__desc">Capture the work and map it to the Key Result it serves.</p>
      <div class="iv-form__grid">
        <div class="iv-field iv-field--full">
          <label>Intervention name <span class="req">*</span></label>
          <input type="text" id="iv-name" placeholder="e.g. Evening plaza activation">
        </div>
        <div class="iv-field iv-field--full iv-field--kr">
          <label>Serves Key Result <span class="req">*</span></label>
          <select id="iv-kr">
            <option value="">— select a Key Result —</option>
            ${getOKRs().map(o => `<option value="${o.id}">${esc(o.title)}</option>`).join('')}
          </select>
        </div>
        <div class="iv-field">
          <label>Lever</label>
          <select id="iv-lever">
            ${LEVERS.map(l => `<option value="${l}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="iv-field">
          <label>Status</label>
          <select id="iv-status">
            ${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div class="iv-field">
          <label>Owner</label>
          <input type="text" id="iv-owner" placeholder="e.g. DEM">
        </div>
        <div class="iv-field">
          <label>Associated agencies</label>
          <input type="text" id="iv-agencies" placeholder="e.g. SFPD, DPW">
        </div>
        <div class="iv-field iv-field--full">
          <label>Problem statement</label>
          <textarea id="iv-problem" placeholder="What condition is this addressing?"></textarea>
        </div>
      </div>
      <p class="iv-form__note">Mapping to a Key Result is required. A new intervention starts in "90-day window building" until there's enough time for a before/after read.</p>
      <div class="iv-form__actions">
        <button class="btn-primary" id="iv-submit">Add intervention</button>
        <button class="btn-ghost" id="iv-cancel">Cancel</button>
      </div>
    </div>
  `;
}

function renderInterventions() {
  const interventions = interventionsByDistrict[currentDistrict] || [];
  const count = interventions.length;

  return `
    <div class="iv-header">
      <div>
        <h2 class="iv-title">Intervention log</h2>
        <p class="iv-subtitle">Every intervention maps to the Key Result it serves and closes the loop with an is-it-working read plus a recorded outcome.</p>
      </div>
      <div class="iv-header__actions">
        <span class="iv-count">${count} logged</span>
        <button class="iv-add-btn" id="iv-add-btn">+ Add intervention</button>
      </div>
    </div>
    ${renderAddForm()}
    <div class="iv-table-wrap">
      <table class="iv-table">
        <thead>
          <tr>
            <th>Intervention</th>
            <th>Owner & agencies</th>
            <th>Lever</th>
            <th>Serves KR</th>
            <th>Is it working?</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          ${count > 0 ? interventions.map((i, idx) => renderInterventionRow(i, idx)).join('') : `
            <tr class="iv-empty-row">
              <td colspan="6">No interventions logged for ${currentDistrict} yet. Click "+ Add intervention" to get started.</td>
            </tr>
          `}
        </tbody>
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
      showForm = false;
      render(container);
    });
  });

  container.querySelectorAll('.content-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      showForm = false;
      render(container);
    });
  });

  const addBtn = container.querySelector('#iv-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      showForm = !showForm;
      render(container);
    });
  }

  const cancelBtn = container.querySelector('#iv-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      showForm = false;
      render(container);
    });
  }

  const submitBtn = container.querySelector('#iv-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const name = container.querySelector('#iv-name')?.value?.trim();
      const kr = container.querySelector('#iv-kr')?.value;
      if (!name || !kr) {
        alert('Please fill in the intervention name and select a Key Result.');
        return;
      }

      const intervention = {
        name,
        target_okr: kr,
        lever: container.querySelector('#iv-lever')?.value || '',
        status: container.querySelector('#iv-status')?.value || 'In progress',
        owner: container.querySelector('#iv-owner')?.value?.trim() || '',
        agencies: container.querySelector('#iv-agencies')?.value?.trim() || '',
        description: container.querySelector('#iv-problem')?.value?.trim() || '',
        working: '',
        eval_link: '',
      };

      if (!interventionsByDistrict[currentDistrict]) {
        interventionsByDistrict[currentDistrict] = [];
      }
      interventionsByDistrict[currentDistrict].push(intervention);
      showForm = false;
      render(container);
    });
  }
}

async function loadAggregates() {
  const okrDefs = Object.values(OKR_DEFS);
  const results = await Promise.allSettled(
    okrDefs.map(async o => {
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

async function init() {
  const container = document.getElementById('districts-container');
  if (!container) return;

  try {
    const [interventionsRes] = await Promise.all([
      fetch('./data/interventions.tsv'),
      loadAggregates()
    ]);

    const text = await interventionsRes.text();
    const interventions = parseTSV(text);
    interventionsByDistrict = groupBy(interventions, 'district');

    render(container);
  } catch (err) {
    console.error('Failed to load data:', err);
    container.innerHTML = '<p class="error">Failed to load data.</p>';
  }
}

init();
