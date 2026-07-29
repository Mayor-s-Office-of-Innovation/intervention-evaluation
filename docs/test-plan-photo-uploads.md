# Manual test plan — intervention photo uploads

Companion to [plan-photo-uploads.md](plan-photo-uploads.md). Covers the parts that
automated Playwright e2e **cannot** reach: the Cloudflare-Access-gated upload widget
(real OTP login), the two-Worker upload/serve/delete round-trip against real R2, and
the end-to-end integration where an upload in the widget appears back in the app.

**What e2e already covers (don't re-test manually):** homepage list thumbnails, the
read-only view gallery, the "Add / manage photos" buttons revealing + opening the
widget URL, and the `postMessage` strip refresh (all stubbed). This plan is the
**live** path those stubs stand in for.

---

## Preconditions

Before running, confirm all of the following are true. If any is false, the auth/upload
cases will fail for infrastructure reasons, not product bugs.

- [ ] **Public Worker deployed** (`interventions-api`) with the R2 **read** binding and
      the `GET /photos/:id/:pid` serve route live.
- [ ] **Upload Worker deployed** (`intervention-photos-upload`) on its custom domain
      route `photos.sfinterventionassets.org`, and its **`workers.dev` route is
      DISABLED** (verify — this is the un-gated backdoor the design closes).
- [ ] **Cloudflare Access application** covers the whole `photos.sfinterventionassets.org`
      hostname: **One-Time PIN** enabled, policy = allow **emails ending `@sfgov.org`**.
- [ ] `photo-upload-worker/wrangler.toml` `[vars]` match the live Access app:
      `ACCESS_TEAM_DOMAIN` = `https://bitter-recipe-ab41.cloudflareaccess.com`,
      `ACCESS_AUD` = the app's AUD tag, `OPENER_ORIGIN` = the public site origin,
      `CITY_EMAIL_DOMAIN` = `sfgov.org`. **`DEV` is NOT set in prod.**
- [ ] Frontend deployed (github.io) OR run locally against prod Workers by clearing
      `localStorage.interventionsApi` / `localStorage.photoWidget` (defaults point at prod).
- [ ] You have a working **`@sfgov.org` mailbox** to receive OTP codes, and (for the
      negative auth case) access to a **non-`@sfgov.org`** address.

**Test assets to prepare:**
- [ ] A large JPEG (e.g. a phone photo ≥ 3000px, > 2 MB) — exercises client resize.
- [ ] A PNG and a WebP — allowed input types (widget re-encodes to JPEG).
- [ ] A JPEG that contains **GPS EXIF** (a raw phone photo) — for the EXIF-strip check.
- [ ] A non-image file renamed to `.jpg` (e.g. a PDF or text file) — magic-byte reject.
- [ ] 7 distinct images total on one intervention — to hit the 6-photo cap.

---

## A. Access / authentication gate

| # | Steps | Expected |
|---|-------|----------|
| A1 | In a fresh/incognito window, open `https://photos.sfinterventionassets.org/?intervention=<realId>` | Redirected to Cloudflare Access **One-Time PIN** login, NOT the widget. |
| A2 | Enter your `@sfgov.org` email → submit → enter the emailed code | Access grants a session; the widget page loads and shows the intervention's title/context. |
| A3 | Repeat A1–A2 with a **non-`@sfgov.org`** email | Access rejects (policy denies); the widget never loads. No code should grant entry. |
| A4 | While logged out, `curl -X POST https://photos.sfinterventionassets.org/<id>/photos` (no Access token) | `401` (Access blocks at the edge; even if it reached the Worker, `authedEmail` throws "missing Access token"). |
| A5 | Confirm the `workers.dev` route is disabled: hit the old `*.workers.dev` upload URL | Route does not resolve / 404 — there is no un-gated path to the writer. |

## B. Widget upload — happy path

| # | Steps | Expected |
|---|-------|----------|
| B1 | In the authenticated widget, drag-drop the **large JPEG** onto the drop zone | Preview appears; on upload it returns `201`; the photo shows in the widget's current-photos list. |
| B2 | Add an optional **caption**, upload | Caption is stored (visible after refresh; ≤ 200 chars — longer is truncated). |
| B3 | Upload the **PNG** and the **WebP** via the file picker | Both accepted; widget re-encodes to JPEG client-side before POST (served copies are JPEG). |
| B4 | Reload the widget page | Previously uploaded photos persist (re-fetched from the public Worker), proving R2 + KV write stuck. |
| B5 | Observe the "done" affordance | Widget shows a "you can close this tab" state after changes. |

## C. Widget delete

| # | Steps | Expected |
|---|-------|----------|
| C1 | Click the **Delete/trash** control on one photo | Photo removed from the widget list; `DELETE` returns `200`. |
| C2 | In a new tab, request that photo's serve URL `/photos/<id>/<pid>?v=full` | `404` — both R2 objects (full+thumb) were deleted. |
| C3 | Delete the same photo again (or re-issue the DELETE) | Idempotent `200` (no error on already-gone). |

## D. Caps & validation (negative)

Note the two layers: the **widget** guards client-side (file-type regex, per-upload
count, canvas resize keeps every image JPEG and well under the size cap), and the
**Worker** re-checks server-side as a backstop. Cases D1/D2b are reachable from the
widget UI; the server backstops (D2a/D3/D4) can only be provoked by hitting the API
directly (curl with a valid Access cookie), since the widget never sends a non-JPEG,
a missing part, or an oversize blob.

| # | Steps | Expected |
|---|-------|----------|
| D1 | Upload photos until the intervention has **6**, then try a **7th** (via the widget) | Widget blocks it client-side ("Only N more photo(s) allowed (max 6)"); even if forced, the server returns `400` "max 6 photos per intervention". Count stays at 6. |
| D2b | In the widget, choose the **non-image renamed `.jpg`** (e.g. a PDF) | Widget rejects it client-side on MIME: "Only JPEG, PNG or WebP files are allowed." (never reaches the server). |
| D2a | **curl** a non-JPEG body as the `full` part (bypassing the widget) | `400` "images must be JPEG (the widget re-encodes them)" — server magic-byte sniff `FF D8 FF`, not filename/MIME. |
| D3 | **curl** an upload with only `full`, no `thumb` | `400` "both `full` and `thumb` image parts are required". |
| D4 | **curl** an image part > ~3 MB | `400` "image too large" (`MAX_BYTES` backstop). |
| D5 | Open the widget for a **non-existent / deleted** intervention id | Widget shows "Could not load this intervention: intervention not found" (context `GET` → `404`). |

## E. Entry point — create form (hypothesis tool)

| # | Steps | Expected |
|---|-------|----------|
| E1 | In the hypothesis tool, fill a new intervention (title, name, lever, drop a pin) and **Submit** | Save succeeds; **"Add / manage photos"** button appears in the results share bar. |
| E2 | Click "Add / manage photos" | Opens `photos.sfinterventionassets.org/?intervention=<newId>` in a new tab (Access login on first use). |
| E3 | Upload a photo in the widget, return to the create tab **without reloading** | The inline photo strip updates automatically (via `postMessage`) — no manual refresh. |
| E4 | Delete the photo in the widget | Strip updates back to the empty state automatically. |

## F. Entry point — homepage inline editor

| # | Steps | Expected |
|---|-------|----------|
| F1 | On the homepage, find a saved intervention → **Edit** | Editor expands with a **Photos** block: strip + "Add / manage photos" button + the "saves immediately, no Save-changes needed" note. |
| F2 | With un-saved edits in other editor fields, upload a photo via the widget | The editor's photo strip repaints in place; **un-saved text in other fields is NOT wiped** (targeted strip update, not a full re-render). |
| F3 | Close the editor (Cancel/Save), reopen it | Strip reflects the current photos; the row's Photo column now shows a thumbnail. |

## G. Display — homepage list thumbnails

| # | Steps | Expected |
|---|-------|----------|
| G1 | View the list for a district whose interventions have photos | The **Photo** column shows `photos[0]` as a thumbnail; a `+N` badge appears when > 1. |
| G2 | View a district where NO intervention has photos | The Photo column **auto-hides** (no empty column). |
| G3 | Inspect a thumbnail's `src` | Resolves to the API base + `/photos/<id>/<pid>?v=thumb` (absolute, joined by `photoSrc`). |

## H. Display — read-only view gallery

| # | Steps | Expected |
|---|-------|----------|
| H1 | Open a photo-bearing intervention's read-only view (`/hypothesis/?view=<id>`) | A **Photos** gallery renders the thumbnails with captions. |
| H2 | Click a gallery thumbnail | Opens the **full-size** image (`?v=full`) in a new tab. |

## I. Security & privacy

| # | Steps | Expected |
|---|-------|----------|
| I1 | Upload the **GPS-EXIF JPEG**, then download the served `?v=full` and inspect its EXIF (e.g. `exiftool`) | **No GPS/EXIF** — the client `<canvas>` re-encode strips it. |
| I2 | `GET /interventions/<id>` from the public Worker and inspect the JSON | `photos[]` carry `id/w/h/caption/uploaded_at` + relative `thumb`/`full` URLs; **`uploaded_by` / email is NOT present** (audit-only, never projected publicly). |
| I3 | From a page on a **different origin**, `postMessage` a fake `{type:'photos-updated'}` to an open app tab | Ignored — the app's `onPhotosUpdated` only accepts messages whose origin === the widget origin. |
| I4 | Inspect a served photo response headers | `Cache-Control: public, max-age=31536000, immutable` + an ETag; `Content-Type: image/jpeg`. |

## J. Cross-browser / device

| # | Steps | Expected |
|---|-------|----------|
| J1 | Run B1–B4 (upload round-trip) in **Safari** | Works — the widget is same-origin to its Worker, so the Access cookie rides along (the whole reason for the separate-domain design; a cross-site `fetch()` from github.io would have failed here). |
| J2 | Open the widget on a **phone**, upload a camera photo | Resize + upload succeed on mobile; served thumbnail renders on the homepage list. |

---

## Regression checklist (post-deploy smoke)

- [ ] Homepage, hypothesis create, and read-only view all load with **no console errors**
      (photo code shouldn't break pages for interventions that have zero photos).
- [ ] An intervention with **no photos** shows the empty-state strip and no Photo column.
- [ ] Saving/archiving an intervention still works (photos are managed in the widget, not
      in the PATCH body — `saveEditor` is untouched).
- [ ] `npm test` green (e2e + validation + parity) on the branch before merge.

## Sign-off

| Area | Tester | Date | Result (pass/fail + notes) |
|------|--------|------|----------------------------|
| A. Auth gate | | | |
| B. Upload | | | |
| C. Delete | | | |
| D. Caps/validation | | | |
| E. Create-form entry | | | |
| F. Editor entry | | | |
| G. List thumbnails | | | |
| H. Read-only gallery | | | |
| I. Security/privacy | | | |
| J. Cross-browser | | | |
