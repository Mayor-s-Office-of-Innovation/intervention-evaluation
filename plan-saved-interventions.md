# Plan — Saved interventions (Cloudflare Worker + KV)

Let people save an intervention they researched with the hypothesis tool, and list the saved ones as
links on the homepage. The **full research state already lives in the URL**, so saving the URL is all
we need. First Cloudflare + KV build — treat it as an experiment: run it locally with `wrangler dev`
before deploying.

## 1. Locked decisions

- **Stack:** Cloudflare **Worker + KV** (not Lambda/DynamoDB). For a sub-kilobyte shared list behind a
  static GitHub Pages site, KV is the lighter primitive — no IAM/table/provisioning, one-command
  deploy, edge-fast reads. The AWS default in the web-dev standards targets a heavier class of
  problem than this. *(Optional follow-up: amend the web-dev skill to note KV as the preferred
  lightweight option for tiny static-site persistence.)*
- **Write access:** **public**, guarded by an origin allowlist + length caps + light rate-limiting
  (§6). To save, the form **asks for a city email** — recorded but **not enforced** for now (a
  deterrent + audit trail, not auth; "crack down later" by enforcing the domain / blocklist). The
  email is unverified, so it's accountability, not access control. Stored **server-side only — never
  returned by the public list** (PII).
- **Link text:** derived from the saved URL's **`what` param** (the intervention description, e.g.
  `what=plain+clothes+officers` → "Plain clothes officers"). No separate label field — the URL carries
  it. Secondary context (dashboard `dp`, `date`) can render as a small sub-line.
- **Delete = soft delete:** flip a `deleted` flag (and move the record to a `deleted:` key) so it drops
  off the list but is retained/recoverable — never hard-removed.

## 2. Why the URL is enough

A hypothesis-tool URL already encodes everything:
`./hypothesis/?dp=drug&date=2026-05-11&lat=…&lng=…&r=200&from=…&to=…&what=plain+clothes+officers`
- `what` → link text (the intervention).
- `dp` + `date` → optional secondary context line.
- the rest → the full reproducible research state when the link is opened.

So a saved record is essentially just `{ url, created, deleted }` + an `id`.

## 3. Data model (KV, one key per item)

One key per intervention (avoids the read-modify-write race a single JSON blob would have on
concurrent saves):

```
key:   intervention:<id>           # id = crypto.randomUUID()
value: {
  "url": "<hypothesis URL>",
  "created": "<ISO>",
  "deleted": false,
  "email": "<as typed>",           # PII — server-side only, NEVER in the public GET response
  "cityEmailGuess": true|false     # does it match the city domain? recorded, NOT enforced yet
}

# soft delete moves it aside (retained, off the active list):
key:   deleted:<id>
value: { ...same..., "deleted": true, "deletedAt": "<ISO>" }
```

List by prefix (`intervention:`) for the homepage; `deleted:` holds the archive. The public list
projects only `{ id, url, what, dp, date, created }` — `email`/`cityEmailGuess` stay server-side.

## 4. Worker API

A single Worker, JSON in/out, CORS scoped to the GitHub Pages origin.

| Method | Path | Action |
|--------|------|--------|
| `GET`  | `/interventions` | list active (`intervention:` prefix), newest first |
| `POST` | `/interventions` | body `{ url, email }` → validate (§6), compute `cityEmailGuess`, write `intervention:<id>` |
| `DELETE` | `/interventions/:id` | move `intervention:<id>` → `deleted:<id>` (soft) |

- **CORS:** `Access-Control-Allow-Origin: https://<your-pages-origin>` + handle `OPTIONS` preflight.
- **Response shape:** `{ items: [{ id, url, what, dp, date, created }] }` — the Worker parses `what`/`dp`/
  `date` out of the URL so the homepage stays dumb (just renders).

## 5. Homepage + tool integration

- **Homepage (`index.html`):** replace the hardcoded `<li>` in `.saved-evals` with a list rendered from
  `GET /interventions`. Reuse the existing `.saved-eval` markup (bookmark icon + `__name` + arrow) so
  styling is unchanged; `__name` = the parsed `what`. Add a small delete control per row (soft-delete,
  with confirm). Progressive enhancement: if the fetch fails, show the seed/example link so the page is
  never empty. Accessible: it's a real `<ul>` of `<a>`s; the delete is a real `<button>` with an
  `aria-label` ("Remove <what>").
- **Save action (hypothesis tool):** a "Save this intervention" `<button>` that opens a tiny form — one
  **city email** field (`<input type="email">`, required, labeled) — and `POST`s `{ url: location.href,
  email }`. On success, a small confirmation. The email is for accountability only (§6); make that clear
  in the form's helper text so no one assumes it's verified or private-forever. (Exact placement TBD.)

