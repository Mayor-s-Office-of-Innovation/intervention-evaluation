# Plan — Automate the dashboard data refresh (weekly auto-PR)

**Date:** 2026-08-31
**Goal:** Turn the manual weekly data refresh (drug · unhoused · theft → homepage) into a scheduled
GitHub Actions job that rebuilds, validates, and opens a **pull request** with the data diff for Aaron
to review and merge. Merging fires the existing `deploy.yml` gate + Pages deploy.

Companion to [plan-data-refresh.md](plan-data-refresh.md) (the manual runbook + run log), which stays
the source of truth for the build/validate *sequence*. This plan only adds the automation wrapper.

## Decisions (locked)
- **Publish mode: auto-PR, Aaron merges.** No commit-to-`main` from CI. Preserves the "Aaron runs git"
  and "stop-and-report on mismatch" conventions — a red check / no PR means don't publish.
- **Cadence: weekly** (Monday morning PT). Matches the monthly-settle / 2-week-chip rhythm and keeps
  `points/` + `markers/` diff churn to one PR per week (every rebuild rewrites those regardless).

## Why this shape (design rationale)
1. **Structural checks can't catch semantic drift.** `validate_build`/`parity` verify shape, not a
   plausible-but-wrong number from an upstream category rename or filter drift (shows as a count cliff).
   The guard against that is (a) `trace.py` — which ties out *by construction* right after a fresh pull,
   so it's a strong gate here even though `deploy.yml` excludes it as flaky — and (b) a human glance at
   the headline deltas in the PR. The PR flow keeps both.
2. **`GITHUB_TOKEN` pushes don't trigger other workflows** (GitHub's recursion guard). So an
   auto-commit to `main` would *not* fire `deploy.yml` (would need a PAT). A PR that **Aaron merges**
   pushes as *Aaron* → `deploy.yml` runs its full gate (incl. Playwright e2e) + deploys. Clean.
3. **Refresh workflow stays lean.** All three validators are pure stdlib / Node built-ins (`parity.mjs`
   imports only `node:*` + local `shared/classify.js`), so **no `npm ci`, no Playwright image** needed.
   e2e still gates the *actual* deploy via `deploy.yml` on merge — no need to duplicate it here.

## Scope
In scope: one new workflow `.github/workflows/refresh-data.yml` + a small PR-delta helper. Rebuilds
`drug/`, `unhoused/`, `theft/`; homepage auto-follows (reads each `data/aggregates.json` live).

Out of scope: `deploy.yml` (unchanged — merge still triggers it), `trace.yml` (kept as the *daily*
drift monitor between weekly refreshes), and the on-demand `dashboard-review` skill pass (human/LLM
judgment, not CI — run it when the PR deltas look anomalous).

## The workflow: `.github/workflows/refresh-data.yml`

```yaml
name: Weekly data refresh (auto-PR)

on:
  schedule:
    - cron: "17 13 * * 1"   # Mondays 13:17 UTC (~06:17 PT). Off-:00 minute (GitHub delays on-the-hour crons).
  workflow_dispatch:          # manual "refresh now"

permissions:
  contents: write            # push the refresh branch
  pull-requests: write       # open/update the PR

concurrency:                 # never let two refreshes overlap
  group: data-refresh
  cancel-in-progress: false

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - uses: actions/setup-node@v4
        with: { node-version: '24' }   # no npm ci — validators use only built-ins

      # --- Build (retry the network-heavy pulls; pulls are anon stdlib GETs, no token) ---
      - name: Rebuild drug
        run: cd drug/build && python3 01_pull.py && python3 02_assign.py && python3 03_rollup.py && python3 04_transitions.py && python3 05_markers.py
      - name: Rebuild unhoused
        run: cd unhoused/build && python3 01_pull.py && python3 02_assign.py && python3 03_rollup.py && python3 04_transitions.py && python3 05_markers.py
      - name: Rebuild theft
        run: python3 theft/build/build.py

      # --- Validate: ALL must pass or the job fails and NO PR opens (= stop-on-mismatch) ---
      - name: V1+V3 build invariants
        run: python3 validation/validate_build.py
      - name: V2 classifier parity
        run: node validation/parity.mjs drug && node validation/parity.mjs unhoused
      - name: Source↔baked trace (strong gate on fresh data)
        run: python3 validation/trace.py drug && python3 validation/trace.py unhoused

      # --- Summarize headline deltas for the PR body ---
      - name: Compute deltas
        run: python3 validation/refresh_delta.py > /tmp/deltas.md

      # --- Open/update ONE rolling PR (idempotent; updates if last week's is still open) ---
      - uses: peter-evans/create-pull-request@v6
        with:
          branch: chore/data-refresh
          base: main
          title: "Weekly data refresh"
          body-path: /tmp/deltas.md
          commit-message: "Refresh dashboard data (drug/unhoused/theft)"
          add-paths: |
            drug/data/**
            unhoused/data/**
            theft/data/**
```

### Notes on the choices above
- **`add-paths` scoped to `*/data/**`** — a build should only touch baked JSON. If anything else shows
  up dirty (a build wrote outside `data/`), that's a bug to see, not commit — the scope keeps the PR clean.
- **Rolling branch `chore/data-refresh`** — one open refresh PR at a time; each run updates it with the
  newest data rather than piling up N stale PRs. (Dated branches are the alternative if we ever want a
  refresh history in PRs — not worth it now.)
