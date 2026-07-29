// ──────────────────────────────────────────────────────────────────────────
// Intervention photo UPLOAD Worker (../docs/plan-photo-uploads.md).
//
// The ONLY writer of intervention photos. Fully behind Cloudflare Access (One-Time PIN,
// @sfgov.org) on its own hostname — so every request here is already authenticated. We STILL
// verify the Access JWT (aud/iss/exp + RS256 signature) as defense in depth, and disable the
// workers.dev route so there is no un-gated path to the writer.
//
// Endpoints (all same-origin to the widget it serves):
//   GET    /                          → the upload widget (HTML/JS, no build step)
//   GET    /:interventionId           → { intervention, photos[], max }  (widget context)
//   POST   /:interventionId/photos    → multipart {full, thumb, w?, h?, caption?} → 201 { photo }
//   DELETE /:interventionId/photos/:photoId → 200 { ok:true }  (idempotent)
//
// Storage: writes JPEG bytes to R2 (bucket `intervention-storage`) at
//   photos/<interventionId>/<photoId>-{full,thumb}.jpg
// and appends metadata to the SHARED KV record's photos[] (same namespace as interventions-api).
// The public interventions-api Worker reads those keys back via GET /photos/:id/:pid.
// ──────────────────────────────────────────────────────────────────────────

import { widgetHtml } from "./widget.js";

const ACTIVE = "intervention:";
const MAX_PHOTOS = 6;
const MAX_BYTES = 3 * 1024 * 1024;   // per-image backstop; the client resizes well under this
const ALLOWED_ORIGIN_DEFAULT = "https://mayor-s-office-of-innovation.github.io";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") {
        if (request.method === "GET") return serveWidget(env);
        return json({ error: "method not allowed" }, 405);
      }

      const upload = url.pathname.match(/^\/([A-Za-z0-9-]+)\/photos$/);
      if (upload) {
        if (request.method === "POST") return await uploadPhoto(upload[1], request, env);
        return json({ error: "method not allowed" }, 405);
      }

      const del = url.pathname.match(/^\/([A-Za-z0-9-]+)\/photos\/([A-Za-z0-9-]+)$/);
      if (del) {
        if (request.method === "DELETE") return await deletePhoto(del[1], del[2], request, env);
        return json({ error: "method not allowed" }, 405);
      }

      const ctx = url.pathname.match(/^\/([A-Za-z0-9-]+)$/);
      if (ctx) {
        if (request.method === "GET") return await getContext(ctx[1], request, env);
        return json({ error: "method not allowed" }, 405);
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      // Auth failures → 401; everything else → 500.
      const msg = e && e.message ? e.message : "server error";
      const authFail = /Access|token|city email|not configured|issuer|audience|signature|expired|not yet valid|signing key/i.test(msg);
      return json({ error: msg }, authFail ? 401 : 500);
    }
  },
};

