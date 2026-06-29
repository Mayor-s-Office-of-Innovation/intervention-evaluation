// ──────────────────────────────────────────────────────────────────────────
// Saved-interventions API — Cloudflare Worker + KV (../plan-saved-interventions.md).
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

      // Match /interventions/:id/attachments
      const attachMatch = url.pathname.match(/^\/interventions\/([A-Za-z0-9-]+)\/attachments$/);
      if (attachMatch) {
        const id = attachMatch[1];
        if (request.method === "POST") return await uploadAttachment(id, request, env, cors);
        if (request.method === "GET") return await listAttachments(id, env, cors);
        return json({ error: "method not allowed" }, 405, cors);
      }

      // Match /interventions/:id/attachments/:filename for download
      const downloadMatch = url.pathname.match(/^\/interventions\/([A-Za-z0-9-]+)\/attachments\/(.+)$/);
      if (downloadMatch) {
        const [, id, filename] = downloadMatch;
        if (request.method === "GET") return await downloadAttachment(id, filename, env, cors);
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
    attachments: rec.attachments || [],
    lat: rec.lat || lat || null,
    lng: rec.lng || lng || null,
    radius: rec.radius || null,
  };
}

/** Generate next auto-ID for a district (e.g., CEN001, CEN002) */
async function nextId(district, env) {
  const prefix = DISTRICT_PREFIX[district] || DISTRICT_PREFIX.Other;
  const key = COUNTER + prefix;
  const current = parseInt(await env.INTERVENTIONS.get(key) || "0", 10);
  const next = current + 1;
  await env.INTERVENTIONS.put(key, String(next));
  return `${prefix}${String(next).padStart(3, "0")}`;
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

/** POST /interventions/full — create with all tracker fields */
async function createFull(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400, cors); }

  // Required fields
  const intervention = typeof body.intervention === "string" ? body.intervention.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const district = typeof body.district === "string" ? body.district.trim() : "";

  if (!intervention) return json({ error: "intervention title is required" }, 400, cors);
  if (intervention.length > 500) return json({ error: "intervention title too long (max 500)" }, 400, cors);
  if (!isEmail(email) || email.length > 254) return json({ error: "a valid email is required" }, 400, cors);
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
  const cityEmailGuess = !!cityDomain && email.toLowerCase().endsWith("@" + cityDomain);

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
    district,
    lat: typeof body.lat === "number" ? body.lat : null,
    lng: typeof body.lng === "number" ? body.lng : null,
    radius: typeof body.radius === "number" ? body.radius : null,
    url: body.url || null,
    created: now,
    deleted: false,
    email,
    cityEmailGuess,
    person_submitted: truncate(body.person_submitted, 200) || email.split("@")[0],
    last_edited: now,
    last_edited_by: truncate(body.person_submitted, 200) || email.split("@")[0],
    attachments: [],
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

// ── Attachment handling (R2) ──────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

/** POST /interventions/:id/attachments — upload a file */
async function uploadAttachment(id, request, env, cors) {
  const key = ACTIVE + id;
  const rec = await env.INTERVENTIONS.get(key, "json");
  if (!rec || rec.deleted) return json({ error: "intervention not found" }, 404, cors);

  // Check if R2 binding is available
  if (!env.ATTACHMENTS) {
    return json({ error: "attachments not configured" }, 501, cors);
  }

  const contentType = request.headers.get("content-type") || "";

  // Handle multipart form data
  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
        return json({ error: "no file provided" }, 400, cors);
      }

      return await processUpload(id, file, rec, key, env, cors);
    } catch (e) {
      return json({ error: "failed to parse form data: " + e.message }, 400, cors);
    }
  }

  // Handle direct binary upload with filename in header
  const filename = request.headers.get("x-filename") || `upload-${Date.now()}`;
  const fileType = request.headers.get("content-type") || "application/octet-stream";
  const body = await request.arrayBuffer();

  const file = {
    name: filename,
    type: fileType,
    size: body.byteLength,
    arrayBuffer: async () => body,
  };

  return await processUpload(id, file, rec, key, env, cors);
}

async function processUpload(id, file, rec, key, env, cors) {
  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    return json({ error: `file type not allowed: ${file.type}` }, 400, cors);
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return json({ error: `file too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` }, 400, cors);
  }

  // Generate unique key for R2
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 100);
  const r2Key = `${id}/${timestamp}-${safeName}`;

  // Upload to R2
  const body = await file.arrayBuffer();
  await env.ATTACHMENTS.put(r2Key, body, {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  // Update intervention record
  const attachment = {
    key: r2Key,
    filename: file.name,
    type: file.type,
    size: file.size,
    uploaded: new Date().toISOString(),
  };
  rec.attachments = rec.attachments || [];
  rec.attachments.push(attachment);
  rec.last_edited = new Date().toISOString();

  await env.INTERVENTIONS.put(key, JSON.stringify(rec));

  return json({ attachment }, 201, cors);
}

/** GET /interventions/:id/attachments — list attachments */
async function listAttachments(id, env, cors) {
  const rec = await env.INTERVENTIONS.get(ACTIVE + id, "json");
  if (!rec || rec.deleted) return json({ error: "not found" }, 404, cors);
  return json({ attachments: rec.attachments || [] }, 200, cors);
}

/** GET /interventions/:id/attachments/:filename — download a file */
async function downloadAttachment(id, filename, env, cors) {
  if (!env.ATTACHMENTS) {
    return json({ error: "attachments not configured" }, 501, cors);
  }

  // Find the attachment in the record
  const rec = await env.INTERVENTIONS.get(ACTIVE + id, "json");
  if (!rec || rec.deleted) return json({ error: "intervention not found" }, 404, cors);

  const attachment = (rec.attachments || []).find(
    a => a.filename === filename || a.key.endsWith(filename)
  );
  if (!attachment) return json({ error: "attachment not found" }, 404, cors);

  // Fetch from R2
  const object = await env.ATTACHMENTS.get(attachment.key);
  if (!object) return json({ error: "file not found in storage" }, 404, cors);

  const headers = new Headers(cors);
  headers.set("Content-Type", attachment.type || "application/octet-stream");
  headers.set("Content-Disposition", `inline; filename="${attachment.filename}"`);
  headers.set("Cache-Control", "public, max-age=31536000");

  return new Response(object.body, { headers });
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
