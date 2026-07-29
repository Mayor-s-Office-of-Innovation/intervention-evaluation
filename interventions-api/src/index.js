// ──────────────────────────────────────────────────────────────────────────
// Saved-interventions API — Cloudflare Worker + KV (../docs/plan-saved-interventions.md).
//
// Public writes, guarded NOT by auth but by: an origin allowlist and length caps.
// A city email is collected and RECORDED but not enforced (a deterrent + audit trail).
// Email is PII → stored server-side only, NEVER returned by the public list.
//
// KV layout (one key per item, avoids the read-modify-write race of a single JSON blob):
//   intervention:<id> → { full record with all tracker fields }
//   deleted:<id>      → { ..., deleted:true, deletedAt }     (soft delete — retained, recoverable)
//   counter:<district> → number (for auto-ID generation)
//
// Endpoints:
//   GET    /interventions           → { items: [...] }  (active, newest first)
//   POST   /interventions           → { url, email } → validate → 201 { id, item } (legacy, URL-based)
//   POST   /interventions/full      → { full tracker fields } → 201 { id, item }
//   GET    /interventions/:id       → { item }
//   PATCH  /interventions/:id       → { partial update } → 200 { item }
//   POST   /interventions/:id/close → 200 { item } (sets status=closed, end_date=now)
//   POST   /interventions/:id/reopen→ 200 { item } (sets status=open)
//   DELETE /interventions/:id       → soft delete → 200 { ok:true }  (idempotent)
//   GET    /photos/:id/:photoId?v=thumb|full → image bytes from R2 (immutable cache)
//
// Supporting documents (Drive, SharePoint, …) are referenced by URL in the record's `links` array.
// Photos ARE stored here, in the R2 `PHOTOS` bucket: this Worker only reads/serves them; a separate
// Access-gated upload Worker is the sole writer (../docs/plan-photo-uploads.md).
// ──────────────────────────────────────────────────────────────────────────

import DISTRICTS from "./districts.js";   // [{district, rings:[[[lng,lat],…]]}] — 4 target SF districts

const ACTIVE = "intervention:";
const DELETED = "deleted:";
const COUNTER = "counter:";

// District prefixes for auto-ID generation
const DISTRICT_PREFIX = {
  Central: 'CEN',
  Northern: 'NOR',
  Mission: 'MIS',
  Tenderloin: 'TEN',
  Other: 'OTH',
};

