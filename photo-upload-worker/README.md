# intervention-photos-upload

The **only writer** of intervention photos. A small Cloudflare Worker that serves an
upload widget and writes photo bytes to R2 + metadata to the shared KV record. It sits
entirely behind **Cloudflare Access** (One-Time PIN, `@sfgov.org`) on
`photos.sfinterventionassets.org`.

The public [`interventions-api`](../interventions-api) Worker only **reads/serves** the
bytes this Worker writes (`GET /photos/:id/:pid?v=thumb|full`). See the full design in
[../docs/plan-photo-uploads.md](../docs/plan-photo-uploads.md).

## Endpoints (all same-origin to the widget)

| Method + path | Purpose |
|---|---|
| `GET /` | The upload widget (inline HTML/JS, no build step). Reads `?intervention=<id>`. |
| `GET /:interventionId` | Widget context: `{ intervention, intervention_id, district, max, photos[] }`. |
| `POST /:interventionId/photos` | multipart `full`, `thumb` (JPEG blobs) + `w?`, `h?`, `caption?` → `201 { photo }`. |
| `DELETE /:interventionId/photos/:photoId` | Deletes both R2 objects + the KV entry (idempotent) → `200 { ok:true }`. |

Every request is authenticated: the Access cookie rides along same-site because the
widget is served from this same host. The Worker **also** verifies the Access JWT
(`iss`/`aud`/`exp`/`nbf` + RS256 signature against the team JWKS) as defense in depth,
and asserts the email ends in `@sfgov.org`.

## Storage

- **R2** bucket `intervention-storage` (binding `PHOTOS`, write): objects at
  `photos/<interventionId>/<photoId>-{full,thumb}.jpg`.
- **KV** namespace `INTERVENTIONS` — the **same** namespace as `interventions-api`
  (both bind id `f5d4e1a36d594b448e2179f85c32f8d2`). Photo metadata is appended to the
  record's `photos[]`, stamping `uploaded_by` (verified email) + `uploaded_at`.
  `uploaded_by` is **never** projected to any public reader.

## Caps / validation

- Max **6** photos per intervention (append past the cap → 400).
- Per-image body backstop **3 MB** (the widget resizes to ≤1600px full / ≤320px thumb).
- Server-side **magic-byte** sniff: both parts must be real JPEG (`FF D8 FF`). The
  widget always re-encodes to JPEG via `<canvas>`, which also strips EXIF/GPS.

## Local dev

No Access locally, so use the `DEV:1` bypass (returns `dev@sfgov.org`). Share
`--persist-to` with a `wrangler dev` of `interventions-api` so both see the same local
KV + R2:

```sh
# terminal 1 — public read/serve worker
cd interventions-api
npx wrangler dev --port 8787 --persist-to /tmp/wshared

# terminal 2 — this upload worker (DEV bypass; point PUBLIC_PHOTO_BASE at terminal 1)
cd photo-upload-worker
npx wrangler dev --port 8788 --var DEV:1 \
  --var PUBLIC_PHOTO_BASE:http://localhost:8787 --persist-to /tmp/wshared
```

Then create an intervention on `:8787`, open
`http://localhost:8788/?intervention=<id>` for the widget, or drive it with `curl`
(`-F full=@a.jpg -F thumb=@b.jpg`). **Never** set `DEV` in `wrangler.toml` or in prod.

## Deploy

```sh
cd photo-upload-worker
npx wrangler deploy
```

Then, in the Cloudflare dashboard (one-time):

1. Put the Worker on the custom-domain route **`photos.sfinterventionassets.org`** and
   **disable its `*.workers.dev` route** (removes the un-gated backdoor to the writer).
2. Create a **Cloudflare Access** application over that hostname: enable **One-Time
   PIN**, policy = allow **emails ending in `@sfgov.org`**.
3. Copy the app's **AUD tag** (Access app → Overview → Application Audience (AUD) Tag)
   and your **Zero Trust team domain** (`https://<team>.cloudflareaccess.com`) into
   `wrangler.toml` `[vars]` as `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN`, then redeploy.

Until `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` are set, the Worker rejects every write with
`401 Access is not configured` — safe by default.
