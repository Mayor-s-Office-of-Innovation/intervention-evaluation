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

// Photo serve URLs from the API are ORIGIN-RELATIVE (e.g. `/photos/:id/:pid?v=thumb`); join them
// with the API base so images resolve against whatever Worker this client points at (prod or local).
export const photoSrc = rel => (rel ? `${API}${rel}` : '');

// ──────────────────────────────────────────────────────────────────────────
// Photo UPLOAD widget — a SEPARATE, Cloudflare-Access-gated Worker on its own domain. Viewing photos
// is public (served by the API above); uploading/managing them happens in this widget, which we open
// in a new tab. Local dev: set  localStorage.photoWidget = 'http://localhost:8788'  (and clear it to
// go back to prod). See docs/plan-photo-uploads.md.
const PROD_PHOTO_WIDGET = 'https://photos.sfinterventionassets.org';
export const PHOTO_WIDGET = (() => {
  try { return localStorage.getItem('photoWidget') || PROD_PHOTO_WIDGET; } catch { return PROD_PHOTO_WIDGET; }
})();

// Open the Access-gated widget for one intervention in a new tab. Named so repeat clicks reuse the
// tab. Deliberately NO `noopener` — the widget needs its `window.opener` reference to post back when
// photos change (see onPhotosUpdated).
export function openPhotoWidget(id) {
  return window.open(`${PHOTO_WIDGET}/?intervention=${encodeURIComponent(id)}`, 'intervention-photos');
}

// Subscribe to the widget's "photos changed" pings. The widget posts
//   { type: 'photos-updated', intervention: <id> }
// to window.opener after every upload/delete. We verify the message ORIGIN (=== the widget's origin)
// and shape before invoking handler(interventionId). Returns an unsubscribe fn.
export function onPhotosUpdated(handler) {
  let origin = null;
  try { origin = new URL(PHOTO_WIDGET).origin; } catch { /* leave null → accept any origin */ }
  const listener = e => {
    if (origin && e.origin !== origin) return;
    const d = e.data;
    if (d && d.type === 'photos-updated' && d.intervention) handler(d.intervention);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

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
