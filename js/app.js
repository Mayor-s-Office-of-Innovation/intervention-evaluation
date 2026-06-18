import { parseTSV, groupBy } from './tsv.js';

const DISTRICTS = ['Northern', 'Central', 'Mission', 'Tenderloin'];

const OKRS = [
  { id: 'drug', title: 'Reduce visible disorder: Drugs', href: './drug/', eyebrow: 'Drug activity' },
  { id: 'unhoused', title: 'Reduce unsheltered homelessness', href: './unhoused/', eyebrow: 'Unhoused presence' },
  { id: 'theft', title: 'Restore merchant confidence', href: './theft/', eyebrow: 'Theft from merchants' },
];

const STATUS_LABELS = { active: 'Active', completed: 'Completed', planned: 'Planned' };
const WORKING_LABELS = { yes: 'Working', no: 'Not working', inconclusive: 'Inconclusive' };

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderOKRCards() {
  return OKRS.map(o => `
    <a class="okr-card okr-card--mini" href="${o.href}">
      <div class="okr-card__body">
        <span class="okr-card__eyebrow">${esc(o.eyebrow)}</span>
        <h3 class="okr-card__title">${esc(o.title)}</h3>
      </div>
      <wa-icon class="okr-card__arrow" name="arrow-right" label="Open dashboard"></wa-icon>
    </a>
  `).join('');
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

function renderDistrict(name, interventions, expanded = false) {
  const count = interventions.length;
  const countText = count === 1 ? '1 intervention' : `${count} interventions`;

  return `
    <section class="district-section${expanded ? ' is-expanded' : ''}">
      <button class="district-header" aria-expanded="${expanded}" type="button">
        <h2>${esc(name)}</h2>
        <span class="district-header__count">${countText}</span>
        <wa-icon name="chevron-down" class="district-header__icon"></wa-icon>
      </button>
      <div class="district-body">
        <div class="district-cols">
          <div class="district-okrs">
            <p class="section-label">Objectives</p>
            <div class="okr-grid okr-grid--mini">
              ${renderOKRCards()}
            </div>
          </div>
          <div class="district-interventions">
            <p class="section-label">Interventions</p>
            ${count > 0 ? `
              <ul class="intervention-list">
                ${interventions.map(renderIntervention).join('')}
              </ul>
            ` : '<p class="intervention-empty">No interventions recorded yet.</p>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function wireAccordions(container) {
  container.querySelectorAll('.district-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.district-section');
      const expanded = section.classList.toggle('is-expanded');
      btn.setAttribute('aria-expanded', expanded);
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
    const byDistrict = groupBy(interventions, 'district');

    container.innerHTML = DISTRICTS.map((d, i) =>
      renderDistrict(d, byDistrict[d] || [], i === 0)
    ).join('');

    wireAccordions(container);
  } catch (err) {
    console.error('Failed to load interventions:', err);
    container.innerHTML = '<p class="error">Failed to load intervention data.</p>';
  }
}

init();