// Valid status values
const VALID_STATUSES = ['open_in_progress', 'closed_completed', 'at_risk_on_hold'];

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
      // GET /photos/:interventionId/:photoId?v=thumb|full — serve image bytes from R2
      const photoMatch = url.pathname.match(/^\/photos\/([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)$/);
      if (photoMatch) {
        if (request.method === "GET") return await servePhoto(photoMatch[1], photoMatch[2], url.searchParams.get("v"), env, cors);
        return json({ error: "method not allowed" }, 405, cors);
      }

      // GET/POST /interventions
      if (url.pathname === "/interventions") {
        if (request.method === "GET") return json(await listActive(env), 200, cors);
        if (request.method === "POST") return await create(request, env, cors);
        return json({ error: "method not allowed" }, 405, cors);
      }

      // POST /interventions/full - create with all tracker fields
      if (url.pathname === "/interventions/full") {
        if (request.method === "POST") return await createFull(request, env, cors);
        return json({ error: "method not allowed" }, 405, cors);
      }

      // Match /interventions/:id/close or /interventions/:id/reopen
      const actionMatch = url.pathname.match(/^\/interventions\/([A-Za-z0-9-]+)\/(close|reopen)$/);
      if (actionMatch) {
        const [, id, action] = actionMatch;
        if (request.method === "POST") {
          return action === "close"
            ? await closeIntervention(id, env, cors)
            : await reopenIntervention(id, env, cors);
        }
        return json({ error: "method not allowed" }, 405, cors);
      }

      // Match /interventions/:id
      const m = url.pathname.match(/^\/interventions\/([A-Za-z0-9-]+)$/);
      if (m) {
        const id = m[1];
        if (request.method === "GET") return await getOne(id, env, cors);
        if (request.method === "PATCH") return await update(id, request, env, cors);
        if (request.method === "DELETE") return await softDelete(id, env, cors);
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
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

const listVar = v => (v || "").split(",").map(s => s.trim()).filter(Boolean);

// ── public projection: return all tracker fields; NEVER expose email ──
function publicItem(id, rec) {
  // For legacy records (URL-only), derive fields from URL params
  let what = rec.intervention || null;
  let dp = rec.levers?.[0] || null;
  let date = rec.start_date || null;

  if (!what && rec.url) {
    try {
      const q = new URL(rec.url).searchParams;
      what = q.get("what");
      dp = q.get("dp");
      date = q.get("date");
    } catch { /* malformed url — leave fields null */ }
  }

  // Prefer the stored district; fall back to computing it (back-compat for pre-Phase-1 records).
  const { lat, lng } = coordsOf(rec.url || "");
  const district = rec.district || districtFor(lat, lng);

  return {
    id,
    intervention_id: rec.intervention_id || null,
    url: rec.url || null,
    what,
    dp,
    date,
    district,
    created: rec.created,
    // Full tracker fields
    intervention: rec.intervention || what || null,
    description: rec.description || null,
    evidence: rec.evidence || null,
    tactics: rec.tactics || null,
    owner: rec.owner || null,
    agencies: rec.agencies || null,
    levers: rec.levers || (dp ? [dp] : []),
    status: rec.status || 'open_in_progress',
    start_date: rec.start_date || date || null,
    end_date: rec.end_date || null,
    roadblock: rec.roadblock || null,
    outcomes: rec.outcomes || null,
    notes: rec.notes || null,
    person_submitted: rec.person_submitted || null,
    last_edited: rec.last_edited || rec.created,
    last_edited_by: rec.last_edited_by || null,
    links: rec.links || [],
    lat: rec.lat || lat || null,
    lng: rec.lng || lng || null,
    radius: rec.radius || null,
    // Photos: derived, ORIGIN-RELATIVE serve URLs (the client joins them with its API base, which keeps
    // local dev correct). `uploaded_by` is a verified @sfgov.org email → PII, NEVER projected publicly.
    photos: (rec.photos || []).map(p => ({
      id: p.id,
      w: p.w || null,
      h: p.h || null,
      caption: p.caption || null,
      uploaded_at: p.uploaded_at || null,
      thumb: `/photos/${id}/${p.id}?v=thumb`,
      full: `/photos/${id}/${p.id}?v=full`,
    })),
  };
}

/** Generate next auto-ID for a district (e.g., CEN001, CEN002).
 * KV has no atomic increment/CAS, so a bare read-modify-write counter can hand the same
 * number to two concurrent creates. We mitigate by claiming a per-id marker key and bumping
 * past any already-claimed number; if we can't secure a sequential id (heavy contention),
 * we fall back to a guaranteed-unique random suffix so two records never share an id.
 * (For a hard guarantee under real concurrency, this counter would need a Durable Object.) */
async function nextId(district, env) {
  const prefix = DISTRICT_PREFIX[district] || DISTRICT_PREFIX.Other;
  const counterKey = COUNTER + prefix;

  let current = parseInt(await env.INTERVENTIONS.get(counterKey) || "0", 10);
  for (let attempt = 0; attempt < 20; attempt++) {
    const next = current + 1;
    const candidate = `${prefix}${String(next).padStart(3, "0")}`;
    const claimKey = `${COUNTER}claim:${candidate}`;
    if (await env.INTERVENTIONS.get(claimKey) === null) {
      await env.INTERVENTIONS.put(claimKey, "1");
      await env.INTERVENTIONS.put(counterKey, String(next));
      return candidate;
    }
    current = next; // someone already took this number — try the next one
  }

  // Couldn't claim a sequential id — return a collision-proof fallback rather than a duplicate.
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
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

/** GET /interventions/:id — fetch a single intervention */
async function getOne(id, env, cors) {
  const rec = await env.INTERVENTIONS.get(ACTIVE + id, "json");
  if (!rec || rec.deleted) return json({ error: "not found" }, 404, cors);
  return json({ item: publicItem(id, rec) }, 200, cors);
}

/** GET /photos/:interventionId/:photoId?v=thumb|full — stream image bytes from R2.
 * Photo ids are unique + content is immutable, so cache hard. The R2 key is reconstructed from
 * the path params, so we don't need to read KV here. Defaults to the full-size variant. */
async function servePhoto(interventionId, photoId, variant, env, cors) {
  const v = variant === "thumb" ? "thumb" : "full";
  const key = `photos/${interventionId}/${photoId}-${v}.jpg`;
  const obj = await env.PHOTOS.get(key);
  if (!obj) return json({ error: "not found" }, 404, cors);

  const headers = new Headers(cors);
  obj.writeHttpMetadata(headers);                 // content-type from stored metadata
  headers.set("Content-Type", obj.httpMetadata?.contentType || "image/jpeg");
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

/** POST /interventions/full — create with all tracker fields */
async function createFull(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400, cors); }

  // Required fields
  const intervention = typeof body.intervention === "string" ? body.intervention.trim() : "";
  const person_submitted = truncate(body.person_submitted, 200);
  const district = typeof body.district === "string" ? body.district.trim() : "";
  // Email is optional here (the form collects a name, not an email). Recorded only if a real
  // one is provided — never fabricated. The legacy URL-based create() still requires it.
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!intervention) return json({ error: "intervention title is required" }, 400, cors);
  if (intervention.length > 500) return json({ error: "intervention title too long (max 500)" }, 400, cors);
  if (!person_submitted) return json({ error: "your name is required" }, 400, cors);
  if (email && (!isEmail(email) || email.length > 254)) return json({ error: "email is not valid" }, 400, cors);
  if (!district || !DISTRICT_PREFIX[district]) return json({ error: "valid district is required" }, 400, cors);

  // Validate status if provided
  const status = body.status || "open_in_progress";
  if (!VALID_STATUSES.includes(status)) return json({ error: "invalid status" }, 400, cors);

  // Validate levers array if provided
  let levers = [];
  if (Array.isArray(body.levers)) {
    levers = body.levers.filter(l => typeof l === "string" && l.trim()).slice(0, 10);
  }

  const cityDomain = (env.CITY_EMAIL_DOMAIN || "").toLowerCase();
  const cityEmailGuess = !!email && !!cityDomain && email.toLowerCase().endsWith("@" + cityDomain);

  const id = crypto.randomUUID();
  const intervention_id = await nextId(district, env);
  const now = new Date().toISOString();

  const rec = {
    intervention_id,
    intervention,
    description: truncate(body.description, 5000),
    evidence: truncate(body.evidence, 5000),
    tactics: truncate(body.tactics, 2000),
    owner: truncate(body.owner, 200),
    agencies: truncate(body.agencies, 500),
    levers,
    status,
    start_date: body.start_date || now.slice(0, 10),
    end_date: body.end_date || null,
    roadblock: truncate(body.roadblock, 2000),
    outcomes: truncate(body.outcomes, 2000),
    notes: truncate(body.notes, 2000),
    links: sanitizeLinks(body.links),
    district,
    lat: typeof body.lat === "number" ? body.lat : null,
    lng: typeof body.lng === "number" ? body.lng : null,
    radius: typeof body.radius === "number" ? body.radius : null,
    url: body.url || null,
    created: now,
    deleted: false,
    email: email || null,
    cityEmailGuess,
    person_submitted,
    last_edited: now,
    last_edited_by: person_submitted,
    photos: [],   // managed by the Access-gated upload Worker, not via this create/PATCH path
  };

  await env.INTERVENTIONS.put(ACTIVE + id, JSON.stringify(rec));
  return json({ id, item: publicItem(id, rec) }, 201, cors);
}

/** PATCH /interventions/:id — update fields */
async function update(id, request, env, cors) {
  const key = ACTIVE + id;
  const rec = await env.INTERVENTIONS.get(key, "json");
  if (!rec || rec.deleted) return json({ error: "not found" }, 404, cors);

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400, cors); }

  // Updatable fields with validation
  if (body.intervention !== undefined) rec.intervention = truncate(body.intervention, 500);
  if (body.description !== undefined) rec.description = truncate(body.description, 5000);
  if (body.evidence !== undefined) rec.evidence = truncate(body.evidence, 5000);
  if (body.tactics !== undefined) rec.tactics = truncate(body.tactics, 2000);
  if (body.owner !== undefined) rec.owner = truncate(body.owner, 200);
  if (body.agencies !== undefined) rec.agencies = truncate(body.agencies, 500);
  if (body.roadblock !== undefined) rec.roadblock = truncate(body.roadblock, 2000);
  if (body.outcomes !== undefined) rec.outcomes = truncate(body.outcomes, 2000);
  if (body.notes !== undefined) rec.notes = truncate(body.notes, 2000);
  if (body.links !== undefined) rec.links = sanitizeLinks(body.links);
  if (body.start_date !== undefined) rec.start_date = body.start_date;
  if (body.end_date !== undefined) rec.end_date = body.end_date;

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) return json({ error: "invalid status" }, 400, cors);
    rec.status = body.status;
  }

  if (Array.isArray(body.levers)) {
    rec.levers = body.levers.filter(l => typeof l === "string" && l.trim()).slice(0, 10);
  }

  if (typeof body.lat === "number") rec.lat = body.lat;
  if (typeof body.lng === "number") rec.lng = body.lng;
  if (typeof body.radius === "number") rec.radius = body.radius;

  // Track who edited and when
  rec.last_edited = new Date().toISOString();
  if (body.edited_by) rec.last_edited_by = truncate(body.edited_by, 200);

  await env.INTERVENTIONS.put(key, JSON.stringify(rec));
  return json({ item: publicItem(id, rec) }, 200, cors);
}

