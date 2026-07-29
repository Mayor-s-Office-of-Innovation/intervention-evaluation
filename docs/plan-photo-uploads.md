# Plan: Photo uploads for interventions

City workers want to attach photos (before/after shots of what they've done to an
area) to interventions. Photos must be uploadable at **create** time and while
**editing** an existing intervention, show as **thumbnails** on the homepage list,
and appear in the **read-only view** of an intervention.

## Decisions locked

- **Storage:** Cloudflare **R2** bucket **`intervention-storage`** (created), with **client-side resize** (browser
  `<canvas>` re-encode) before upload. Cheap, keeps the Worker dumb, and re-encoding
  strips EXIF/GPS automatically.
- **Auth:** a **separate, fully auth-gated photo widget** hosted on a newly
  registered domain on Cloudflare, gated by **Cloudflare Access One-Time PIN**
  (policy: allow email ending in `@sfgov.org`). Users click through to it in a new
  tab.
  - **No outbound email infra on our side.** Access OTP sends the code from
    Cloudflare's own mail — no Resend/Postmark, no DKIM/SPF, no deliverability ops.
  - **City SSO is intentionally out of scope** for this project. We use the built-in
    OTP login method, no IdP integration.
- **Viewing is public** (thumbnails on the public homepage require it); only
  upload/delete is gated.

### Why not the alternatives (for the record)
- *Worker email OTP* would have required us to own outbound email deliverability.
- *Bolting Access onto the current github.io → workers.dev `fetch()`* fails: Access
  logs in via a top-level redirect + a session cookie on the Cloudflare domain, and a
  cross-site `fetch()` from `github.io` can neither follow that redirect nor carry
  that cookie (third-party cookie, blocked by Safari/Chrome). Hosting the widget on
  the Cloudflare domain and having it make the upload fetch **same-site** is what
  makes Access work.
- The current origin allowlist is CORS-only, not a real security boundary (a `curl`
  client forges `Origin`). Fine for length-capped text; not fine for a public image
  endpoint. Access closes this for the write path.

## Architecture: two Workers, one R2 bucket, shared KV

Both Workers bind the **same** `INTERVENTIONS` KV namespace and the **same** new
`PHOTOS` R2 bucket (bindings reference IDs; multiple Workers can share them).

### 1. Existing public Worker (`interventions-api`, `*.workers.dev`) — stays open
- All current endpoints unchanged.
- Add a **read** R2 binding.
- New public route to **serve** bytes with long cache headers:
  `GET /photos/:interventionId/:photoId` (accepts `?v=thumb|full`, default `full`).
  Streams the R2 object; `Cache-Control: public, max-age=31536000, immutable`
  (photo ids are unique, so immutable is safe). Optionally back with the Cache API.
- `publicItem` now projects `photos[]` (see data model). This is what github.io reads.
- **Does not** accept uploads.
- *(Optional optimization: serve bytes via an R2 public bucket on a custom domain
  instead of through the Worker. Deferred — Worker serving is simpler and lets us add
  access control later if ever needed.)*

### 2. New upload Worker (registered domain, e.g. `photos.NEWDOMAIN`) — behind Access
- The **entire hostname** is behind one Cloudflare Access application (OTP,
  `@sfgov.org`). No path carve-outs needed since this host only does uploads.
- `GET /` → serves the widget HTML/JS (small inline static app; no build step, matches
  the repo's zero-build Worker style). *(Alternative: Cloudflare Pages — deferred to
  avoid a second build system.)*
- `POST /:interventionId/photos` → validate Access JWT → validate files → write
  `thumb` + `full` objects to R2 → append metadata to the KV record's `photos[]`,
  stamping `uploaded_by` from the verified JWT email + `uploaded_at`.
- `DELETE /:interventionId/photos/:photoId` → validate → delete both R2 objects →
  remove the `photos[]` entry.
- **Only photo writer.** Its `workers.dev` route is **disabled** so the sole entry is
  the Access-gated custom domain.

## Data model changes

Add `photos: []` to the record in `createFull`/`update` and project it in
`publicItem` ([interventions-api/src/index.js](interventions-api/src/index.js)).

Each entry:
```js
{
  id,            // photo uuid
  full_key,      // R2 key of display-size image
  thumb_key,     // R2 key of thumbnail
  w, h,          // display-size intrinsic dimensions (for layout / no CLS)
  caption,       // optional, capped ~200 chars
  uploaded_by,   // verified @sfgov.org email from Access JWT (audit trail)
  uploaded_at,   // ISO timestamp
}
```
`publicItem` returns each with derived URLs pointing at the public Worker's serve
route (`.../photos/:id/:pid?v=thumb` and `?v=full`) rather than raw keys.

