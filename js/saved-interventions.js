// ──────────────────────────────────────────────────────────────────────────
// Homepage "Saved intervention evaluations" — rendered from the interventions-api Worker, with
// soft-delete. Progressive enhancement: if the API is unreachable the existing static <li> stays.
// See ../plan-saved-interventions.md and ../interventions-api/.
// ──────────────────────────────────────────────────────────────────────────
import { listInterventions, deleteIntervention } from './interventions-client.js';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Link text = the URL's `what`, sentence-cased: "plain clothes officer deployment in Hayes"
// → "Plain clothes officer deployment in Hayes" (preserves embedded capitals like "Hayes").
const sentence = s => { s = (s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const labelFor = item => sentence(item.what) || 'Saved intervention';

function rowHTML(item) {
  const name = esc(labelFor(item));
  return `<li class="saved-evals__item">
    <a class="saved-eval" href="${esc(item.url)}">
      <wa-icon class="saved-eval__icon" name="bookmark"></wa-icon>
      <span class="saved-eval__name">${name}</span>
      <wa-icon class="saved-eval__arrow" name="arrow-right" label="Open evaluation"></wa-icon>
    </a>
    <button class="saved-eval__delete" type="button" data-id="${esc(item.id)}" aria-label="Remove ${name}" title="Remove">
      <wa-icon name="trash" label=""></wa-icon>
    </button>
  </li>`;
}

const emptyHTML = '<li class="saved-evals__empty">No saved evaluations yet.</li>';

async function load() {
  const ul = document.querySelector('.saved-evals');
  if (!ul) return;
  let items;
  try {
    items = await listInterventions();
  } catch (e) {
    // Progressive enhancement: keep the static fallback <li> already in the markup.
    console.warn('saved-interventions: API unreachable, keeping static list —', e.message);
    return;
  }
  ul.innerHTML = items.length ? items.map(rowHTML).join('') : emptyHTML;
  wire(ul);
}

function wire(ul) {
  ul.querySelectorAll('.saved-eval__delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const name = li.querySelector('.saved-eval__name')?.textContent || 'this evaluation';
      if (!confirm(`Remove "${name}"?`)) return;
      btn.disabled = true;
      try {
        await deleteIntervention(btn.dataset.id);
        li.remove();
        if (!ul.querySelector('.saved-evals__item')) ul.innerHTML = emptyHTML;
      } catch (e) {
        btn.disabled = false;
        alert('Could not remove — please try again.');
      }
    });
  });
}

load();
