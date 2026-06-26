// ──────────────────────────────────────────────────────────────────────────
// Shared client for the interventions-api Worker (../interventions-api/).
// One place to set the deployed Worker URL after `wrangler deploy`.
// Used by the homepage list (js/saved-interventions.js) and the hypothesis tool's
// Save button (hypothesis/js/save.js).
// ──────────────────────────────────────────────────────────────────────────

const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
export const API = isLocal
  ? 'http://localhost:8787'
  : 'https://interventions-api.safestreetssf.workers.dev';

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
