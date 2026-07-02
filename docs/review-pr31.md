# Code review — PR #31 (Interventions flow UI overhaul)

PR: https://github.com/Mayor-s-Office-of-Innovation/intervention-evaluation/pull/31
Branch: `interventions-flow` → `main` · ~1,680 lines across 11 files
Reviewed: 2026-06-29

## What it does

Converts the `/hypothesis/` page from a read-only "does the data support my hypothesis?"
checker into a full **Add/Edit intervention** form (title, description, levers, owner,
district, status, dates, attachments). Adds a Cloudflare Worker write surface —
`POST /interventions/full`, `PATCH /:id`, `close`/`reopen`, and R2 attachment
upload/download — plus a homepage table redesign (OKRs + Interventions side-by-side,
status badges, close/reopen, view-closed toggle).

Coherent feature; two issues break the headline flows in production, plus several
server-side concerns.

## Findings (most severe first)

### 1. [FIXED] PATCH missing from CORS allow-methods → all edits fail
> **Applied:** added `PATCH` to `Access-Control-Allow-Methods` in `corsHeaders`.

`interventions-api/src/index.js:145` — `Access-Control-Allow-Methods: "GET,POST,DELETE,OPTIONS"`
omits `PATCH`, but `updateIntervention()` issues a `PATCH` (`js/interventions-client.js:58`).
Site (`mayor-s-office-of-innovation.github.io`) and API (`interventions-api.safestreetssf.workers.dev`)
are cross-origin, so the browser preflights; with PATCH absent it blocks the request.
Editing an intervention always fails with a CORS error.
**Fix:** add `PATCH` to the allow-methods list.

### 2. [FIXED] Email fabricated from name → submit fails for any name with a space
`hypothesis/js/app.js` (handleSubmit) — `email: submitter + '@sfgov.org'`. Worker validated with
`isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`. `Jane Doe` → `"Jane Doe@sfgov.org"` → fails regex →
`400 "a valid email is required"`. Most real names have a space, so submission was broken for the
common case (create and edit).
> **Applied (per discussion — drop the fabrication instead of faking an email):**
> - Client: removed the `email: submitter + '@sfgov.org'` line; the form already sends `person_submitted`.
> - Server `createFull`: email is now **optional** (recorded only if a real one is provided, never
>   fabricated); `person_submitted` is the required field instead; `cityEmailGuess` guards on email
>   presence. The legacy URL-based `create()` path still requires a real email (audit-trail deterrent).

### 3. [WON'T FIX — accepted] `/interventions/full` dropped the origin-allowlist spam defense
> **Decision:** accepted as-is. The origin allowlist was only ever a casual-browser deterrent
> (any `curl` bypassed it), so dropping it on the form path isn't a meaningful loss. Revisit only
> if real spam/abuse shows up, at which point a proper control (auth, rate limit, captcha) is the answer.