R2 key scheme: `photos/<interventionId>/<photoId>-full.jpg` and `-thumb.jpg`.

**Caps (mirror the existing length-cap philosophy):**
- Max **6** photos per intervention (reject the append past the cap).
- Allowed types: `image/jpeg`, `image/png`, `image/webp`; validate **magic bytes**
  server-side, not just the declared MIME.
- Client resizes to display ≤ ~1600px longest edge, thumb ~320px; both re-encoded to
  JPEG. Enforce a server-side max body size (~2 MB/image after resize) as a backstop.

## The photo widget (new-domain, Access-gated)

Small single-page app served by the upload Worker:
1. Reads `?intervention=<id>` from the URL; fetches that record from the **public**
   Worker to confirm the title/context to the user.
2. Drag-drop / file-picker. For each file: draw to `<canvas>`, produce a `thumb` blob
   (~320px) and a `full` blob (~1600px). This also strips EXIF/GPS.
3. `POST` both blobs (multipart) to `/:id/photos` on the same origin — the Access
   cookie rides along same-site, so the Worker receives the validated JWT.
4. Shows current photos with a delete (trash) control → `DELETE /:id/photos/:pid`.
5. On change, `postMessage`s to `window.opener` (target origin = the github.io site)
   so the origin tab can refresh. Also shows a "Done — you can close this tab" state.

## Frontend integration (github.io — no migration)

- **Create form** ([hypothesis/index.html](hypothesis/index.html) +
  [hypothesis/js/app.js](hypothesis/js/app.js)): after a successful create/patch we
  already have the id (`editId`). Add an **"Add / manage photos"** button that opens
  `https://photos.NEWDOMAIN/?intervention=<id>` via `window.open`. Listen for the
  widget's `postMessage` to re-fetch and show a thumbnail strip inline.
- **Homepage inline editor** ([js/app.js](js/app.js) `renderEditor`/`saveEditor`):
  add the same "Add / manage photos" button (photos are managed in the widget, not in
  the PATCH body, so `saveEditor` is unaffected). Refresh the row's thumbnails on the
  widget's `postMessage`.
- **Homepage list** ([js/app.js](js/app.js) `INTERVENTION_COLUMNS` /
  `renderInterventionRow`): render `photos[0]` thumb (and a `+N` badge) either as a new
  leading column or prepended in the "Intervention" name cell. Reserve fixed
  dimensions using `w/h` to avoid layout shift (see the CLS plan).
- **Read-only view** ([hypothesis/js/app.js](hypothesis/js/app.js)
  `renderViewDetails`): add a **Photos** row rendering a thumbnail gallery that opens
  full-size on click (lightbox or plain `<a target="_blank">`).
- All display reads come from the **public** Worker's `photos[]` + serve route.

## Security

- **Validate the Access JWT** in the upload Worker (fetch team certs from
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, verify RS256 signature,
  `aud` = the Access app AUD tag, and expiry) — defense in depth even though Access
  already blocks unauthenticated requests. Disabling the `workers.dev` route removes
  the un-gated backdoor.
- **File validation:** magic-byte sniff, type allowlist, per-file + per-intervention
  count/size caps, reject anything else.
- **EXIF/GPS stripping** happens for free via the client `<canvas>` re-encode; the
  Worker only ever stores the re-encoded blob.
- **Content moderation:** uploads are attributed to a verified `@sfgov.org` email;
  delete is available in the widget. (No automated scanning in v1.)
- Per the repo's "public GitHub Pages, no security findings except the Worker" stance,
  the Workers are where review effort goes.

## Infra / ops (manual, done by you in dashboards)

1. Register the domain; add it to Cloudflare (creates the zone).
2. ~~Create the `PHOTOS` R2 bucket.~~ **Done** — bucket name is `intervention-storage`.
3. Bind `PHOTOS` (read) to the existing Worker; bind `PHOTOS` (write) + `INTERVENTIONS`
   KV to the new upload Worker. Add `[[r2_buckets]]` to the relevant `wrangler.toml`(s).
4. Put the upload Worker on a custom domain route (`photos.NEWDOMAIN`) and **disable
   its `workers.dev` route**.