## 6. Abuse handling (because writes are public)

1. **Origin allowlist (the main defense):** the Worker only accepts a `url` that starts with the site's
   own origin + `/hypothesis/`. Rejects virtually all spam before it touches KV — far more effective
   than a CAPTCHA.
2. **Length + shape caps:** cap URL length (e.g. 2 KB); require it to parse and to carry a `what`.
3. **Soft-delete is recoverable:** griefing via delete is reversible (records live under `deleted:`).
4. **City-email accountability (recorded, not enforced):** the save form asks for a city email; the
   Worker stores it + a `cityEmailGuess` flag. It's an unverified deterrent + audit trail — NOT auth
   (anyone can type anything). "Crack down later" = start rejecting non-city domains or blocklisting
   addresses, using the data already collected. Keep email server-side only (PII).
5. *(No per-IP rate limit — skipped by choice; the allowlist + email accountability carry the load.
   Cloudflare Turnstile on the save button is the fallback if spam ever gets through.)*

## 7. Cloudflare setup (first-time — you run these)

```bash
# 1. Install Wrangler (Cloudflare's CLI) — you run installs (web-dev §7)
npm i -D wrangler

# 2. Log in (opens a browser to authorize)
npx wrangler login

# 3. Create the KV namespace (prints an id to paste into wrangler.toml)
npx wrangler kv namespace create INTERVENTIONS

# 4. Try it locally BEFORE deploying — runs the Worker + a local KV on localhost
npx wrangler dev

# 5. Deploy to the edge when happy
npx wrangler deploy
```

Repo layout for the Worker (new dir):
```
interventions-api/
  src/index.js        # the Worker (fetch handler + KV logic)
  wrangler.toml       # name, main, kv_namespaces binding, allowed-origin var
```
`wrangler.toml` holds the KV namespace id and an `ALLOWED_ORIGIN` var; no secrets needed for public
writes. The static site stays on GitHub Pages (web-dev §9) — only the Worker lives on Cloudflare.

## 8. Phasing (experiment-friendly)

1. ✅ **Worker locally** — `interventions-api/` scaffolded: 3 endpoints + validation, origin allowlist,
   `what`/length checks, city-email recorded-not-enforced, soft-delete. `seed.json` for the existing
   example. Syntax-clean; ready for `wrangler dev` + `curl`.
2. ⏳ **Deploy** — `wrangler deploy` (after `kv namespace create` + paste id); set the homepage's `API`
   prod URL; CORS already scoped to the Pages origin.
3. ✅ **Homepage list + delete** — `js/saved-interventions.js` renders `.saved-evals` from the Worker
   (reusing the markup), with per-row soft-delete (confirm) and a PE fallback to the static `<li>`.
   `API` auto-targets `localhost:8787` in dev. CSS: row layout + accessible delete button.
4. ✅ **Save button** — `hypothesis/js/save.js` + a "Save this intervention" button in the share-bar
   that opens a native `<dialog>` (city-email field, accessible: focus trap/Esc/backdrop), POSTs
   `{url: location.href, email}` via the shared `js/interventions-client.js`. Email remembered in
   `localStorage`; server errors shown inline. The save→list→delete loop is complete.
5. ⏳ Sanity pass: CWV (just a fetch + a list — negligible) + WCAG (keyboard delete + dialog, focus,
   labels). Delete + dialog are real `<button>`/`<dialog>` with labels + visible focus; list is real
   `<a>`s. Worth a keyboard-only pass once running.

Operations (seed / delete-persistence / restore / reset / inspect) are documented in
`interventions-api/README.md` → "Operations & data lifecycle".

## 9. Open items

- **Where the "Save" button lives** in the hypothesis tool UI — settle against the live layout.
- **Cloudflare account** — you'll need one (free tier is plenty); `wrangler login` ties to it.
- **Secondary link context** — show `dp`/`date` as a sub-line, or keep just the `what` text? (Lean: just
  `what`, maybe a muted date.)
- **Seed migration** — ✅ `interventions-api/seed.json` carries the existing hardcoded example into KV
  (`wrangler kv bulk put`). Note: its link text derives from `what` → "Plain clothes officers" (the old
  hand-written "…deployment in Hayes" wording isn't in the URL). Enrich the seed's `what` if the fuller
  label is wanted. The homepage's static `<li>` becomes the PE fallback (or is removed once dynamic).
- **City email domain** — confirm the domain `cityEmailGuess` checks for (e.g. `@sfgov.org`).
- **Email disclosure** — a one-line note on the save form that the email is recorded for accountability
  (unverified, kept internal). Keeps the PII collection honest/consensual.
