// ──────────────────────────────────────────────────────────────────────────
// Shared client for the interventions-api Worker (../interventions-api/).
// One place to set the deployed Worker URL after `wrangler deploy`.
// Used by the homepage interventions table (js/app.js) and the hypothesis tool's
// Save button (hypothesis/js/save.js).
// ──────────────────────────────────────────────────────────────────────────

// Default to the deployed Worker everywhere — including local dev — so viewing/saving works without
// running `wrangler dev`. To develop against a LOCAL worker, set in the browser console:
//   localStorage.interventionsApi = 'http://localhost:8787'   (and clear it to go back to prod)
const PROD_API = 'https://interventions-api.safestreetssf.workers.dev';
export const API = (() => {
  try { return localStorage.getItem('interventionsApi') || PROD_API; } catch { return PROD_API; }
})();

export async function listInterventions() {
  const res = await fetch(`${API}/interventions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).items;
}

export async function saveIntervention(url, email) {
  const res = await fetch(`${API}/interventions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data; // { id, item }
}

export async function deleteIntervention(id) {
  const res = await fetch(`${API}/interventions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getIntervention(id) {
  const res = await fetch(`${API}/interventions/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).item;
}

export async function createFullIntervention(data) {
  const res = await fetch(`${API}/interventions/full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json; // { id, item }
}

export async function updateIntervention(id, data) {
  const res = await fetch(`${API}/interventions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json; // { item }
}

export async function closeIntervention(id) {
  const res = await fetch(`${API}/interventions/${encodeURIComponent(id)}/close`, { method: 'POST' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json; // { item }
}

export async function reopenIntervention(id) {
  const res = await fetch(`${API}/interventions/${encodeURIComponent(id)}/reopen`, { method: 'POST' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json; // { item }
}

export async function uploadAttachment(interventionId, file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API}/interventions/${encodeURIComponent(interventionId)}/attachments`, {
    method: 'POST',
    body: formData,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json; // { attachment }
}

export async function listAttachments(interventionId) {
  const res = await fetch(`${API}/interventions/${encodeURIComponent(interventionId)}/attachments`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).attachments;
}

export function getAttachmentUrl(interventionId, filename) {
  return `${API}/interventions/${encodeURIComponent(interventionId)}/attachments/${encodeURIComponent(filename)}`;
}