5. Create the Cloudflare Access application over `photos.NEWDOMAIN`, enable **One-Time
   PIN**, policy = allow `emails ending in @sfgov.org`. Note the app **AUD** for JWT
   validation.
6. `ALLOWED_ORIGINS` on the existing Worker is unchanged (still github.io); the widget
   is same-origin to its own Worker.
7. **`deploy.yml`:** the github.io changes are edits to existing files
   (`index.html`, `js/app.js`, `hypothesis/*`), which are already staged — but
   **verify** any new client JS module is added to the staging globs + the
   "Verify homepage assets were staged" guard, or it 404s in prod.

## Testing

- Client resize + magic-byte validation: unit-testable in isolation.
- Worker upload/delete + caps + JWT-`aud` rejection: Worker tests (mock Access header).
- e2e: Playwright can cover github.io thumbnail rendering + read-only gallery against a
  seeded record with `photos[]`. **The Access-gated widget itself is hard to e2e**
  (real OTP); plan a manual smoke test for the auth + upload path, or a test-mode
  bypass token gated to non-prod.

## Suggested build order

1. ✅ **DONE (2026-07-28)** — R2 bucket + data model (`photos[]` in create/publicItem) + public
   serve route on the existing Worker. Verified locally with `wrangler dev` (R2/KV simulated): create
   projects `photos:[]`; serve route returns bytes with immutable cache + ETag (404 when missing);
   `publicItem` projects `id/w/h/caption/uploaded_at` + relative `thumb`/`full` URLs; neither `email`
   nor `uploaded_by` leaks. **Still TODO for step 1's tail:** hand-seed a photo on the *deployed*
   bucket to unblock UI work (commands below). Note: photo URLs are ORIGIN-RELATIVE — the client joins
   them with its API base (keeps local dev correct); no absolute-base var needed.
2. ✅ **DONE (2026-07-28)** — Homepage list thumbnails + read-only view gallery (pure display, no auth).
   - `photoSrc(rel)` helper in [js/interventions-client.js](js/interventions-client.js) joins the
     origin-relative serve URLs with the API base.
   - Homepage: new auto-hiding **Photo** column ([js/app.js](js/app.js) `renderPhotoThumb` +
     `INTERVENTION_COLUMNS`), fixed 44px square thumb + `+N` overflow badge; `savedToRow` now carries
     `photos[]` through. CSS in [styles.css](styles.css).
   - Read-only view: **Photos** gallery row in [hypothesis/js/app.js](hypothesis/js/app.js)
     `renderViewDetails` — thumbnails open full-size in a new tab (plain `<a target=_blank>`, no
     lightbox dep). CSS in [hypothesis/styles.css](hypothesis/styles.css).
   - Tests: homepage e2e asserts thumbnail + `+N` badge + column auto-hide; hypothesis e2e asserts the
     gallery renders, `img`/`a` join the API base, caption + new-tab. All green. No new JS *files* → no
     `deploy.yml` staging change needed.
3. ✅ **DONE (2026-07-28)** — New upload Worker + widget + Cloudflare Access (the gated write path).
   Code complete + verified locally; **the Cloudflare Access app + custom-domain route are the
   remaining manual dashboard steps** (see [../photo-upload-worker/README.md](../photo-upload-worker/README.md)).
   - New sibling Worker [photo-upload-worker/](../photo-upload-worker/): `src/index.js` (router +
     Access-JWT verify + upload/delete/context), `src/widget.js` (`widgetHtml()` — inline HTML/JS
     upload app, drag-drop + `<canvas>` resize to 1600/320px JPEG + sequential POST + `postMessage`
     to opener; written as concatenated strings, **no template literals/`${`**, so it nests cleanly),
     `wrangler.toml` (shared KV id + R2 `intervention-storage` write + `ACCESS_*` placeholders),
     `README.md`.
   - Auth: DEV bypass (`--var DEV:1` → `dev@sfgov.org`) for local only; prod verifies
     `iss/aud/exp/nbf` + RS256 vs team JWKS and asserts `@sfgov.org`. Un-configured `ACCESS_*` →
     401 by default. `workers.dev` route to be disabled in the dashboard.
   - **Verified locally** (two `wrangler dev`, shared `--persist-to`, real `sips`-minted JPEGs):
     create→`photos:[]`; upload→201 (absolute URLs, **no `uploaded_by` leak**); widget `GET /:id`
     context ok; `publicItem.photos[]` relative URLs; serve→200 `image/jpeg` + immutable cache +
     ETag; delete→idempotent 200, serve-after-delete 404, KV `photos[]` empty. Guards: non-JPEG→400,
     missing part→400, 7th photo→400 (cap 6), unknown id→404, **no-DEV unauthenticated upload→401
     "missing Access token"**. Widget `GET /` serves HTML with `__CFG__` injected.
   - **Not e2e-tested** (real OTP is impractical in CI) — the widget's auth+upload path is a manual
     smoke test after the Access app exists; display side (steps 2) is covered by Playwright.
