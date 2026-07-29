// The upload widget served at GET / by the upload Worker. Zero-build: one HTML string with inline
// CSS + JS (matches the repo's no-bundler Worker style). Runs SAME-ORIGIN to the upload endpoints,
// so the Cloudflare Access cookie rides along on its POST/DELETE fetches.
//
// The inline JS below deliberately avoids template literals and `${`, so this whole file can hold it
// as a plain string without escaping. Config (max photos, opener origin) is injected via window.__CFG__.

export function widgetHtml(cfg) {
  const conf = { max: cfg.max || 6, openerOrigin: cfg.openerOrigin || "*" };
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<title>Add intervention photos</title><style>" + WIDGET_CSS + "</style></head><body>" +
    "<main class=\"wrap\">" +
    "<h1>Intervention photos</h1>" +
    "<p class=\"sub\">Adding to: <strong id=\"title\">…</strong></p>" +
    "<div id=\"drop\" class=\"drop\">" +
    "<p class=\"drop__hint\">Drag photos here, or</p>" +
    "<label class=\"btn\"><input id=\"file\" type=\"file\" accept=\"image/jpeg,image/png,image/webp\" multiple hidden> Choose photos…</label>" +
    "<p class=\"hint\">JPEG, PNG or WebP · up to " + conf.max + " photos · resized in your browser before upload (removes EXIF/GPS)</p>" +
    "</div>" +
    "<input id=\"caption\" class=\"caption\" type=\"text\" maxlength=\"200\" placeholder=\"Optional caption for the next upload\">" +
    "<p id=\"status\" class=\"status\" role=\"status\" aria-live=\"polite\"></p>" +
    "<div id=\"list\" class=\"list\"></div>" +
    "<p class=\"done\">Uploads save immediately. You can close this tab when you're finished.</p>" +
    "</main>" +
    "<script>window.__CFG__=" + JSON.stringify(conf) + ";</script>" +
    "<script>" + WIDGET_JS + "</script>" +
    "</body></html>"
  );
}

const WIDGET_CSS =
  ":root{--fg:#1f2937;--muted:#6b7280;--line:#e5e7eb;--blue:#2563eb;--bg:#f7f7f9;--err:#b91c1c}" +
  "*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);line-height:1.5}" +
  ".wrap{max-width:640px;margin:0 auto;padding:1.5rem 1.25rem 3rem}" +
  "h1{font-size:1.35rem;margin:.25rem 0 .35rem}.sub{margin:0 0 1.25rem;color:var(--muted)}" +
  ".drop{border:2px dashed var(--line);border-radius:12px;background:#fff;padding:1.5rem;text-align:center;transition:border-color .15s,background .15s}" +
  ".drop.over{border-color:var(--blue);background:#eff4ff}.drop__hint{margin:.25rem 0 .75rem;color:var(--muted)}" +
  ".btn{display:inline-block;background:var(--blue);color:#fff;font-weight:600;padding:.55rem .9rem;border-radius:8px;cursor:pointer}" +
  ".btn:hover{filter:brightness(1.05)}.hint{font-size:.8rem;color:var(--muted);margin:.75rem 0 0}" +
  ".caption{width:100%;margin:1rem 0 .25rem;padding:.55rem .7rem;border:1px solid var(--line);border-radius:8px;font:inherit}" +
  ".status{min-height:1.25rem;margin:.5rem 0;font-size:.9rem;color:var(--muted)}.status.err{color:var(--err)}" +
  ".list{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:.5rem}" +
  ".ph{margin:0;width:150px;display:flex;flex-direction:column;gap:.35rem;background:#fff;border:1px solid var(--line);border-radius:10px;padding:.5rem}" +
  ".ph img{width:100%;height:110px;object-fit:cover;border-radius:6px;background:#eef}" +
  ".ph figcaption{font-size:.78rem;color:var(--muted);word-break:break-word}" +
  ".del{border:1px solid var(--line);background:#fff;color:var(--err);border-radius:6px;padding:.3rem;font:inherit;font-size:.8rem;cursor:pointer}" +
  ".del:hover{background:#fef2f2;border-color:var(--err)}" +
  ".done{margin-top:1.5rem;color:var(--muted);font-size:.85rem}";

