import { parseTSV, groupBy } from './tsv.js';

const DISTRICTS = ['Northern', 'Central', 'Mission', 'Tenderloin'];

const OKRS = [
  { id: 'drug', title: 'Reduce visible disorder: Drugs', href: './drug/', eyebrow: 'Drug activity',
    dataPath: './drug/data/aggregates.json', signal: 'cfs_drug', goal: 'down' },
  { id: 'unhoused', title: 'Reduce unsheltered homelessness', href: './unhoused/', eyebrow: 'Unhoused presence',
    dataPath: './unhoused/data/aggregates.json', signal: 'encampment', goal: 'down' },
  { id: 'theft', title: 'Restore merchant confidence', href: './theft/', eyebrow: 'Theft from merchants',
    dataPath: './theft/data/aggregates.json', signal: 'shoplifting', goal: 'down' },
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

function getKPIs(okr, district) {
  const data = aggregatesData[okr.id];
  if (!data) return null;

  const signal = data.signals?.[okr.signal];
  if (!signal) return null;

  // Handle different data structures:
  // - drug/unhoused: signal.series[district]
  // - theft: signal[district.toLowerCase()].reported (Northern-only dataset)
  let series = signal.series?.[district];
  let label = signal.label || okr.signal;

  if (!series) {
    // Try theft format
    const districtKey = district.toLowerCase();
    series = signal[districtKey]?.reported;
  }

  if (!series || series.length < 13) return null;

  // Get values for different periods (excluding current partial month)
  const len = series.length;
  const hasPartial = data.current_partial_month != null;
  const endIdx = hasPartial ? len - 1 : len;

  const last1 = series[endIdx - 1] || 0;
  const last3 = sumLast(series.slice(0, endIdx), 3);
  const last12 = sumLast(series.slice(0, endIdx), 12);

  // Compare to same periods from prior year
  const prior1 = series[endIdx - 13] || 0;
  const prior3 = sumLast(series.slice(0, endIdx - 12), 3);
  const prior12 = sumLast(series.slice(0, endIdx - 12), 12);

  return {
    label,
    goal: okr.goal,
    periods: [
      { label: 'Last month', value: last1, change: pctChange(last1, prior1) },
      { label: '3 months', value: last3, change: pctChange(last3, prior3) },
      { label: '12 months', value: last12, change: pctChange(last12, prior12) },
    ]
  };
}

function renderKPIBadge(period, goal) {
  if (period.change === null) return '';
  const isGood = (goal === 'down' && period.change < 0) || (goal === 'up' && period.change > 0);
  const isFlat = period.change === 0;
  const cls = isFlat ? 'kpi-flat' : (isGood ? 'kpi-good' : 'kpi-bad');
  const arrow = period.change > 0 ? '↑' : (period.change < 0 ? '↓' : '→');
  return `<span class="kpi-change ${cls}">${arrow}${Math.abs(period.change)}% vs last year</span>`;
}

function renderKPIs(kpis) {
  if (!kpis) return '';
  return `
    <div class="kpi-row">
      ${kpis.periods.map(p => `
        <div class="kpi-cell">
          <span class="kpi-value">${p.value?.toLocaleString() ?? '—'}</span>
          <span class="kpi-label">${p.label}</span>
          ${renderKPIBadge(p, kpis.goal)}
        </div>
      `).join('')}
    </div>
  `;
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
      ${OKRS.map(o => {
        const kpis = getKPIs(o, currentDistrict);
        return `
          <a class="okr-card" href="${o.href}">
            <div class="okr-card__body">
              <span class="okr-card__eyebrow">${esc(o.eyebrow)}</span>
              <h3 class="okr-card__title">${esc(o.title)}</h3>
              ${kpis ? `<p class="okr-card__signal">${esc(kpis.label)}</p>` : ''}
              ${renderKPIs(kpis)}
            </div>
            <wa-icon class="okr-card__arrow" name="arrow-right" label="Open dashboard"></wa-icon>
          </a>
        `;
      }).join('')}
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
    // Load interventions and aggregates in parallel
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
