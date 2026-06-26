// ──────────────────────────────────────────────────────────────────────────
// Saved-interventions API — Cloudflare Worker + KV (../plan-saved-interventions.md).
//
// Public writes, guarded NOT by auth but by: an origin allowlist (a saved URL must be one of THIS
// site's own /hypothesis/ links — the main spam defense) and length caps. A city email is collected
// and RECORDED but not enforced (a deterrent + audit trail; "crack down later"). Email is PII →
// stored server-side only, NEVER returned by the public list.
//
// KV layout (one key per item, avoids the read-modify-write race of a single JSON blob):
//   intervention:<id> → { url, created, deleted:false, email, cityEmailGuess }
//   deleted:<id>      → { ...,  deleted:true, deletedAt }     (soft delete — retained, recoverable)
//
// Endpoints:
//   GET    /interventions       → { items: [{ id, url, what, dp, date, created }] }  (active, newest first)
//   POST   /interventions       → { url, email } → validate → 201 { id, item }
//   DELETE /interventions/:id   → soft delete → 200 { ok:true }  (idempotent)
// ──────────────────────────────────────────────────────────────────────────

import DISTRICTS from "./districts.js";   // [{district, rings:[[[lng,lat],…]]}] — 4 target SF districts

const ACTIVE = "intervention:";
const DELETED = "deleted:";

// ── district from a pin (point-in-polygon) — ports build/02_assign.py's verified ray-casting ──
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Police district for a pin, or "Other" if outside the 4 target districts / coords missing. */
export function districtFor(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "Other";
  for (const d of DISTRICTS) {
    for (const ring of d.rings) if (pointInRing(lng, lat, ring)) return d.district;
  }
  return "Other";
}

/** Pull lat/lng out of a saved hypothesis URL (params are `lat` / `lng`). */
function coordsOf(urlStr) {
  try {
    const q = new URL(urlStr).searchParams;
    return { lat: parseFloat(q.get("lat")), lng: parseFloat(q.get("lng")) };
  } catch {
    return { lat: NaN, lng: NaN };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get("Origin") || "", env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/interventions") {
        if (request.method === "GET") return json(await listActive(env), 200, cors);
        if (request.method === "POST") return await create(request, env, cors);
        return json({ error: "method not allowed" }, 405, cors);
      }
      const m = url.pathname.match(/^\/interventions\/([A-Za-z0-9-]+)$/);
      if (m) {
        if (request.method === "DELETE") return await softDelete(m[1], env, cors);
        return json({ error: "method not allowed" }, 405, cors);
      }
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: e.message || "server error" }, 500, cors);
    }
  },
};

// ── CORS: reflect the request Origin only if it's allowlisted ──
function corsHeaders(origin, env) {
  const allowed = listVar(env.ALLOWED_ORIGINS);
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

const listVar = v => (v || "").split(",").map(s => s.trim()).filter(Boolean);

// ── public projection: derive what/dp/date/district from the saved URL; NEVER expose email ──
function publicItem(id, rec) {
  let what = null, dp = null, date = null;
  try {
    const q = new URL(rec.url).searchParams;
    what = q.get("what");
    dp = q.get("dp");
    date = q.get("date");
  } catch { /* malformed url — leave fields null */ }
  // Prefer the stored district; fall back to computing it (back-compat for pre-Phase-1 records).
  const { lat, lng } = coordsOf(rec.url);
  const district = rec.district || districtFor(lat, lng);
  return { id, url: rec.url, what, dp, date, district, created: rec.created };
}

async function listActive(env) {
  const { keys } = await env.INTERVENTIONS.list({ prefix: ACTIVE });
  const recs = await Promise.all(keys.map(async k => {
    const rec = await env.INTERVENTIONS.get(k.name, "json");
    return rec && !rec.deleted ? publicItem(k.name.slice(ACTIVE.length), rec) : null;
  }));
  const items = recs.filter(Boolean).sort((a, b) => (a.created < b.created ? 1 : -1));
  return { items };
}

async function create(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400, cors); }

  const urlStr = typeof body.url === "string" ? body.url.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  const urlErr = validateUrl(urlStr, env);
  if (urlErr) return json({ error: urlErr }, 400, cors);
  if (!isEmail(email) || email.length > 254) return json({ error: "a valid email is required" }, 400, cors);

  const cityDomain = (env.CITY_EMAIL_DOMAIN || "").toLowerCase();
  const cityEmailGuess = !!cityDomain && email.toLowerCase().endsWith("@" + cityDomain);

  const { lat, lng } = coordsOf(urlStr);
  const district = districtFor(lat, lng);   // computed from the pin, stored on the record

  const id = crypto.randomUUID();
  const rec = { url: urlStr, created: new Date().toISOString(), deleted: false, email, cityEmailGuess, district };
  await env.INTERVENTIONS.put(ACTIVE + id, JSON.stringify(rec));
  return json({ id, item: publicItem(id, rec) }, 201, cors);
}

async function softDelete(id, env, cors) {
  const key = ACTIVE + id;
  const rec = await env.INTERVENTIONS.get(key, "json");
  if (!rec) return json({ ok: true }, 200, cors); // already gone → idempotent
  const tomb = { ...rec, deleted: true, deletedAt: new Date().toISOString() };
  await env.INTERVENTIONS.put(DELETED + id, JSON.stringify(tomb)); // retained (recoverable)
  await env.INTERVENTIONS.delete(key);
  return json({ ok: true }, 200, cors);
}

// ── validation ──────────────────────────────────────────────────────────
function validateUrl(urlStr, env) {
  if (!urlStr) return "url is required";
  if (urlStr.length > 2048) return "url too long";
  let u;
  try { u = new URL(urlStr); } catch { return "url is not valid"; }
  if (!listVar(env.ALLOWED_ORIGINS).includes(u.origin)) return "url must be from this site";
  if (!u.pathname.includes(env.REQUIRED_PATH || "/hypothesis/")) return "url must be a hypothesis-tool link";
  if (!u.searchParams.get("what")) return "url must include an intervention (the 'what' param)";
  return null;
}

const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