// Plain ES5-ish string — NO template literals, NO `${` (see file header).
const WIDGET_JS =
"(function(){" +
"var CFG=window.__CFG__||{};var MAX=CFG.max||6;" +
"var params=new URLSearchParams(location.search);var id=params.get('intervention');" +
"var $=function(s){return document.querySelector(s);};" +
"var titleEl=$('#title'),listEl=$('#list'),statusEl=$('#status'),fileInput=$('#file'),drop=$('#drop'),captionEl=$('#caption');" +
"var left=MAX;" +
"function setStatus(m,err){statusEl.textContent=m||'';statusEl.className='status'+(err?' err':'');}" +
"function api(path,opts){return fetch(path,opts).then(function(r){return r.json().catch(function(){return {};}).then(function(b){if(!r.ok)throw new Error(b.error||('HTTP '+r.status));return b;});});}" +
"function notifyOpener(){try{if(window.opener){window.opener.postMessage({type:'photos-updated',intervention:id},CFG.openerOrigin||'*');}}catch(e){}}" +
"function render(photos){listEl.innerHTML='';(photos||[]).forEach(function(p){" +
"var fig=document.createElement('figure');fig.className='ph';" +
"var img=document.createElement('img');img.src=p.thumb;img.alt=p.caption||'Intervention photo';img.loading='lazy';fig.appendChild(img);" +
"if(p.caption){var cap=document.createElement('figcaption');cap.textContent=p.caption;fig.appendChild(cap);}" +
"var del=document.createElement('button');del.type='button';del.className='del';del.textContent='Delete';" +
"del.addEventListener('click',function(){removePhoto(p.id);});fig.appendChild(del);listEl.appendChild(fig);});" +
"left=MAX-((photos&&photos.length)||0);}" +
"function load(){api('/'+encodeURIComponent(id)).then(function(ctx){titleEl.textContent=(ctx.intervention_id?ctx.intervention_id+' · ':'')+(ctx.intervention||id);render(ctx.photos);}).catch(function(e){setStatus('Could not load this intervention: '+e.message,true);});}" +
"function loadImage(file){return new Promise(function(res,rej){var img=new Image();var u=URL.createObjectURL(file);img.onload=function(){URL.revokeObjectURL(u);res(img);};img.onerror=function(){URL.revokeObjectURL(u);rej(new Error('could not read image'));};img.src=u;});}" +
"function resize(img,maxEdge){var w=img.naturalWidth,h=img.naturalHeight;var s=Math.min(1,maxEdge/Math.max(w,h));w=Math.max(1,Math.round(w*s));h=Math.max(1,Math.round(h*s));var c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);return new Promise(function(res){c.toBlob(function(b){res({blob:b,w:w,h:h});},'image/jpeg',0.85);});}" +
"function uploadFile(file){if(!/^image\\/(jpeg|png|webp)$/.test(file.type)){setStatus('Only JPEG, PNG or WebP files are allowed.',true);return Promise.resolve();}" +
"setStatus('Processing '+file.name+'…');" +
"return loadImage(file).then(function(img){return Promise.all([resize(img,1600),resize(img,320)]);}).then(function(pair){" +
"var full=pair[0],thumb=pair[1];var fd=new FormData();fd.append('full',full.blob,'full.jpg');fd.append('thumb',thumb.blob,'thumb.jpg');fd.append('w',String(full.w));fd.append('h',String(full.h));" +
"var cap=captionEl.value.trim();if(cap)fd.append('caption',cap);" +
"return api('/'+encodeURIComponent(id)+'/photos',{method:'POST',body:fd});}).then(function(){captionEl.value='';setStatus('Uploaded.');notifyOpener();load();}).catch(function(e){setStatus('Upload failed: '+e.message,true);});}" +
"function handleFiles(files){var arr=Array.prototype.slice.call(files||[]);if(!arr.length)return;" +
"if(arr.length>left){setStatus('Only '+left+' more photo(s) allowed (max '+MAX+').',true);arr=arr.slice(0,Math.max(0,left));}" +
"if(!arr.length)return;arr.reduce(function(pr,f){return pr.then(function(){return uploadFile(f);});},Promise.resolve());}" +
"function removePhoto(pid){if(!confirm('Delete this photo? This cannot be undone.'))return;" +
"api('/'+encodeURIComponent(id)+'/photos/'+encodeURIComponent(pid),{method:'DELETE'}).then(function(){setStatus('Deleted.');notifyOpener();load();}).catch(function(e){setStatus('Delete failed: '+e.message,true);});}" +
"if(!id){setStatus('No intervention id in the URL (expected ?intervention=…).',true);return;}" +
"fileInput.addEventListener('change',function(){handleFiles(fileInput.files);fileInput.value='';});" +
"['dragover','dragenter'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('over');});});" +
"['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('over');});});" +
"drop.addEventListener('drop',function(e){handleFiles(e.dataTransfer.files);});" +
"load();" +
"})();";
