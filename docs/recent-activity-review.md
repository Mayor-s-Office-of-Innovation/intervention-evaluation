# Dashboard review — "Most recent activity" recent-activity section

Scope: the evergreen live-DataSF section on **drug** + **unhoused** — `shared/recent-activity.js`,
the panels in `{drug,unhoused}/index.html`, the `RECENT_SIGNALS` configs + `setupRecentActivity` in
`{drug,unhoused}/js/app.js`, `.ra-*` CSS, and the methodology footnotes.

Reviewed 2026-07-15. **Nothing applied yet — findings for discussion.** Priority: accuracy > clarity.

## Inventory (figures/claims shown to the reader)
- Note line: `Live from DataSF · <label> in <District> · last N weeks through <anchorDate> · <count> reports [· filtered to <hours>]. Live data may be newer than the rest of this page.`
- Hour bars: one per hour, height ∝ report count; tooltip `<hour> — <c> reports (avg <x>/wk)`.
- Hex density map: fill = report count per hex; tooltip `<n> reports — click for locations`; popup = `<n> reports · <m> locations` + location→count table.
- Legend: `fewer reports → more`.
- Recency chips (1/2/4/8 wk); signal picker (unhoused: Encampment / 911 presence).
- Source pointer: the phrase "Live from DataSF" (plain text) + a methodology footnote lower on the page.

## Ranked findings

| # | Finding | Dimension | Severity | Status |
|---|---------|-----------|----------|--------|
| 1 | Hour-of-day = **when reports are filed**, not when activity occurs — acute for 311 encampment | 6 Headline fidelity / 2 integrity | **High** | Open |
| 2 | Note "N reports · filtered to \<hours\>" shows the **whole-window total** while the map shows only the brushed hours | 3 Consistency | **Medium** | Open |
| 3 | No **reader-facing source link** on the live figures ("Live from DataSF" is plain text) | 4 Source-link coverage | **Medium** | Open |
| 4 | "reports" = **calls / service requests** (demand for service), not unique encampments/people — caveat only in far-off methodology | 8 Earn-its-place / 6 | Low–Med | Open |
| 5 | Hex color is **relative to the current view's busiest hex**, not an absolute scale — legend doesn't say so | 5 Encoding honesty | Low | Open |
| 6 | `MAX_ROWS = 10000` is a **silent cap** (undisclosed) if an 8-wk district window ever exceeds it | 4 / robustness | Low | Open |

---

### 1 — "When" is report-filing time, not activity time  *(High)*
**Location:** `shared/recent-activity.js` `drawHours()` / the "When — reports by hour of day" panel; both dashboards.
**Problem:** the bars count reports *by the hour they were filed*. For **911 CFS** (drug `cfs_drug`, unhoused `cfs_presence`) that's a defensible proxy — people call when they witness activity. For **311 encampment** it is not: 311 service requests are filed asynchronously and skew hard to daytime/business hours (the encampment bars peak ~8–9am), which reflects *reporting behavior*, not when encampments are present (they're 24/7).
**Why it misleads:** the panel's whole operational purpose is "when to send a team." A viewer reading the 9am encampment peak as "activity peaks at 9am" would deploy at the wrong time — they'd be chasing the reporting curve.
**Proposed change:** add a short caveat under/near the "When" panel that hour = *when reports were filed* (and for 311, daytime-skewed). Options: (a) one line in the section for all signals; (b) a stronger, signal-specific note for 311 encampment; (c) reconsider whether "When" earns its place for 311 at all (I lean (a)+(b), keep the panel). **Your call — this is the most important finding.**

### 2 — Report count doesn't match the filtered map  *(Medium)*
**Location:** `shared/recent-activity.js` `redraw()` — `${rows.length} reports` uses `inWindow()` (unbrushed); `drawHexes` filters by `brushed`.
**Problem:** with an hour brush active, the note reads e.g. "226 reports · filtered to 9a, 10a, 11a, 12p, 1p, 2p" — but 226 is the *whole-window* total; the map shows only those hours.
**Why it misleads:** reads as "226 reports in the selected hours." Numerator/label mismatch.
**Proposed change:** when brushed, show both — e.g. "226 reports · 140 in the selected hours" — or make the count reflect the brushed subset. (Bars intentionally show all hours; only the map + this count are the issue.)

### 3 — Live figures expose no source link to the reader  *(Medium)*
**Location:** the note ("Live from DataSF" is plain text); methodology footnote links the *baked* `cfs_drug` history query, not the live recent-window query.
**Problem:** Dimension 4 wants every doubtable figure to expose its own source link *in the published view*. A skeptic can't click to check the recent counts.
**Why it matters:** verifiability is a core deliverable; "I traced it" ≠ "the reader can."
**Proposed change:** add a runnable DataSF link near the note (per signal) that opens the live query (where-clause + date window). Caveat: district scoping is client-side point-in-polygon, so a single URL can't reproduce the exact count — use the **bbox-clipped** query and **label it** "live query (district-clipped in the page)" rather than implying an exact round-trip. Honest + checkable.

### 4 — "reports" are calls, not unique situations  *(Low–Med)*
**Location:** note + section title + popup ("N reports").
**Problem:** these are distinct 311/911 records (deduped by id), i.e. *calls*. Multiple calls can describe the same tent/corner. The "demand for service, not verified counts" caveat is only in the methodology, far below.
**Proposed change:** keep "reports" (accurate) but move a one-clause caveat next to the figure (Dimension 8: caveat by its subject), e.g. in the lead or note.

### 5 — Hex color scale is relative, not absolute  *(Low)*
**Location:** `drawHexes()` — `max = Math.max(1, ...bins…count)` normalizes fill to the busiest hex *in the current view*.
**Problem:** the legend ("fewer → more") implies a fixed scale; the same true density can render darker in a quiet district than in a busy one, and switching signal/window/brush re-scales.
**Proposed change:** low priority — either note "shading is relative to the busiest block shown," or leave as-is (within-view density is a reasonable read). Flagging for awareness.

### 6 — Undisclosed row cap  *(Low)*
**Location:** `shared/recent-activity.js` `MAX_ROWS = 10000` with `$order <date> DESC`.
**Problem:** if an 8-week single-district window ever exceeds 10k rows, the oldest part is silently dropped (newest-10k only). Measured volumes are far under (encampment ~3k/district/8wk), so it won't hit in practice — but it's an undisclosed truncation.
**Proposed change:** leave the cap; optionally surface a note if `rows.length === MAX_ROWS`. Lowest priority.

---

## What's already good (no action)
- **Tone (Dim 7):** neutral throughout — "a separate, operational view," "Community reports over the last few weeks." No intensifiers, no drama. ✓
- **Recency (Dim 3):** every view is date-stamped ("through \<anchorDate\>"), anchored to the data (not the client clock), and explicitly flagged "may be newer than the rest of this page." ✓
- **Encoding (Dim 5):** bars use height for magnitude (single hue, no double-encoding); hexes use a sequential ramp distinct from the categorical hot/cold palette; no truncated axes. ✓
- **Headline fidelity (Dim 6):** "Where reports are appearing recently" accurately describes the panel; the divider frames it as separate from the baked analysis. ✓ (except the "When" interpretation, finding #1)
- **Filter parity (Dim 1):** the live `where` clauses mirror the build's `signals.py` filters verbatim, so the section is definitionally consistent with the metrics above. ✓
