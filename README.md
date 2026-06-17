# Intervention Evaluation — SF Neighborhood Safety Pod

A set of static, data-backed **OKR dashboards** for San Francisco neighborhood-safety interventions,
plus a self-serve hypothesis-checking tool. Every number ties back to a runnable [Socrata](https://data.sfgov.org)
query; the dashboards are pre-baked JSON (no live calls at view time), built offline from Python.

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
| **Districts** | [`/districts/`](districts/) | Encampment reports by district over time — the base stack the others reuse | [districts/plan.md](districts/plan.md) |
| **OKR map** | [`/okr-map/`](okr-map/) | Draft mapping of the OKR spreadsheet → dashboards | — |
| **Hypothesis tool** | [`/hypothesis/`](hypothesis/) | Self-serve "does the data support my hypothesis?" intervention check (live 911 dispatch data) | [hypothesis/PLAN.md](hypothesis/PLAN.md) |

*(The homepage links drug, unhoused, theft, and the hypothesis tool; districts and okr-map are auxiliary.)*

## Layout

```
index.html, styles.css     ← root homepage/launcher
shared/                     ← shared ES-module lib: data, rollup, classify, chart, transition-map
                              (imported by drug + unhoused as ../../shared/*.js)
<tool>/
  index.html styles.css
  js/app.js                 ← per-dashboard orchestration (imports shared/)
  data/*.json               ← pre-baked aggregates / points / transitions (shipped)
  build/*.py                ← offline Socrata pulls → rollups → transitions (NOT shipped)
  tests/e2e.spec.js         ← Playwright suite
validation/                 ← build invariants, classifier parity, source↔data trace
.github/workflows/          ← deploy.yml (test-gated GitHub Pages) + trace.yml (nightly)
```

## Checks

```bash
python3 validation/validate_build.py        # data invariants + transitions↔aggregates axis alignment
node validation/parity.mjs drug             # client classifier == baked Python oracle (also: unhoused)
python3 validation/trace.py drug            # re-derive headline numbers from the declared Socrata query
npx playwright test -c drug/playwright.config.js   # e2e (also: unhoused, theft)
```

On push to `main`, the [deploy workflow](.github/workflows/deploy.yml) runs these (build invariants +
parity + e2e suites) and **gates the GitHub Pages deploy**; the source↔data
[trace](.github/workflows/trace.yml) runs nightly. The cross-cutting time-scrubber + validation work is
documented in **[drug/plan-scrubber.md](drug/plan-scrubber.md)**.