// ── responses ──────────────────────────────────────────────────────────────
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function serveWidget(env) {
  const cfg = { max: MAX_PHOTOS, openerOrigin: env.OPENER_ORIGIN || ALLOWED_ORIGIN_DEFAULT };
  return new Response(widgetHtml(cfg), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── auth: verified @sfgov.org email from the Access JWT (or dev bypass) ──────
async function authedEmail(request, env) {
  if (env.DEV === "1") return "dev@sfgov.org";
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const claims = await verifyAccessJwt(token, env);
  const email = String(claims.email || "").toLowerCase();
  const domain = String(env.CITY_EMAIL_DOMAIN || "sfgov.org").toLowerCase();
  if (!email.endsWith("@" + domain)) throw new Error("not a city email");
  return email;
}

/** Verify a Cloudflare Access JWT: iss/aud/exp/nbf + RS256 signature against the team JWKS. */
async function verifyAccessJwt(token, env) {
  if (!token) throw new Error("missing Access token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed Access token");
  const [h, p, sig] = parts;

  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "").replace(/\/$/, "");
  const aud = String(env.ACCESS_AUD || "");
  if (!teamDomain || !aud) throw new Error("Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD)");

  const header = JSON.parse(b64urlToString(h));
  const payload = JSON.parse(b64urlToString(p));

  if (payload.iss !== teamDomain) throw new Error("bad token issuer");
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("bad token audience");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error("token expired");
  if (payload.nbf && now < payload.nbf) throw new Error("token not yet valid");

  const certs = await fetch(`${teamDomain}/cdn-cgi/access/certs`).then(r => r.json());
  const jwk = (certs.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Access signing key not found");
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) throw new Error("bad token signature");
  return payload;
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const bin = atob(s + "=".repeat(pad));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const b64urlToString = s => new TextDecoder().decode(b64urlToBytes(s));

// ── handlers ─────────────────────────────────────────────────────────────
/** GET /:id — title + current photos so the widget can show context and the existing gallery. */
async function getContext(interventionId, request, env) {
  await authedEmail(request, env);   // host is fully gated; still assert a valid city identity
  const rec = await env.INTERVENTIONS.get(ACTIVE + interventionId, "json");
  if (!rec || rec.deleted) return json({ error: "intervention not found" }, 404);
  const base = String(env.PUBLIC_PHOTO_BASE || "").replace(/\/$/, "");
  return json({
    intervention: rec.intervention || null,
    intervention_id: rec.intervention_id || null,
    district: rec.district || null,
    max: MAX_PHOTOS,
    photos: (rec.photos || []).map(pp => publicPhoto(base, interventionId, pp)),
  });
}

/** POST /:id/photos — validate → write R2 (full+thumb) → append KV photos[]. */
async function uploadPhoto(interventionId, request, env) {
  const email = await authedEmail(request, env);

  const key = ACTIVE + interventionId;
  const rec = await env.INTERVENTIONS.get(key, "json");
  if (!rec || rec.deleted) return json({ error: "intervention not found" }, 404);

  const photos = rec.photos || [];
  if (photos.length >= MAX_PHOTOS) return json({ error: `max ${MAX_PHOTOS} photos per intervention` }, 400);

  const form = await request.formData();
  const full = form.get("full");
  const thumb = form.get("thumb");
  if (!(full instanceof File) || !(thumb instanceof File)) {
    return json({ error: "both `full` and `thumb` image parts are required" }, 400);
  }
  for (const f of [full, thumb]) {
    if (f.size > MAX_BYTES) return json({ error: "image too large" }, 400);
    if (!(await isJpeg(f))) return json({ error: "images must be JPEG (the widget re-encodes them)" }, 400);
  }

  const caption = truncate(form.get("caption"), 200);
  const w = toInt(form.get("w"));
  const h = toInt(form.get("h"));

  const photoId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const fullKey = `photos/${interventionId}/${photoId}-full.jpg`;
  const thumbKey = `photos/${interventionId}/${photoId}-thumb.jpg`;
  const meta = { httpMetadata: { contentType: "image/jpeg" } };
  await env.PHOTOS.put(fullKey, await full.arrayBuffer(), meta);
  await env.PHOTOS.put(thumbKey, await thumb.arrayBuffer(), meta);

  const entry = {
    id: photoId, full_key: fullKey, thumb_key: thumbKey,
    w, h, caption, uploaded_by: email, uploaded_at: new Date().toISOString(),
  };
  rec.photos = [...photos, entry];
  await env.INTERVENTIONS.put(key, JSON.stringify(rec));

  const base = String(env.PUBLIC_PHOTO_BASE || "").replace(/\/$/, "");
  return json({ photo: publicPhoto(base, interventionId, entry) }, 201);
}

/** DELETE /:id/photos/:photoId — remove both R2 objects + the KV entry (idempotent). */
async function deletePhoto(interventionId, photoId, request, env) {
  await authedEmail(request, env);
  const key = ACTIVE + interventionId;
  const rec = await env.INTERVENTIONS.get(key, "json");
  if (!rec || rec.deleted) return json({ error: "intervention not found" }, 404);

  const photos = rec.photos || [];
  const entry = photos.find(pp => pp.id === photoId);
  if (!entry) return json({ ok: true });   // already gone → idempotent

  await env.PHOTOS.delete(entry.full_key || `photos/${interventionId}/${photoId}-full.jpg`);
  await env.PHOTOS.delete(entry.thumb_key || `photos/${interventionId}/${photoId}-thumb.jpg`);
  rec.photos = photos.filter(pp => pp.id !== photoId);
  await env.INTERVENTIONS.put(key, JSON.stringify(rec));
  return json({ ok: true });
}

// ── helpers ──────────────────────────────────────────────────────────────
/** Public projection for the widget: absolute serve URLs on the PUBLIC Worker; no `uploaded_by`. */
function publicPhoto(base, interventionId, p) {
  return {
    id: p.id,
    w: p.w || null,
    h: p.h || null,
    caption: p.caption || null,
    uploaded_at: p.uploaded_at || null,
    thumb: `${base}/photos/${interventionId}/${p.id}?v=thumb`,
    full: `${base}/photos/${interventionId}/${p.id}?v=full`,
  };
}

/** JPEG magic bytes (FF D8 FF). The widget always re-encodes to JPEG before upload. */
async function isJpeg(file) {
  const b = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function truncate(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