`interventions-api/src/index.js` (createFull) — legacy `create()` ran `validateUrl()` (origin must be
in `ALLOWED_ORIGINS` + `/hypothesis/` path), described in the file header as "the main spam defense."
`createFull` requires no URL and does no origin check; CORS only constrains browsers, not `curl`.
Anyone can `POST /interventions/full` with a syntactically valid email and write records. The same
gap applies to the new unauthenticated `PATCH`/`close`/`reopen` (record IDs are returned in the public
list, so they're guessable) — though `DELETE` was already unauthenticated, so this is partly consistent
with the existing trust model. The new-record spam path is the sharpest regression.

### 4. [FIXED] nextId counter is a non-atomic read-modify-write → duplicate intervention_ids
> **Applied:** `nextId` now claims a per-id marker key (`counter:claim:CEN006`) and bumps past any
> already-claimed number, with a guaranteed-unique random-suffix fallback (`CEN-ab12cd34`) so two
> records can never share an id. KV still isn't transactional — a hard guarantee under real
> concurrency would need a Durable Object — but duplicates are now self-healing, not silent.

`interventions-api/src/index.js` (nextId) — `get(counter) → +1 → put(counter)` with no CAS; KV is
eventually consistent. Two near-simultaneous `Central` creates both read `5`, both write `6`, both get
`CEN006`. The file header claims the per-key layout "avoids the read-modify-write race" — nextId
reintroduces exactly that for business IDs.

### 5. [FIXED] Editing a record with no stored coordinates overwrites its location with the Koshland default
> **Applied:** added a `locSet` flag (set when the user drops a pin, or when an edited record supplies
> coords). `handleSubmit` now sends `lat`/`lng` only when `locSet` is true, so an edit with no pin
> leaves the stored location unchanged instead of stamping it with the Koshland default.

`hypothesis/js/app.js` (loadEditRecord / handleSubmit) — `loadEditRecord` only sets `loc` when
`editRecord.lat && editRecord.lng` are truthy; otherwise `loc` stays at the module default `{...KOSHLAND}`.
`handleSubmit` always writes `lat: loc.lat, lng: loc.lng`. Editing any intervention that lacks coordinates
(e.g. legacy URL-based saved rows without `lat`/`lng`) stamps it with Koshland Park coords. Silent data
corruption on save.

### 6. [SUPERSEDED — R2 removed] downloadAttachment loose filename match returns the wrong file
> **Update:** R2 file attachments were removed entirely (decision: don't run object storage for this
> project). Supporting documents are now referenced by URL in a `links` field; users store the files
> elsewhere (Drive/SharePoint). The attachment upload/download/list code, the `[[r2_buckets]]` binding,
> and the client attachment helpers are all deleted, so this finding (and #7) no longer apply. The
> hardening below was applied first, then removed with the code.

`interventions-api/src/index.js` (downloadAttachment) — `.find(a => a.filename === filename || a.key.endsWith(filename))`
plus a `(.+)` route capture means a request for `report.pdf` also matches a stored `summary-report.pdf`
via `endsWith`, returning whichever is first in the array. Use an exact index/key lookup instead of
`endsWith` on attacker-supplied input.
> **Applied:** match exactly on `a.filename` after `decodeURIComponent` (the path arrives URL-encoded,
> so the old exact branch also failed for names with spaces/Unicode); dropped the `key.endsWith(...)`
> clause entirely.

### 7. [SUPERSEDED — R2 removed] Content-Disposition built from unsanitized filename
`interventions-api/src/index.js` (downloadAttachment) — `processUpload` sanitizes only the R2 key
(`safeName`) but stores `attachment.filename = file.name` raw; download emits
`inline; filename="${attachment.filename}"`. A name containing `"` lets the uploader spoof the download
name / smuggle disposition params (with `inline` + 1-year `Cache-Control`). Sanitize or quote-escape
the filename in the header.
> **Applied:** header now uses an ASCII fallback with quotes/control chars stripped
> (`filename="..."`) plus an RFC 5987 `filename*=UTF-8''<encoded>` form, closing the injection while
> still conveying the real name.

## Minor (not ranked)

- `start_date`/`end_date` are written through with no format validation (unlike text fields, which go
  through `truncate`), so `PATCH {"end_date":"not-a-date"}` persists garbage that the timeline renders
  as `Invalid Date`.
- `person_submitted`/`last_edited_by` default to `email.split("@")[0]`, putting the email local-part
  into the public projection — small PII bleed.
- When a district has only closed interventions and `showClosed` is false, the empty-state guard
  (`rows.length === 0 && closedCount === 0`, `js/app.js:382`) is skipped → header-only empty table plus
  the "View closed (N)" toggle, instead of a clean empty message.

## Checked and refuted (not findings)

- `in-expect` **does** have `multiple`, so assigning an array to `.value` is correct.
- Curated TSV rows have **no `id` column**, so they never render Edit/Close/Reopen buttons — close/reopen
  cannot fire on a curated row.
- `close`/`reopen` worker endpoints always return `{ item }` on 200 (non-200 throws), so the cache is
  never poisoned with `undefined`.
- `publicItem` continues to omit `email`/`cityEmailGuess` from the public list — read-side PII intact.

## Suggested order

Fix **#1** and **#2** before merge (both break headline flows). Then **#3 / #4 / #5**.
Status: **#1, #2, #4, #5 fixed; #3 accepted (won't fix); #6, #7 superseded — R2/attachments
removed in favor of a `links` field.**

### Follow-up change: R2 attachments → document links

Per decision, file attachments (R2) were dropped. Supporting documents are now referenced by URL:
- Form: the attachment dropzone is replaced by a **"Related documents"** textarea (`in-links`,
  one URL per line).
- Worker: `links` is a sanitized array on the record (http(s) only, ≤2048 chars each, ≤20). All
  attachment endpoints/functions, the `[[r2_buckets]]` binding, and the `attachments` field are gone.
- Client: `uploadAttachment`/`listAttachments`/`getAttachmentUrl` removed.

---

## Test & deploy plan

### ⚠️ First: the new API must be local-or-deployed before the edit/write flow works

The front-end (`js/interventions-client.js`) defaults `API` to the **deployed** Worker, even on a
local site. That deployed Worker is still the **pre-PR** code — its `/interventions/:id` route only
handles `DELETE`. The endpoints this PR adds (`GET`/`PATCH /interventions/:id`,
`POST /interventions/full`, `close`/`reopen`) don't exist there yet. So the new front-end against the
old prod backend fails:

- **Symptom:** click **Edit** → `GET /interventions/:id` → **HTTP 405** ("method not allowed"), page
  alerts "Could not load intervention for editing." The list still loads (plain `GET /interventions`
  is unchanged), so only the new per-record calls fail.
- **Cause:** old backend + new front-end. **Not a code bug.**
- **Fix:** run the updated Worker locally and repoint the front-end (see *Local test loop*), **or**
  deploy the Worker (`wrangler deploy`) so prod has the new endpoints.

Sanity check in DevTools → Network: the failing request's host tells you which backend you're on
(`*.workers.dev` = deployed/old; `localhost:8787` = local/new).

### Does local testing touch production? — No, *if* you do one thing first.

- `npx wrangler dev` uses a **simulated local KV** (under `interventions-api/.wrangler/`).
  It never reads or writes the real Cloudflare KV. The placeholder bits in `wrangler.toml` are fine
  for dev. So the **Worker side is safe** to run locally.
- The trap is the **front-end**: `js/interventions-client.js` defaults `API` to the *deployed* Worker
  **even on a local site**. So if you open the local site and click Submit/Edit without repointing it,
  the write goes to **production KV**. Always set this first in the browser console:
  ```js
  localStorage.interventionsApi = 'http://localhost:8787'   // removeItem to go back to prod
  ```
  Confirm in the Network tab that requests hit `localhost:8787`, not `*.workers.dev`.

### Do we need to run KV commands? — No. Nothing to provision.

- The **KV namespace already exists** (real `id` in `wrangler.toml`, used by the live saved-interventions
  feature). Nothing to create. Counter/claim keys are created on the fly by `nextId`.
- **No R2** anymore — the attachments bucket was removed, so there's no bucket to create. Deploy is
  just `wrangler deploy`.

### Local test loop

```bash
cd interventions-api && npx wrangler dev          # new Worker on :8787, local KV
# (optional) seed one record into LOCAL kv so the list isn't empty:
npx wrangler kv bulk put seed.json --binding INTERVENTIONS --local
# separate shell, from repo root:
npx http-server -p 8090 .                         # or the repo's usual static-serve command
```
Then, **required**, in the site's browser console (same origin as the page) — repoint the front-end
at the local Worker and reload:
```js
localStorage.interventionsApi = 'http://localhost:8787'   // removeItem to go back to prod
```
Confirm in Network that requests hit `localhost:8787`, not `*.workers.dev`.

> **Tip:** the seed record is a legacy URL-only intervention. The cleanest end-to-end check of the new
> flow is to **Submit a fresh intervention** via the form (works now that the write endpoints are
> local), then **Edit** that one — it exercises `createFull` → `getOne` → `PATCH` in sequence.

**Per-fix checks** (mix of curl + browser; CORS is browser-only, so #1 must be checked in a browser):

| Fix | How to verify |
| --- | --- |
| #1 PATCH/CORS | In the browser, open an intervention's **Edit**, change a field, Save. Expect **no CORS error** in console and the row updates. (curl can't test CORS — it ignores it.) |
| #2 email | `curl -i -X POST :8787/interventions/full -H 'content-type: application/json' -d '{"intervention":"t","district":"Central","person_submitted":"Jane Doe"}'` → **201** (name with a space now works). Omit `person_submitted` → **400 "your name is required"**. Add `"email":"bad"` → **400 "email is not valid"**. |
| #4 nextId | Create two interventions in the same district; confirm **distinct** `intervention_id`s (e.g. `CEN001`, `CEN002`). |
| #5 location | Edit a record that has **no** coords, save without touching the map → fetch it via `GET :8787/interventions/:id` and confirm `lat`/`lng` are still null/unchanged (not Koshland `37.773…`). |
| links | Add two lines in **Related documents** (`example.com/a` and `https://example.com/b`), submit → `GET :8787/interventions/:id` shows `links: ["https://example.com/a","https://example.com/b"]` (bare host got `https://`). A non-URL line is dropped. |

### Deploy

```bash
cd interventions-api
npx wrangler deploy                                        # pushes the Worker to prod (uses the real KV)
```
The front-end is static (GitHub Pages) and needs no separate API config change — it already points at
the deployed Worker by default. Just merge/deploy the static files as usual. Once the Worker is
deployed, the edit/write flow works against prod with no repoint. If you set the local override while
testing, clear it: `localStorage.removeItem('interventionsApi')`.

**Ordering:** deploy the **Worker first**, then the static site. If the new front-end ships before the
Worker, live users hit the same 405 (old backend, new front-end) until the Worker catches up.

> **Note:** these edits are on the local `pr-31-review` branch (fetched from `refs/pull/31/head`).
> To land them on the PR, commit and push to the PR's source branch (`interventions-flow`).
