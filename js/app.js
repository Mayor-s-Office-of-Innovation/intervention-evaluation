import { parseTSV, groupBy } from './tsv.js';

const DISTRICTS = ['Northern', 'Central', 'Mission', 'Tenderloin'];

const OKRS = [
  { id: 'drug', title: 'Reduce visible disorder: Drugs', href: './drug/', eyebrow: 'Drug activity' },
  { id: 'unhoused', title: 'Reduce unsheltered homelessness', href: './unhoused/', eyebrow: 'Unhoused presence' },
  { id: 'theft', title: 'Restore merchant confidence', href: './theft/', eyebrow: 'Theft from merchants' },
];

const STATUS_LABELS = { active: 'Active', completed: 'Completed', planned: 'Planned' };
const WORKING_LABELS = { yes: 'Working', no: 'Not working', inconclusive: 'Inconclusive' };

let currentDistrict = DISTRICTS[0];
let currentTab = 'okrs';
let interventionsByDistrict = {};

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

async function init() {
  const container = document.getElementById('districts-container');
  if (!container) return;

  try {
    const res = await fetch('./data/interventions.tsv');
    const text = await res.text();
    const interventions = parseTSV(text);
    interventionsByDistrict = groupBy(interventions, 'district');

    render(container);
  } catch (err) {
    console.error('Failed to load interventions:', err);
    container.innerHTML = '<p class="error">Failed to load intervention data.</p>';
  }
}

init();