4. ✅ **DONE (2026-07-28)** — Wired the "Add / manage photos" buttons + `postMessage` refresh into the
   create form and the inline editor. This is the last frontend code; it's independent of whether the
   Cloudflare Access app is live yet (a user just gets an OTP prompt when the widget tab opens).
   - **Shared helpers** in [js/interventions-client.js](js/interventions-client.js), mirroring the
     existing `PROD_API`/`localStorage.interventionsApi` pattern:
     `PROD_PHOTO_WIDGET = 'https://photos.sfinterventionassets.org'` + exported `PHOTO_WIDGET` with a
     `localStorage.photoWidget` local-dev override; `openPhotoWidget(id)` (`window.open` to
     `<widget>/?intervention=<id>`, named tab, **no `noopener`** — the widget needs `window.opener` to
     post back); `onPhotosUpdated(handler)` (adds a `message` listener that checks
     `e.origin === new URL(PHOTO_WIDGET).origin` + `e.data.type==='photos-updated'` + a truthy
     `intervention`, returns an unsubscribe fn). Reuses `photoSrc` + `getIntervention`.
   - **Create form** ([hypothesis/index.html](hypothesis/index.html) + [hypothesis/js/app.js](hypothesis/js/app.js)):
     a hidden `#photos-btn` + `#photos-strip` in the `.share-bar`; `showPhotoControls()` reveals them in
     both `handleSubmit` success branches once `editId` is set; `refreshPhotoStrip(id)` re-fetches via
     `getIntervention` and repaints the strip; `onPhotosUpdated` refreshes when the posted id matches the
     open `editId`/`viewId`.
   - **Homepage inline editor** ([js/app.js](js/app.js)): an `.editor-photos` block in `renderEditor`
     (label + `.editor-photos__strip[data-id]` + button + a note that photos save immediately, no "Save
     changes" needed); button wired in `wireEditor`; `saveEditor` untouched (photos aren't in the PATCH
     body). **postMessage-refresh design: targeted strip update, NOT a full `render()`** — the handler
     re-fetches the record, swaps it into the `savedInterventions` cache, and if that editor is open
     repaints only its `.editor-photos__strip` innerHTML in place, so un-saved field edits aren't
     clobbered. The row's Photo column refreshes on the next natural render (Save/Cancel/Archive).
     Listener registered once, module-level in `init()`.
   - **CSS**: shared `.photos-strip`/`.photos-strip__item` thumbs (+ dark mode) in both
     [styles.css](styles.css) (72×54, plus the `.editor-photos` block) and
     [hypothesis/styles.css](hypothesis/styles.css) (96×72).
   - **Tests**: new homepage e2e (open editor for photo-bearing item → strip shows 2 thumbs → button
     opens `<origin>/?intervention=a` → postMessage grows the strip to 3) and hypothesis e2e (create →
     `#photos-btn` reveals → opens `<origin>/?intervention=new1` → postMessage renders 1 thumb). Both
     point `localStorage.photoWidget` at the page origin so `window.open` is assertable and the
     `onPhotosUpdated` origin check accepts a page-dispatched `postMessage`; `window.open` is captured
     via `addInitScript`. No new JS *files* → no `deploy.yml` staging change.
   - **Test-infra guardrail (added while verifying):** the create POST is a cross-origin
     `application/json` request → CORS preflight; the fix points `localStorage.interventionsApi` at the
     page origin so writes are same-origin (no preflight) and the stub intercepts them. Since the client
     defaults to the **prod** Worker, a new shared base [tests/e2e-base.js](tests/e2e-base.js) (imported
     by every spec in place of `@playwright/test`) installs a **fail-closed guard**: any un-stubbed
     POST/PUT/PATCH/DELETE to `interventions-api.safestreetssf.workers.dev` is aborted + logged, so no
     test can silently mutate production. Reads pass through; a spec's own `page.route` stub (registered
     later) always wins over the guard.

## Open sub-decisions (sensible defaults chosen above; confirm when convenient)

