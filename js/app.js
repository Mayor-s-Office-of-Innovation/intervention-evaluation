import { parseTSV, groupBy } from './tsv.js';

const DISTRICTS = ['Northern', 'Central', 'Mission', 'Tenderloin'];

const OKRS = [
  {
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
  {
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
  {
    id: 'theft',
    title: 'Restore merchant confidence',
    href: './theft/',
    eyebrow: 'Theft from merchants',
    dataPath: './theft/data/aggregates.json',
    krs: [
      { signal: 'shoplifting', label: 'Shoplifting', goal: 'down' },
      { signal: 'commercial', label: 'Commercial burglary & robbery', goal: 'down' },
    ]
  },
];

const STATUS_LABELS = { active: 'Active', completed: 'Completed', planned: 'Planned' };
const WORKING_LABELS = { yes: 'Working', no: 'Not working', inconclusive: 'Inconclusive' };

let currentDistrict = DISTRICTS[0];
let currentTab = 'okrs';
let interventionsByDistrict = {};
let aggregatesData = {};

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
  const data = aggregatesData[okrId];
  if (!data) return null;

  const signal = data.signals?.[kr.signal];
  if (!signal) return null;

  // Handle different data structures
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
  return `
    <div class="okr-grid">
      ${OKRS.map(o => `
        <a class="okr-card" href="${o.href}">
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

function renderIntervention(i) {
  const statusClass = i.status ? `intervention-status--${i.status}` : '';
  const workingClass = i.working ? `intervention-working--${i.working}` : '';
  const okrLabel = OKRS.find(o => o.id === i.target_okr)?.title || i.target_okr;

  return `
    <li class="intervention-item">
      <div class="intervention-item__header">
        <span class="intervention-name">${esc(i.name)}</span>
        ${i.status ? `<span class="intervention-status ${statusClass}">${STATUS_LABELS[i.status] || i.status}</span>` : ''}
        ${i.working ? `<span class="intervention-working ${workingClass}">${WORKING_LABELS[i.working] || i.working}</span>` : ''}
      </div>
      <p class="intervention-desc">${esc(i.description)}</p>
      <div class="intervention-meta">
        <span class="intervention-okr">Target: ${esc(okrLabel)}</span>
        ${i.eval_link ? `<a class="intervention-eval" href="${esc(i.eval_link)}">View evaluation <wa-icon name="arrow-right"></wa-icon></a>` : ''}
      </div>
    </li>
  `;
}

function renderInterventions() {
  const interventions = interventionsByDistrict[currentDistrict] || [];
  if (interventions.length === 0) {
    return '<p class="intervention-empty">No interventions recorded for this district yet.</p>';
  }
  return `
    <ul class="intervention-list">
      ${interventions.map(renderIntervention).join('')}
    </ul>
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
}

async function loadAggregates() {
  const results = await Promise.allSettled(
    OKRS.map(async o => {
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
