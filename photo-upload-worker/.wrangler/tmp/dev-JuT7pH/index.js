var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/widget.js
function widgetHtml(cfg) {
  const conf = { max: cfg.max || 6, openerOrigin: cfg.openerOrigin || "*" };
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Add intervention photos</title><style>' + WIDGET_CSS + '</style></head><body><main class="wrap"><h1>Intervention photos</h1><p class="sub">Adding to: <strong id="title">\u2026</strong></p><div id="drop" class="drop"><p class="drop__hint">Drag photos here, or</p><label class="btn"><input id="file" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden> Choose photos\u2026</label><p class="hint">JPEG, PNG or WebP \xB7 up to ' + conf.max + ` photos \xB7 resized in your browser before upload (removes EXIF/GPS)</p></div><input id="caption" class="caption" type="text" maxlength="200" placeholder="Optional caption for the next upload"><p id="status" class="status" role="status" aria-live="polite"></p><div id="list" class="list"></div><p class="done">Uploads save immediately. You can close this tab when you're finished.</p></main><script>window.__CFG__=` + JSON.stringify(conf) + ";<\/script><script>" + WIDGET_JS + "<\/script></body></html>";
}
__name(widgetHtml, "widgetHtml");
var WIDGET_CSS = ":root{--fg:#1f2937;--muted:#6b7280;--line:#e5e7eb;--blue:#2563eb;--bg:#f7f7f9;--err:#b91c1c}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);line-height:1.5}.wrap{max-width:640px;margin:0 auto;padding:1.5rem 1.25rem 3rem}h1{font-size:1.35rem;margin:.25rem 0 .35rem}.sub{margin:0 0 1.25rem;color:var(--muted)}.drop{border:2px dashed var(--line);border-radius:12px;background:#fff;padding:1.5rem;text-align:center;transition:border-color .15s,background .15s}.drop.over{border-color:var(--blue);background:#eff4ff}.drop__hint{margin:.25rem 0 .75rem;color:var(--muted)}.btn{display:inline-block;background:var(--blue);color:#fff;font-weight:600;padding:.55rem .9rem;border-radius:8px;cursor:pointer}.btn:hover{filter:brightness(1.05)}.hint{font-size:.8rem;color:var(--muted);margin:.75rem 0 0}.caption{width:100%;margin:1rem 0 .25rem;padding:.55rem .7rem;border:1px solid var(--line);border-radius:8px;font:inherit}.status{min-height:1.25rem;margin:.5rem 0;font-size:.9rem;color:var(--muted)}.status.err{color:var(--err)}.list{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:.5rem}.ph{margin:0;width:150px;display:flex;flex-direction:column;gap:.35rem;background:#fff;border:1px solid var(--line);border-radius:10px;padding:.5rem}.ph img{width:100%;height:110px;object-fit:cover;border-radius:6px;background:#eef}.ph figcaption{font-size:.78rem;color:var(--muted);word-break:break-word}.del{border:1px solid var(--line);background:#fff;color:var(--err);border-radius:6px;padding:.3rem;font:inherit;font-size:.8rem;cursor:pointer}.del:hover{background:#fef2f2;border-color:var(--err)}.done{margin-top:1.5rem;color:var(--muted);font-size:.85rem}";
var WIDGET_JS = "(function(){var CFG=window.__CFG__||{};var MAX=CFG.max||6;var params=new URLSearchParams(location.search);var id=params.get('intervention');var $=function(s){return document.querySelector(s);};var titleEl=$('#title'),listEl=$('#list'),statusEl=$('#status'),fileInput=$('#file'),drop=$('#drop'),captionEl=$('#caption');var left=MAX;function setStatus(m,err){statusEl.textContent=m||'';statusEl.className='status'+(err?' err':'');}function api(path,opts){return fetch(path,opts).then(function(r){return r.json().catch(function(){return {};}).then(function(b){if(!r.ok)throw new Error(b.error||('HTTP '+r.status));return b;});});}function notifyOpener(){try{if(window.opener){window.opener.postMessage({type:'photos-updated',intervention:id},CFG.openerOrigin||'*');}}catch(e){}}function render(photos){listEl.innerHTML='';(photos||[]).forEach(function(p){var fig=document.createElement('figure');fig.className='ph';var img=document.createElement('img');img.src=p.thumb;img.alt=p.caption||'Intervention photo';img.loading='lazy';fig.appendChild(img);if(p.caption){var cap=document.createElement('figcaption');cap.textContent=p.caption;fig.appendChild(cap);}var del=document.createElement('button');del.type='button';del.className='del';del.textContent='Delete';del.addEventListener('click',function(){removePhoto(p.id);});fig.appendChild(del);listEl.appendChild(fig);});left=MAX-((photos&&photos.length)||0);}function load(){api('/'+encodeURIComponent(id)).then(function(ctx){titleEl.textContent=(ctx.intervention_id?ctx.intervention_id+' \xB7 ':'')+(ctx.intervention||id);render(ctx.photos);}).catch(function(e){setStatus('Could not load this intervention: '+e.message,true);});}function loadImage(file){return new Promise(function(res,rej){var img=new Image();var u=URL.createObjectURL(file);img.onload=function(){URL.revokeObjectURL(u);res(img);};img.onerror=function(){URL.revokeObjectURL(u);rej(new Error('could not read image'));};img.src=u;});}function resize(img,maxEdge){var w=img.naturalWidth,h=img.naturalHeight;var s=Math.min(1,maxEdge/Math.max(w,h));w=Math.max(1,Math.round(w*s));h=Math.max(1,Math.round(h*s));var c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);return new Promise(function(res){c.toBlob(function(b){res({blob:b,w:w,h:h});},'image/jpeg',0.85);});}function uploadFile(file){if(!/^image\\/(jpeg|png|webp)$/.test(file.type)){setStatus('Only JPEG, PNG or WebP files are allowed.',true);return Promise.resolve();}setStatus('Processing '+file.name+'\u2026');return loadImage(file).then(function(img){return Promise.all([resize(img,1600),resize(img,320)]);}).then(function(pair){var full=pair[0],thumb=pair[1];var fd=new FormData();fd.append('full',full.blob,'full.jpg');fd.append('thumb',thumb.blob,'thumb.jpg');fd.append('w',String(full.w));fd.append('h',String(full.h));var cap=captionEl.value.trim();if(cap)fd.append('caption',cap);return api('/'+encodeURIComponent(id)+'/photos',{method:'POST',body:fd});}).then(function(){captionEl.value='';setStatus('Uploaded.');notifyOpener();load();}).catch(function(e){setStatus('Upload failed: '+e.message,true);});}function handleFiles(files){var arr=Array.prototype.slice.call(files||[]);if(!arr.length)return;if(arr.length>left){setStatus('Only '+left+' more photo(s) allowed (max '+MAX+').',true);arr=arr.slice(0,Math.max(0,left));}if(!arr.length)return;arr.reduce(function(pr,f){return pr.then(function(){return uploadFile(f);});},Promise.resolve());}function removePhoto(pid){if(!confirm('Delete this photo? This cannot be undone.'))return;api('/'+encodeURIComponent(id)+'/photos/'+encodeURIComponent(pid),{method:'DELETE'}).then(function(){setStatus('Deleted.');notifyOpener();load();}).catch(function(e){setStatus('Delete failed: '+e.message,true);});}if(!id){setStatus('No intervention id in the URL (expected ?intervention=\u2026).',true);return;}fileInput.addEventListener('change',function(){handleFiles(fileInput.files);fileInput.value='';});['dragover','dragenter'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('over');});});['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('over');});});drop.addEventListener('drop',function(e){handleFiles(e.dataTransfer.files);});load();})();";

// src/index.js
var ACTIVE = "intervention:";
var MAX_PHOTOS = 6;
var MAX_BYTES = 3 * 1024 * 1024;
var ALLOWED_ORIGIN_DEFAULT = "https://mayor-s-office-of-innovation.github.io";
var src_default = {
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
      const msg = e && e.message ? e.message : "server error";
      const authFail = /Access|token|city email|not configured|issuer|audience|signature|expired|not yet valid|signing key/i.test(msg);
      return json({ error: msg }, authFail ? 401 : 500);
    }
  }
};
var json = /* @__PURE__ */ __name((body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }), "json");
function serveWidget(env) {
  const cfg = { max: MAX_PHOTOS, openerOrigin: env.OPENER_ORIGIN || ALLOWED_ORIGIN_DEFAULT };
  return new Response(widgetHtml(cfg), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
__name(serveWidget, "serveWidget");
async function authedEmail(request, env) {
  if (env.DEV === "1") return "dev@sfgov.org";
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const claims = await verifyAccessJwt(token, env);
  const email = String(claims.email || "").toLowerCase();
  const domain = String(env.CITY_EMAIL_DOMAIN || "sfgov.org").toLowerCase();
  if (!email.endsWith("@" + domain)) throw new Error("not a city email");
  return email;
}
__name(authedEmail, "authedEmail");
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
  const now = Math.floor(Date.now() / 1e3);
  if (payload.exp && now >= payload.exp) throw new Error("token expired");
  if (payload.nbf && now < payload.nbf) throw new Error("token not yet valid");
  const certs = await fetch(`${teamDomain}/cdn-cgi/access/certs`).then((r) => r.json());
  const jwk = (certs.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Access signing key not found");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) throw new Error("bad token signature");
  return payload;
}
__name(verifyAccessJwt, "verifyAccessJwt");
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - s.length % 4 : 0;
  const bin = atob(s + "=".repeat(pad));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
__name(b64urlToBytes, "b64urlToBytes");
var b64urlToString = /* @__PURE__ */ __name((s) => new TextDecoder().decode(b64urlToBytes(s)), "b64urlToString");
async function getContext(interventionId, request, env) {
  await authedEmail(request, env);
  const rec = await env.INTERVENTIONS.get(ACTIVE + interventionId, "json");
  if (!rec || rec.deleted) return json({ error: "intervention not found" }, 404);
  const base = String(env.PUBLIC_PHOTO_BASE || "").replace(/\/$/, "");
  return json({
    intervention: rec.intervention || null,
    intervention_id: rec.intervention_id || null,
    district: rec.district || null,
    max: MAX_PHOTOS,
    photos: (rec.photos || []).map((pp) => publicPhoto(base, interventionId, pp))
  });
}
__name(getContext, "getContext");
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
    if (!await isJpeg(f)) return json({ error: "images must be JPEG (the widget re-encodes them)" }, 400);
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
    id: photoId,
    full_key: fullKey,
    thumb_key: thumbKey,
    w,
    h,
    caption,
    uploaded_by: email,
    uploaded_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  rec.photos = [...photos, entry];
  await env.INTERVENTIONS.put(key, JSON.stringify(rec));
  const base = String(env.PUBLIC_PHOTO_BASE || "").replace(/\/$/, "");
  return json({ photo: publicPhoto(base, interventionId, entry) }, 201);
}
__name(uploadPhoto, "uploadPhoto");
async function deletePhoto(interventionId, photoId, request, env) {
  await authedEmail(request, env);
  const key = ACTIVE + interventionId;
  const rec = await env.INTERVENTIONS.get(key, "json");
  if (!rec || rec.deleted) return json({ error: "intervention not found" }, 404);
  const photos = rec.photos || [];
  const entry = photos.find((pp) => pp.id === photoId);
  if (!entry) return json({ ok: true });
  await env.PHOTOS.delete(entry.full_key || `photos/${interventionId}/${photoId}-full.jpg`);
  await env.PHOTOS.delete(entry.thumb_key || `photos/${interventionId}/${photoId}-thumb.jpg`);
  rec.photos = photos.filter((pp) => pp.id !== photoId);
  await env.INTERVENTIONS.put(key, JSON.stringify(rec));
  return json({ ok: true });
}
__name(deletePhoto, "deletePhoto");
function publicPhoto(base, interventionId, p) {
  return {
    id: p.id,
    w: p.w || null,
    h: p.h || null,
    caption: p.caption || null,
    uploaded_at: p.uploaded_at || null,
    thumb: `${base}/photos/${interventionId}/${p.id}?v=thumb`,
    full: `${base}/photos/${interventionId}/${p.id}?v=full`
  };
}
__name(publicPhoto, "publicPhoto");
async function isJpeg(file) {
  const b = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return b[0] === 255 && b[1] === 216 && b[2] === 255;
}
__name(isJpeg, "isJpeg");
function truncate(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}
__name(truncate, "truncate");
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
__name(toInt, "toInt");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-27yesj/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-27yesj/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