/** POST /interventions/:id/close — close an intervention */
async function closeIntervention(id, env, cors) {
  const key = ACTIVE + id;
  const rec = await env.INTERVENTIONS.get(key, "json");
  if (!rec || rec.deleted) return json({ error: "not found" }, 404, cors);

  rec.status = "closed_completed";
  rec.end_date = new Date().toISOString().slice(0, 10);
  rec.last_edited = new Date().toISOString();

  await env.INTERVENTIONS.put(key, JSON.stringify(rec));
  return json({ item: publicItem(id, rec) }, 200, cors);
}

/** POST /interventions/:id/reopen — reopen a closed intervention */
async function reopenIntervention(id, env, cors) {
  const key = ACTIVE + id;
  const rec = await env.INTERVENTIONS.get(key, "json");
  if (!rec || rec.deleted) return json({ error: "not found" }, 404, cors);

  rec.status = "open_in_progress";
  rec.end_date = null;
  rec.last_edited = new Date().toISOString();

  await env.INTERVENTIONS.put(key, JSON.stringify(rec));
  return json({ item: publicItem(id, rec) }, 200, cors);
}

/** Truncate string to max length, or null if empty */
function truncate(s, max) {
  if (typeof s !== "string") return null;
  s = s.trim();
  return s ? s.slice(0, max) : null;
}

/** Sanitize a list of document links: keep well-formed http(s) URLs, trim, cap length + count. */
function sanitizeLinks(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(u => typeof u === "string")
    .map(u => u.trim())
    .filter(u => /^https?:\/\//i.test(u) && u.length <= 2048)
    .slice(0, 20);
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
