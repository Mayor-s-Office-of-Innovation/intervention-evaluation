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
