# Drug activity in San Francisco — by district

A static dashboard tracking **drug activity in San Francisco** and whether enforcement is reaching
**dealers** rather than churning through users. Read on **two co-headline axes** (see [`plan.md`](plan.md)
for the full design, decisions, and data caveats):

- **Drug-activity reports** (`cfs_drug`) — community 911 "suspicious person, drug-noted" calls. **Want ↓.**
  The problem signal; robust to how hard the city is enforcing.
- **Dealer arrests** (`dealer_arrests`) — SFPD drug arrests narrowed to *dealing/distribution* charges,
  counted as distinct incidents. **Want ↑.** Given the fentanyl crisis, supply disruption is a goal, not
  just context (plan D9) — with the reflexivity caveat kept in a footnote.

Beyond the two cards:

- **"What drug arrests are made of"** — a stacked composition (dealer vs **paraphernalia** vs other) that
  exposes the central finding: the recent drug-enforcement surge is overwhelmingly paraphernalia
  catch-and-release, while dealer arrests are flat-to-down.
- **Displacement map** — the fixed-Lurie hot/cold transition map on community reports only, showing where
  activity *persisted, cooled, or emerged* as the city moves people around.
- **Needles** (`needles`) — shown **citywide only and excluded from the trend read** (route shift from
  injection to fentanyl smoking; plan D5), with a visible caveat.

Two arrest types — **paraphernalia** and **possession/use/loitering** — are deliberately **left out** of the
dealer metric (catch-and-release that rarely leads to charges), with a visible footnote explaining why and the
honesty caveat that the dataset records the *arrest*, not the DA's charging decision.

## Launch the dashboard

Fully static (no backend). **Serve from the repo root** so `/drug/...` paths resolve:

```bash
# from the repo root (intervention-evaluation/)
python3 -m http.server 8090
# open http://localhost:8090/drug/index.html
```

> `file://` won't work — the page uses `fetch()` for the JSON, which browsers block on `file://`.

## Refresh the data

The page reads pre-baked JSON in [`data/`](data/) produced by the Python build (stdlib only — no
`pip install`). The pipeline mixes two signal kinds:

- **point** (`cfs_drug`) — raw rows pulled, assigned to police districts by point-in-polygon, and fed to the
  transition map + marker drill-down.
- **agg_only** (arrests, needles) — pre-grouped monthly `count(distinct incident_id)` fetched straight from
  Socrata by native `police_district` (no raw paging, no point-in-polygon).

```bash
# from drug/build/
python3 01_pull.py        # raw points for cfs_drug (the map signal)
python3 02_assign.py      # point-in-polygon → police district
python3 03_rollup.py      # aggregates.json + provenance.json (+ fetches the agg_only signals)
python3 04_transitions.py # hot/cold displacement cells (cfs_drug)
python3 05_markers.py     # individual-report markers for zoom-in (cfs_drug)
```

**Two freshness rules:** community 911 calls and 311 needle reports are creation-stamped (only the in-progress
month is partial). SFPD incident reports settle on supervisor approval — but for drug arrests the measured lag
is ~0 days (officer-generated, reported same-day), so only a light 1-month hedge is held back.
