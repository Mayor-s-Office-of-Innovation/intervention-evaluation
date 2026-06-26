// ──────────────────────────────────────────────────────────────────────────
// Homepage "Saved intervention evaluations" — rendered from the interventions-api Worker, filtered by
// the active district (Phase 1, plan-interventions-by-district-phase1.md) with soft-delete. Each row
// shows the fields derivable from the saved URL: name · Target KR (dp) · Started (date).
// Progressive enhancement: if the API is unreachable the existing static <li> stays.
// ──────────────────────────────────────────────────────────────────────────
import { listInterventions, deleteIntervention } from './interventions-client.js';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sentence = s => { s = (s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };

// Target KR label per datapoint — mirrors the titles in hypothesis/js/datapoints.js.
const KR_LABEL = {
  drug: 'Drug-related complaints',
  overflow: 'Overflowing trash cans',
  dumping: 'Illegal dumping',
  hazard: 'Health-hazard waste',
  homeless_presence: 'Homelessness presence',
};
const krFor = dp => KR_LABEL[dp] || (dp ? sentence(dp) : null);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : null;
}

let activeDistrict = 'Northern';   // matches the homepage's default district tab
let allItems = null;               // null = not loaded yet → keep the static fallback

const labelFor = item => sentence(item.what) || 'Saved intervention';

function rowHTML(item) {
  const name = esc(labelFor(item));
  const meta = [krFor(item.dp), fmtDate(item.date) && `Started ${fmtDate(item.date)}`]
    .filter(Boolean).map(esc).join(' · ');
  return `<li class="saved-evals__item">
    <a class="saved-eval" href="${esc(item.url)}">
      <wa-icon class="saved-eval__icon" name="bookmark"></wa-icon>
      <span class="saved-eval__body">
        <span class="saved-eval__name">${name}</span>
        ${meta ? `<span class="saved-eval__meta">${meta}</span>` : ''}
      </span>
      <wa-icon class="saved-eval__arrow" name="arrow-right" label="Open evaluation"></wa-icon>
    </a>
    <button class="saved-eval__delete" type="button" data-id="${esc(item.id)}" aria-label="Remove ${name}" title="Remove">
      <wa-icon name="trash" label=""></wa-icon>
    </button>
  </li>`;
}

const emptyHTML = () => `<li class="saved-evals__empty">No saved evaluations in ${esc(activeDistrict)} yet.</li>`;

function render() {
  const ul = document.querySelector('.saved-evals');
  if (!ul || allItems === null) return;   // not loaded → leave the static fallback in place
  const items = allItems.filter(i => (i.district || 'Other') === activeDistrict);
  ul.innerHTML = items.length ? items.map(rowHTML).join('') : emptyHTML();
  wire(ul);
}

function wire(ul) {
  ul.querySelectorAll('.saved-eval__delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.closest('li').querySelector('.saved-eval__name')?.textContent || 'this evaluation';
      if (!confirm(`Remove "${name}"?`)) return;
      btn.disabled = true;
      try {
        await deleteIntervention(btn.dataset.id);
        allItems = allItems.filter(i => i.id !== btn.dataset.id);
        render();
      } catch (e) {
        btn.disabled = false;
        alert('Could not remove — please try again.');
      }
    });
  });
}

async function load() {
  try {
    allItems = await listInterventions();
  } catch (e) {
    // Progressive enhancement: keep the static fallback <li> already in the markup.
    console.warn('saved-interventions: API unreachable, keeping static list —', e.message);
    return;
  }
  render();
}

// Re-filter when the homepage's district tab changes (js/app.js dispatches this, incl. on load).
document.addEventListener('districtchange', e => {
  const d = e.detail?.district;
  if (d) { activeDistrict = d; render(); }
});

load();
