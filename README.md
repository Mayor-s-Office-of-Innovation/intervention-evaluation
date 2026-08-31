# Intervention Evaluation — SF Neighborhood Safety Pod

A set of static, data-backed **OKR dashboards** for San Francisco neighborhood-safety interventions,
plus a self-serve hypothesis-checking tool. The goal: track whether the city's neighborhood
interventions are actually moving the numbers that matter, using public SF OpenData. Every number ties
back to a runnable [Socrata](https://data.sfgov.org) query; the dashboards are pre-baked JSON (no live
calls at view time), built offline from Python.

## Run it locally

```bash
npm install          # http-server + Playwright (Node) — one time
npm run dev          # serve the repo root at http://localhost:8090/
# or: npm run serve  # same, but auto-opens the homepage
```

Serve from the **repo root** (not a sub-folder) so each dashboard's `../../shared/` and `./data/` paths
resolve. The offline build + validation scripts also need **Python 3**.

## The root UI

[`index.html`](index.html) is the **homepage / launcher** — *"Results for San Francisco Neighborhood
Safety Pod — OKR Dashboards"* — at `http://localhost:8090/`. It links the live dashboards below.

## Tools & their plans

| Tool | Path | What it is | Plan |
|------|------|-----------|------|
| **Drug activity** | [`/drug/`](drug/) | Drug activity by district — community 911 reports (↓) + dealer arrests (↑), arrest-composition, displacement map, **time scrubber** | [drug/plan.md](drug/plan.md) · [plan-scrubber.md](drug/plan-scrubber.md) |
| **Unhoused presence** | [`/unhoused/`](unhoused/) | Encampment (311) + 911 unhoused calls by district, HSOC response, displacement map, **time scrubber** | [unhoused/plan.md](unhoused/plan.md) |
| **Theft** | [`/theft/`](theft/) | Theft reported by merchants (victim-reported), arrests as context | [theft/plan.md](theft/plan.md) |
| **OKR map** | [`/okr-map/`](okr-map/) | Draft mapping of the OKR spreadsheet → dashboards | — |
| **Hypothesis tool** | [`/hypothesis/`](hypothesis/) | Self-serve "does the data support my hypothesis?" intervention check (live 911 dispatch data) | [hypothesis/PLAN.md](hypothesis/PLAN.md) |

*(The homepage links drug, unhoused, theft, and the hypothesis tool; okr-map is auxiliary.)*

## Layout

```
index.html, styles.css     ← root homepage/launcher
shared/                     ← shared ES-module lib: data, rollup, classify, chart, transition-map, districts
                              (imported by drug + unhoused + theft as ../../shared/*.js)
<tool>/
  index.html styles.css
  js/app.js                 ← per-dashboard orchestration (imports shared/)
  data/*.json               ← pre-baked aggregates / points / transitions (shipped)
  build/*.py                ← offline Socrata pulls → rollups → transitions (NOT shipped)
  tests/e2e.spec.js         ← Playwright suite
validation/                 ← build invariants, classifier parity, source↔data trace
.github/workflows/          ← deploy.yml (test-gated GitHub Pages) + trace.yml (nightly)
```

## Refreshing the data

The dashboards ship **pre-baked JSON** rebuilt offline from Socrata (stdlib Python 3, anonymous
read-only GETs — no token, no `pip install`). To bring everything current:

1. **Rebuild each dashboard** using its own pipeline (see the "Refresh the data" section in each
   README): [`drug/`](drug/README.md) and [`unhoused/`](unhoused/README.md) are 5-stage
   (`01_pull → 02_assign → 03_rollup → 04_transitions → 05_markers`, run from `<dash>/build/`);
   [`theft/`](theft/README.md) is a single `python3 theft/build/build.py`.
2. **The homepage auto-follows — no separate step.** [`index.html`](index.html) / [`js/app.js`](js/app.js)
   fetch each dashboard's `data/aggregates.json` live, and the district cards' emerging signals are
   fetched live in-browser. Rebuilding the three dashboards refreshes the homepage.
3. **Validate** (see [Checks](#checks) below): `validate_build.py`, `parity.mjs {drug,unhoused}`,
   `trace.py {drug,unhoused}`, then `npm run test:all`.
4. **On any validation mismatch, stop and report** (source drift or an unexplained count cliff) before
   committing — don't auto-commit a partial refresh.

`provenance.json`'s `generated` date and the partial/settled-month shading update themselves from
`date.today()` at build time — no manual date edits.

**Automated weekly refresh.** [`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml)
runs the four steps above every Monday (and on-demand via the Actions **Run workflow** button). It
rebuilds all three, runs the validators as hard gates, and — only if they all pass — opens/updates a
single rolling PR (`chore/data-refresh`) with a before→after headline-delta table
([`validation/refresh_delta.py`](validation/refresh_delta.py)). Review the deltas and merge; the merge
push triggers [`deploy.yml`](.github/workflows/deploy.yml)'s full gate + Pages deploy. A red gate fails
the job and opens **no** PR — the stop-on-mismatch rule, enforced. Design notes:
[docs/plan-data-refresh-automation.md](docs/plan-data-refresh-automation.md). (One-time repo setting:
Settings → Actions → General → enable "Allow GitHub Actions to create and approve pull requests".)

## Checks

```bash
python3 validation/validate_build.py        # data invariants + transitions↔aggregates axis alignment
node validation/parity.mjs drug             # client classifier == baked Python oracle (also: unhoused)
python3 validation/trace.py drug            # re-derive headline numbers from the declared Socrata query
npx playwright test --project=drug          # e2e for one dashboard (also: unhoused, theft, homepage, hypothesis)
npm test                                     # everything: all e2e projects + build invariants + parity
```

On push to `main`, the [deploy workflow](.github/workflows/deploy.yml) runs these (build invariants +
parity + e2e suites) and **gates the GitHub Pages deploy**; the source↔data
[trace](.github/workflows/trace.yml) runs nightly.

## Built with

This project was built and maintained with the Mayor's Office of Innovation
[**skills**](https://github.com/Mayor-s-Office-of-Innovation/skills) (public, MIT):

- [**web-dev**](https://github.com/Mayor-s-Office-of-Innovation/skills/tree/main/web-dev) — the
  frontend stack and standards behind the site: lightweight, Core-Web-Vitals-first, accessible
  (WCAG AA), web components + Web Awesome, modern CSS, GitHub Pages via Actions.
- [**dashboard-review**](https://github.com/Mayor-s-Office-of-Innovation/skills/tree/main/dashboard-review)
  — the data-quality bar every dashboard is held to: accuracy, source integrity, honest
  denominators, and the source↔data provenance each chart footnote must satisfy (see [Checks](#checks)).
