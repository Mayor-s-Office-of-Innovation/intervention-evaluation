# Plan — consolidate the Playwright test harness (one config, one command)

**Branch:** `refresh-data-plus-search-intersections` (rides in the same single PR as A/D/C/E/G/B/F).
**Status:** in progress — spun out of Workstream E when the hypothesis e2e suite went 9/9 red.

## Why

Workstream E added the first-ever `../../shared/…` import to the hypothesis tool
([hypothesis/js/app.js:14](hypothesis/js/app.js#L14)). But the hypothesis Playwright config
**chroots its dev server to `hypothesis/`** (`cwd: hypothesis/`, `http-server -p 8090` with no `..`),
so `/js/app.js`'s `../../shared/cross-street-search.js` escapes the doc root → **404** → the ES module
never loads → `init()` never runs → `#in-expect` options never populate → `gotoApp`'s `waitForFunction`
sits for the full 60 s. All 9 tests fail identically. It works interactively (and on GitHub Pages)
because those serve the **repo root**, where `../../shared/` resolves.

Every *other* suite (homepage, drug, unhoused, theft, districts) already serves the repo root
(`http-server .. -p <port>`) and uses **absolute** goto paths (`/drug/index.html`, `/index.html`, …).
Only hypothesis was the odd one out — and the 5-config / 5-port / 5-invocation layout is what made this
bug so confusing (and is the root of the recurring [[testall-server-contention]] papercut).

**Decision (confirmed with user 2026-07-27):** consolidate to ONE root config with a project per
dashboard, ONE webserver serving the repo root on ONE port, and fold the browser suites + Python/JS
validation into a single `npm test`.

## Target shape

### `playwright.config.js` (NEW, repo root)
- `fullyParallel: false`, `workers: 1` — serial across projects. Kills the port/Socrata contention that
  produced spurious `page.goto` timeouts in the old chained `test:all`. (hypothesis already required this.)
- `timeout: 60_000`, `expect.timeout: 15_000` — the max any suite needed (hypothesis hits live Socrata);
  the baked suites just get headroom.
- One `webServer`: `npx http-server . -p 8090 -c-1 --silent`, `url: http://localhost:8090/index.html`,
  `reuseExistingServer: true`. cwd defaults to the config dir (repo root), so `.` serves the whole repo.
- `projects` (run order — cheap/baked first, live-Socrata last):
  - `homepage`   → `./homepage/tests`,   baseURL `http://localhost:8090`
  - `districts`  → `./districts/tests`,  baseURL `http://localhost:8090`
  - `theft`      → `./theft/tests`,      baseURL `http://localhost:8090`
  - `drug`       → `./drug/tests`,       baseURL `http://localhost:8090`
  - `unhoused`   → `./unhoused/tests`,   baseURL `http://localhost:8090`
  - `hypothesis` → `./hypothesis/tests`, baseURL `http://localhost:8090/hypothesis/` ← only special case

  All baked suites use absolute goto paths, so the root baseURL works unchanged. hypothesis uses
  `goto('/')` + query-relative bases, so it gets a `/hypothesis/` baseURL and one test edit.

### `hypothesis/tests/e2e.spec.js`
- Line 13: `page.goto('/')` → `page.goto('./')` so it resolves against the `/hypothesis/` baseURL.
  Line 124 (`url.pathname + url.search`, now `/hypothesis/…`) and lines 141/149 (query-relative `base`)
  already resolve correctly under that baseURL. No other edits.

### `package.json` scripts
- `test` → `playwright test && python3 validation/validate_build.py && node validation/parity.mjs`
  (the one command; folds browsers + validation).
- `test:e2e` → `playwright test` (browsers only, all projects).
- `test:drug` / `test:unhoused` / `test:districts` / `test:theft` / `test:homepage` / `test:hypothesis`
  → `playwright test --project=<name>` (kept for muscle memory / targeted runs).
- `test:all` → `npm test` (back-compat alias; historical docs say `npm run test:all`).

### `.github/workflows/deploy.yml`
- Replace the 4 `npx playwright test -c <dir>/playwright.config.js` lines with a single
  `npx playwright test --project=homepage --project=drug --project=unhoused --project=theft`.
  **Preserves the current CI scope exactly** — still excludes hypothesis (live Socrata is a bad deploy
  gate) and districts. Validation steps (validate_build / parity) already run as their own CI steps above;
  left as-is.

### Retire
- Delete `homepage/`, `drug/`, `unhoused/`, `theft/`, `districts/`, `hypothesis/` `playwright.config.js`
  (6 files). Test files (`*/tests/*.spec.js`) stay put — `testDir` points at them.

### Docs
- README.md lines 67 + 81: point at `npm test` / `npx playwright test --project=drug`.
- This plan doc; note the contention papercut is now resolved (update [[testall-server-contention]] memory).

## Verify
- `npm test` green across all 6 projects + validation, run from a clean state
  (`pkill -f http-server` first; the single reused server removes the between-config teardown dance).
- Confirms Workstream E hypothesis picker search: the suite that was 9/9 red goes green for the right
  reason (module now loads).

## Out of scope
- Test *content* changes beyond the one hypothesis goto line.
- trace.py (not in the current `test:all` gate; unchanged).
