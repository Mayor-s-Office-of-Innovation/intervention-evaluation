# Plan: migrate `data.sfgov.org` → `data.sf.gov`

## Problem
SF migrated its open-data (Socrata) portal from `data.sfgov.org` to `data.sf.gov`.
The old host now issues a 301/302 redirect to the new host. Browser `fetch()`/XHR
**drop the `Access-Control-Allow-Origin` header across a cross-origin redirect**, so
every live client-side Socrata call on the deployed GitHub Pages site now fails with:

> No 'Access-Control-Allow-Origin' header is present on the requested resource.

Server-side callers (Python build scripts, curl) follow the redirect transparently, so
the build pipeline is not broken — only the live browser fetches are.

Verified on `data.sf.gov` (all 200, `Access-Control-Allow-Origin: *`):
`2zdj-bwza`, `vw6y-z8j6`, `wg3w-h783`, `nuek-vuh3`, `qgnn-b9vv`, `jfxm-zeee`, catalog API.
`/d/<id>` landing pages 302 → the human-readable dataset page (fine for `target=_blank` links).

## Fix — global host swap, in priority order

### P1 — Live browser fetches (BROKEN, must fix)
- `js/app.js:791` — `wg3w-h783.json` base
- `js/app.js:859` — `${DS}.json` query builder
- `shared/recent-activity.js:51` — `sodaUrl`
- `hypothesis/js/soda.js:9` — `SODA_BASE`
- `theft/js/app.js:400` — `SODA`

### P2 — Test mocks / assertions (must track new host or tests silently bypass the stub)
- `drug/tests/e2e.spec.js:143` — `page.route('**/data.sf.gov/**')` (was `data.sfgov.org`)
- `unhoused/tests/e2e.spec.js:243` — same glob
- `theft/tests/e2e.spec.js:221` — asserts `href*="data.sf.gov/resource"` (was `data.sfgov.org`)

### P3 — User-facing links + display strings (work via redirect today; migrate for correctness)
- `index.html`, `drug/index.html`, `unhoused/index.html`, `theft/index.html`,
  `districts/index.html`, `hypothesis/index.html` — footnote `/d/<id>` links + "data.sf.gov" text
- `js/app.js:899`, `shared/recent-activity.js:240`, `hypothesis/js/app.js:553,556` — inline `/d/` links + label
- `hypothesis/js/soda.js:17` — default label string `'data.sf.gov'`

### P4 — Build/analysis Python (works via redirect; migrate to avoid the extra hop + future breakage)
- `*/build/httpget.py` (comment + any hardcoded host), `*/build/signals.py`, `drug/build/03_rollup.py`,
  `shared/build/build_intersections.py`, `theft/analysis/*.py`

### P5 — Docs/plans/READMEs (`.md`) — low priority, update for accuracy
- READMEs, plan docs, findings docs referencing the old host in prose/example URLs.

## Approach
Mechanical string replace `data.sfgov.org` → `data.sf.gov` across P1–P4 (and P5 if desired).
No query strings, dataset ids, column names, or logic change. Then run the full
Playwright + validation suite (`npm test`) to confirm mocks still intercept and numbers tie out.

## Verification
- `npm test` green (e2e + validation across all dashboards).
- Manual: load `/drug/#northern` and `/hypothesis/?...` on a served copy; confirm live signals populate
  and no CORS error in console.

## Related
Separate follow-on (same session, different issue): CARTO basemap tiles now watermarked;
swap to a no-key tileset. Not part of this host migration.