- **Retry the pulls** — `httpget.py` has no retry and the open portal occasionally rate-limits/blips.
  Wrap each *Rebuild* step in a retry (e.g. `nick-fields/retry@v3`, 2–3 attempts) so a transient blip
  doesn't fail the whole weekly run. Pulls are resumable per stage but not automatic; a full re-run is
  simplest and cheap.

## New helper: `validation/refresh_delta.py`
Small stdlib script, prints a Markdown table of before→after headline numbers so the PR is reviewable at
a glance (the human half of the semantic-drift guard). Mirrors the run-log deltas in `plan-data-refresh.md`
(e.g. drug reports / dealer arrests / paraphernalia / needles; unhoused encampment / cfs_sitlie / hsoc).
- Reads the **new** `*/data/aggregates.json` (working tree) vs the **old** (via `git show HEAD:<path>`).
- Emits: per dashboard, `generated` date old→new, `latest_settled_month` old→new, and each headline
  card's latest-settled value old→new with % change. Flags any single-month swing over a threshold
  (e.g. ±40%) as ⚠️ so a cliff is obvious in the PR.
- Pure stdlib + `subprocess` git (same pattern `trace.py` already uses).

## Merge / deploy flow (unchanged downstream)
1. Monday run rebuilds + validates. **Green** → PR opened/updated with deltas. **Red** → job fails,
   GitHub emails the workflow author, **no PR** (nothing to publish).
2. Aaron reviews the PR: deltas sane (no cliffs), diff limited to `*/data/**`. Optionally runs the
   `dashboard-review` skill if a delta looks off.
3. Aaron merges → push to `main` (as Aaron) triggers `deploy.yml`: full gate (validate + parity + e2e)
   then Pages deploy. Homepage auto-follows.

## Failure / notification
- Default: GitHub emails the workflow file's last committer when a scheduled run fails. Sufficient to start.
- Optional add-on: an "on failure, open/update a tracking issue" step (`actions/github-script`) so a
  portal outage is visible in the repo, not just email. Defer unless email proves too quiet.

## Risks / watch-for
- **Upstream schema/filter drift** → surfaces as a `trace.py` red (job fails, no PR) or a ⚠️ cliff in the
  delta table (PR opens but obviously wrong). Either way it lands in front of a human before publish.
- **Portal outage / rate-limit** → mitigated by step retries; worst case the weekly run fails and next
  week (or a manual `workflow_dispatch`) catches up. Data staleness of a few days is acceptable.
- **`GITHUB_TOKEN`-created PR doesn't run PR-triggered checks** — fine here: this workflow runs the
  validations *inline before* opening the PR, and `deploy.yml` re-gates on merge. No check gap.
- **Diff size** — `points/` + `markers/` rewrite every run; expected, weekly cadence bounds it to one PR.

## Verification of done
- Manual `workflow_dispatch` run: builds + all three validators pass, a PR appears on `chore/data-refresh`
  with a readable delta table, diff limited to `*/data/**`.
- Merging the PR triggers `deploy.yml` and the live site shows refreshed numbers.
- A deliberately-broken run (e.g. temporarily point a signal at a bad dataset) fails the job and opens
  **no** PR — confirming stop-on-mismatch.

## Build steps
- [x] Analysis of current workflows + build pipeline + conventions.
- [x] Add `validation/refresh_delta.py` (resilient, always exits 0; verified against the current tree — +0% everywhere).
- [x] Add `.github/workflows/refresh-data.yml` (weekly + dispatch, pull retries, gates fail-closed, rolling PR). YAML parse-checked.
- [x] Note the automation in `README.md`'s "Refreshing the data" runbook.
- [ ] **One-time repo setting** (Aaron): Settings → Actions → General → enable "Allow GitHub Actions to create and approve pull requests".
- [ ] **Acceptance test** (Aaron, after merge to `main`): Actions → *Weekly data refresh* → **Run workflow**; confirm builds+gates pass, a PR appears on `chore/data-refresh` with a readable delta table, diff limited to `*/data/**`, and merging triggers `deploy.yml` + a live-site refresh.

## Fix — CI FileNotFoundError on district polygons (2026-09-01)
First `workflow_dispatch` run failed at **Rebuild drug** in `02_assign.py`: `GEOJSON_SRC` pointed at the
sibling `emergent-map` repo (`../../../emergent-map/data/sidecar/police_districts.geojson`), which is
only checked out on Aaron's dev machine — CI has no such directory. `unhoused` would have failed the same
way. These are static administrative boundaries (dataset qgnn-b9vv), not refreshed data.
- [x] Commit the full 10-district source to `shared/data/police_districts.geojson` (the emergent-map file
  was byte-identical to what all three dashboards already emit → **zero data change**). `shared/` is the
  established home for cross-dashboard build artifacts (`shared/data/sf-intersections.json`).
- [x] Repoint `GEOJSON_SRC` in `drug`/`districts`/`unhoused` `build/02_assign.py` to that in-repo path.
  Kept the *canonical full set* as source (not each dashboard's trimmed `data/police_districts.geojson`
  output) so the point-in-polygon assignment stays correct if `TARGET_DISTRICTS` is ever narrowed again.
- [x] Verified all three `load_polygons()` read 10 polygons from the new path and `write_target_geojson()`
  reproduces the committed trimmed output byte-for-byte.
