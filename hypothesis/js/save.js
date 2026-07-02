// ──────────────────────────────────────────────────────────────────────────
// "Save this intervention" — POSTs the current report URL (which carries the full state) + a city
// email to the interventions-api Worker, so it shows on the homepage list. The email is recorded for
// accountability (unverified, server-side only). See ../../docs/plan-saved-interventions.md.
// ──────────────────────────────────────────────────────────────────────────
import { saveIntervention } from '../../js/interventions-client.js';

const $ = id => document.getElementById(id);
const EMAIL_KEY = 'intervention-save-email';

const sentence = s => { s = (s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const currentWhat = () => {
  const fromInput = ($('in-what')?.value || '').trim();
  if (fromInput) return fromInput;
  return (new URLSearchParams(location.search).get('what') || '').trim();
};

function openDialog() {
  const dialog = $('save-dialog');
  $('save-preview').textContent = sentence(currentWhat()) || 'this evaluation';
  const err = $('save-error');
  err.hidden = true; err.textContent = '';
  const email = $('save-email');
  try { email.value = localStorage.getItem(EMAIL_KEY) || ''; } catch { /* ignore */ }
  dialog.showModal();
  email.focus();
}

async function doSave() {
  const email = $('save-email');
  const err = $('save-error');
  if (!email.checkValidity()) { email.reportValidity(); return; }

  if (!currentWhat()) {
    err.textContent = 'Add a “What did you do?” description first — it becomes the saved link’s text.';
    err.hidden = false;
    return;
  }

  const submit = $('save-submit');
  submit.loading = true; submit.disabled = true;
  err.hidden = true;
  try {
    await saveIntervention(location.href, email.value.trim());
    try { localStorage.setItem(EMAIL_KEY, email.value.trim()); } catch { /* ignore */ }
    $('save-dialog').close();
    const status = $('copy-status');
    if (status) {
      status.textContent = '✓ Saved — it now appears on the homepage’s saved evaluations.';
      status.classList.remove('copy-status--error');
    }
  } catch (e) {
    err.textContent = `Couldn’t save: ${e.message}`;
    err.hidden = false;
  } finally {
    submit.loading = false; submit.disabled = false;
  }
}

function wire() {
  const btn = $('save-btn');
  if (!btn) return;
  btn.addEventListener('click', openDialog);
  $('save-cancel').addEventListener('click', () => $('save-dialog').close());
  // Intercept submit (Enter in the field or the Save button) — POST instead of closing the dialog.
  $('save-form').addEventListener('submit', e => { e.preventDefault(); doSave(); });
  $('save-submit').addEventListener('click', e => { e.preventDefault(); doSave(); });
}

wire();
