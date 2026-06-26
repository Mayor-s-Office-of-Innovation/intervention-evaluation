# interventions-api

Cloudflare Worker + KV backing the homepage's "Saved intervention evaluations" list.
See [`../plan-saved-interventions.md`](../plan-saved-interventions.md) for the design + decisions.

**Front-end pieces** (the API base URL is set once in [`../js/interventions-client.js`](../js/interventions-client.js)):
- [`../js/saved-interventions.js`](../js/saved-interventions.js) — homepage list + per-row soft-delete.
- [`../hypothesis/js/save.js`](../hypothesis/js/save.js) — the hypothesis tool's "Save this intervention" button (a `<dialog>` that POSTs `{url, email}`).

## Where the front-end points

`js/interventions-client.js` targets the **deployed Worker by default — everywhere, including local
dev** — so the homepage list and Save button work without running `wrangler dev`. (Saves from a local
site therefore go to **production** KV.) To point the site at a **local** Worker instead, in the
browser console:

```js
localStorage.interventionsApi = 'http://localhost:8787'   // clear it (removeItem) to go back to prod
```

## The save → list → delete loop against a LOCAL Worker

1. `cd interventions-api && npx wrangler dev` (Worker on :8787, local KV).
2. In the site's browser console: `localStorage.interventionsApi = 'http://localhost:8787'`.
3. Serve the site (`npm run dev` → :8090), open the hypothesis tool, run a report, click
   **Save this intervention**, enter a city email → it POSTs the current URL to the local Worker.
4. The homepage's "Saved intervention evaluations" now lists it; the trash button soft-deletes it.

## Run locally (no Cloudflare account needed)

```bash
cd interventions-api
npx wrangler dev          # serves on http://localhost:8787 with a simulated local KV
```

The placeholder KV `id` in `wrangler.toml` is fine for local dev. Test it:

```bash
# save (valid: a hypothesis URL from an allowlisted origin + a what param + an email)
curl -i -X POST http://localhost:8787/interventions \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:8090/hypothesis/?dp=drug&date=2026-05-11&what=plain+clothes+officers","email":"someone@sfgov.org"}'

# list (active only; note: no email field is ever returned)
curl -s http://localhost:8787/interventions | jq

# soft-delete (use an id from the list)
curl -i -X DELETE http://localhost:8787/interventions/<id>

# rejected: not a hypothesis URL / wrong origin
curl -i -X POST http://localhost:8787/interventions \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://evil.example.com/spam","email":"a@b.com"}'
```

## Seed the existing example intervention

`seed.json` carries the homepage's original hardcoded "Plain clothes officers" evaluation so it
survives the move to KV. Load it (idempotent — fixed key):

```bash
# local KV (for wrangler dev) — wrangler v4 defaults to local
npx wrangler kv bulk put seed.json --binding INTERVENTIONS
# production KV (after deploy) — v4 needs --remote to hit the real namespace
npx wrangler kv bulk put seed.json --binding INTERVENTIONS --remote
```

(wrangler **v4 KV commands default to local**; pass `--remote` for production. Older wrangler used the
colon form `wrangler kv:bulk put` and defaulted to remote.)

## Deploy

```bash
npx wrangler kv namespace create INTERVENTIONS   # prints an id → paste into wrangler.toml
npx wrangler deploy                              # prints the live Worker URL
```

Then set the live Worker URL in [`../js/interventions-client.js`](../js/interventions-client.js)
(replace `interventions-api.REPLACE-SUBDOMAIN.workers.dev`).

## Operations & data lifecycle

How records come and go. **wrangler v4 KV commands default to local** — add `--remote` to operate on
production KV. (Commands below show local; append `--remote` for prod.)

| Operation | Command / action | Effect |
|-----------|------------------|--------|
| **Seed the example** | `npx wrangler kv bulk put seed.json --binding INTERVENTIONS --local` | Writes the fixed-key record `intervention:seed-plain-clothes-hayes` (active). Idempotent. |
| **Soft-delete** | trash button on the homepage, or `DELETE /interventions/<id>` | Moves `intervention:<id>` → `deleted:<id>` and removes the row. **Persists** — it stays gone across `wrangler dev` restarts (local KV is saved to `.wrangler/state/`). |
| **Restore the seed** | re-run the seed `kv bulk put` | The fixed key is rewritten as active → the item reappears. (The old `deleted:<id>` tombstone lingers, harmless.) |
| **Restore any item** | `npx wrangler kv key get "deleted:<id>" --binding INTERVENTIONS --local` then `kv key put "intervention:<id>" '<json with deleted:false>'` | Promotes a tombstone back to active. |
| **Inspect** | `npx wrangler kv key list --binding INTERVENTIONS --local` · `kv key get "intervention:<id>" …` | See all keys / one record (the only place `email` is visible). |
| **Full reset (local)** | delete the `.wrangler/state` dir, then re-seed | Wipes local KV back to empty. |
| **Hard-delete (rare)** | `npx wrangler kv key delete "deleted:<id>" --binding INTERVENTIONS` | Permanently removes a tombstone (the soft-delete archive). |

Restarting `wrangler dev` alone never changes data — only the commands above do. **Production behaves
identically** (drop `--local`; deletes persist in real KV; re-seeding likewise restores).

## Notes

- **Spam defense is the origin allowlist** (`ALLOWED_ORIGINS` in `wrangler.toml`) + length caps — not
  auth (no per-IP rate limit). The **city email is recorded, not enforced** (`cityEmailGuess` flag) so
  you can crack down later. Email is **PII: stored server-side only, never in the public list.**
- `GET /interventions` does one KV read per item (N+1) — fine for a small curated list; revisit only
  if it grows into the thousands.
- Soft-deleted records live under `deleted:<id>` (recoverable), never hard-removed.