- Exact domain / subdomain name for the widget (`photos.NEWDOMAIN`?).
- Photo count cap (default **6**) and display max edge (default **1600px**).
- Widget served by the Worker (default) vs a Cloudflare Pages project.

---

# Cold-start context (read this first if resuming in a fresh session)

**Status: not started — this is a plan only.** No code written yet. The domain
registration is being handled by the user out-of-band.

## Config values to get from the user before writing Worker/Access code
These are unknown until the domain + Cloudflare setup exist. Ask up front:
- ~~Registered domain + chosen **widget hostname**~~ → **`photos.sfinterventionassets.org`** (domain `sfinterventionassets.org`).
- Cloudflare **Zero Trust team name** → gives the JWKS/issuer URL
  `https://<team>.cloudflareaccess.com`.
- The **Access application AUD tag** (shown in the Access app's Overview) — needed for
  JWT `aud` validation.
- **Registered domain**: **`sfinterventionassets.org`** (zone created).
  **Widget hostname**: **`photos.sfinterventionassets.org`**.
- **R2 bucket name**: **`intervention-storage`** (created 2026-07-28).
- Confirm caps: **6** photos, **1600px** display / **320px** thumb, types
  `jpeg/png/webp`.

## Who does what (a code session cannot do the dashboard steps)
- **User, in dashboards:** register domain; create the R2 bucket (enabling R2 needs a
  card even for the free tier); create the Cloudflare **Access** application over the
  widget hostname with **One-Time PIN** enabled + policy "allow emails ending
  `@sfgov.org`"; put the upload Worker on the custom-domain route and **disable its
  `workers.dev` route**; hand back the AUD tag + team name.
- **Code session:** `wrangler.toml` bindings; Worker endpoints; the widget app;
  frontend buttons + list thumbnails + read-only gallery; `deploy.yml` staging; tests.
- Per memory [[github-commands-self-run]], give the user the `wrangler`/`git`/`gh`
  commands to run rather than running mutations for him.

## Repo conventions (match these)
- **Zero build step.** Static site served as files; ES modules loaded directly;
  Web Awesome + Leaflet via CDN. No bundler, no framework. Workers are plain JS.
- Frontend dev server: `npx http-server . -p 8090` (origin `http://localhost:8090` is
  already in `ALLOWED_ORIGINS`). Tests are Playwright.
- Public site origin in prod: `https://mayor-s-office-of-innovation.github.io`.
- Deployed public Worker: `https://interventions-api.safestreetssf.workers.dev`.

## Existing code — exact integration points
*(Line anchors from a 2026-07-27 exploration; re-verify, files may have shifted.)*

**Two separate frontends:**
- Homepage / list / **inline editor**: repo-root `index.html` + `js/app.js`.
- Create form + **read-only view**: `hypothesis/index.html` + `hypothesis/js/app.js`.

**Public Worker — [interventions-api/src/index.js](interventions-api/src/index.js):**
- Router `~77-125`; `corsHeaders` (origin allowlist, CORS-only — *not* a security
  boundary) `~128-137`.
- Record shape written in `createFull` `~310-338`; public projection `publicItem`
  `~164-194` (**add `photos[]` here**). `update` (PATCH, partial merge) `~344-386`.
- KV binding `INTERVENTIONS`; one key per item (`intervention:<uuid>`,
  `deleted:<uuid>`). `truncate` caps `~417-421`; `VALID_STATUSES` `~43`.
- Endpoints today: `GET/POST /interventions`, `POST /interventions/full`,
  `GET/PATCH/DELETE /interventions/:id`, `POST /interventions/:id/{close,reopen}`.
- `wrangler.toml`: `name = interventions-api`, `main = src/index.js`,
  `compatibility_date = 2026-06-01`, KV id `f5d4e1a36d594b448e2179f85c32f8d2`,
  **no R2 binding yet**. `ALLOWED_ORIGINS`/`REQUIRED_PATH`/`CITY_EMAIL_DOMAIN` at
  `~16-22`.

**Client — [js/interventions-client.js](js/interventions-client.js):**
- Base URL `~11`; **local override** via `localStorage.interventionsApi` `~9-14`
  (point at a local `wrangler dev`).
- `createFullIntervention(data)` → `POST /interventions/full` `~45-54`; it returns the
  new `id` and the create form keeps the user on the page (`editId` set so a 2nd submit
  PATCHes — reuse this to know the id when opening the widget).

**Homepage list — [js/app.js](js/app.js):**
- `INTERVENTION_COLUMNS` `~294-307` (columns auto-hide when empty — **add a thumbnail
  column or prepend into the name cell**); `renderInterventionRow` `~339-347`;
  `viewHref` `~292` (row → `./hypothesis/?view=<id>`); `savedToRow` `~411-435`.
- **Inline editor:** `renderEditor` `~352-401` (editable fields `~360-381`; `edited_by`
  required `~379-380`; location NOT editable `~383-390`); `saveEditor` `~579-625`
  (PATCH `~594-616`). Photos are managed in the widget, **not** in the PATCH body, so
  `saveEditor` stays untouched — just add an "Add / manage photos" button.

**Create form + read-only view — [hypothesis/js/app.js](hypothesis/js/app.js):**
- Form `#input-panel` in `hypothesis/index.html` `~50-160` (the "link files elsewhere"
  hint is `~150`). `handleSubmit` `~255-344` (data object `~287-307`).
- Read-only: `?view=<id>` → `loadRecord` `~130-200` → `renderViewDetails` `~214-253`
  (the `rows` array `~229-247` is where a **Photos gallery row** goes).

**Deploy — [.github/workflows/deploy.yml](.github/workflows/deploy.yml):** on push to
`main`; test gate (Playwright + python build validation) then stages files by hand into
`_site/` `~67-112` (`cp index.html styles.css`, `cp js/*.js`, per-project
`js/*.js` + `data/`). A "Verify homepage assets were staged" guard `~116-122`. **Any
new client JS file must be added to the staging globs + this guard or it 404s in prod.**

## New API contract (to implement)
**Public Worker (open):**
- `GET /photos/:interventionId/:photoId?v=thumb|full` → image bytes,
  `Cache-Control: public, max-age=31536000, immutable`; 404 if missing.
- `publicItem.photos[]` entries carry derived URLs pointing at this route
  (`{thumb, full}`), plus `id, w, h, caption, uploaded_at`.

**Upload Worker (behind Access, custom domain):**
- `GET /` → widget HTML (reads `?intervention=<id>`).
- `POST /:interventionId/photos` — `multipart/form-data` fields: `thumb` (jpeg blob),
  `full` (jpeg blob), `caption?` (text). Validates JWT + caps + magic bytes → writes
  R2 `photos/<id>/<photoId>-{full,thumb}.jpg` → appends KV `photos[]` with
  `uploaded_by` = JWT email. → `201 {photo}`.
- `DELETE /:interventionId/photos/:photoId` → deletes both R2 objects + the KV entry →
  `200 {ok:true}`.

## Access JWT validation (in the upload Worker)
- Read header `Cf-Access-Jwt-Assertion` (Access also sets a `CF_Authorization` cookie).
- Fetch JWKS `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; RS256-verify;
  assert `aud` === the app AUD tag, `iss` === `https://<team>.cloudflareaccess.com`,
  and `exp` not passed; read `email` from claims.
- Defense in depth: even though Access blocks unauthenticated requests to the protected
  host, still validate `aud`, and **disable the `workers.dev` route** so there's no
  un-gated path to the writer.
- Local dev has no Access → add a dev-only bypass (e.g. `if (env.DEV) email =
  'dev@sfgov.org'`) so `wrangler dev` works; never enable `DEV` in prod.

## Local dev & test
- Worker: `cd interventions-api && npx wrangler dev` (local KV + R2 simulation). New
  upload Worker: its own dir/`wrangler.toml`, same `wrangler dev` pattern.
- Frontend: `npx http-server . -p 8090`; set `localStorage.interventionsApi` to the
  local worker URL to exercise reads/writes against it.
- e2e: Playwright (`hypothesis/tests/e2e.spec.js`). Cover thumbnail rendering + the
  read-only gallery against a **seeded record with `photos[]`**. The Access-gated widget
  itself is impractical to e2e (real OTP) — plan a manual smoke test, or the dev-bypass
  above for a non-prod run.
- **Manual smoke test plan:** [test-plan-photo-uploads.md](test-plan-photo-uploads.md) —
  covers the live Access/OTP gate, the upload/serve/delete round-trip against real R2,
  and the widget→app `postMessage` refresh (the paths e2e can only stub).

## First concrete step when resuming
Do **build order step 1** (see above): add the R2 binding + `photos[]` to the public
Worker's model + `publicItem`, and the `GET /photos/...` serve route. Then hand-seed one
record with a photo so the display-only UI (steps 2) can be built and tested before any
auth exists.
