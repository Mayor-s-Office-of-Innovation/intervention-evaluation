# Stops dashboard — review findings

Audit of `stops/` against the `dashboard-review` skill (accuracy → clarity → tone → load).
Reviewed 2026-09-12 at commit `2c0958c`. **All fourteen findings are resolved** (2026-09-12).
Statuses and the reasoning behind each decision are recorded per finding, as a rationale log for
anyone who later asks why something reads the way it does.

**Privacy:** this doc is written to be committable. It deliberately contains no per-stop boardings
figures, removal asks, basis notes or rank — per the project rule that list details stay out of
committed files. F12 is about exactly that rule.

## What holds up

Worth stating before the findings, because it is most of the dashboard:

- **The source↔data trace is sound.** Re-ran the encampment per-stop query live against DataSF for
  Market & Castro: the 12-month window returns **363**, matching the baked series and the card
  field exactly. One month drifted (2023-02: baked 1, live 2) — see F11.
- **Denominator integrity on the citywide panel is clean.** `total_t12` is summed over sheltered
  stops only, and the concentration curve's numerator is a true subset of it. Verified: top 25 =
  1,844 / 5,249 = 35.1%, matching the published 0.351. No population conflation.
- **Every signal carries a runnable query.** `provenance.json` holds a live `query_url` and a
  per-stop template for all four signals, with filters copied verbatim from the unhoused/drug
  dashboards. This is the round-trip verifiability the skill asks for.
- **The 911 "not attributable" handling is honest** — mid-block stops get "not attributable",
  never a zero that would read as "nothing happens here".
- `validation/validate_stops.py` passes.

## Ranked findings

| # | Finding | Dimension | Severity | Status |
|---|---|---|---|---|
| F1 | "Boardings / day" shows the list's *lift-deployment* column | 1 Primary source · 6 Fidelity | **Critical** | **Resolved** — kept, caption honest, provenance recorded |
| F2 | "Since 2023" differs between citywide table and stop card | 3 Consistency | **High** | **Done** — both read 746 |
| F3 | H1 and homepage promise ridership for "any stop"; it exists for 0.9% | 6 Fidelity | **High** | **Done** — page (Aaron) + homepage card |
| F4 | "Neighbours (3 nearest unsheltered)" when the divisor is often not 3 | 2 Denominator · 6 Fidelity | Medium-High | **Done** |
| F5 | Legend says "most reports"; the dot is the highest *normalised* signal | 6 Fidelity | Medium | **Done** |
| F6 | Sparkline draws the ring series on a second, different scale | 5 Encoding | Medium | **Done** — moved to its own strip |
| F7 | "188 have never had a report" mixes time bases with its own sentence | 3 Recency | Medium | **Done** |
| F8 | Routes / next-stop (GTFS) have no reader-facing source link | 4 Source links | Medium | **Done** |
| F9 | "removal is one option among several reversible ones" | 6 Fidelity · 7 Tone | Medium | **Resolved** 2026-09-12 |
| F10 | Query links return a monthly series, not the displayed total | 4 Source links | Low-Med | **Done** — exact round-trip |
| F11 | Nothing tells the reader 311 counts restate after publication | 3 Recency | Low | **Done** |
| F12 | Committed public TSV republishes a list figure under a renamed column | 4 Hygiene · privacy | Low-Med | **Resolved** — cleared for publication |
| F13 | "Red rows are on the concern list" — they are not rows | 6 Fidelity | Low | **Done** |
| F14 | Dead history/`popstate` path; unused `ink` binding | Appendix | Low | **Done** |

---

### F1 — "Boardings / day" is showing the list's lift-deployment column · **Critical**

**Location:** [js/app.js:268](js/app.js#L268) (stop card), [build/04_rollup.py:56](build/04_rollup.py#L56)
(the fallback), [js/app.js:379](js/app.js#L379) (methodology), [../index.html](../index.html) (homepage card copy).

**Problem.** The rollup reads
`g(r, "Boardings") or g(r, "Lift deployments: Aver/day")`. In the source list the `Boardings`
column is **empty for all 33 rows** — verified directly. So the fallback fires every time, and
every value the dashboard prints under the label **"Boardings / day"** is drawn from the column
headed *Lift deployments: Aver/day*. The card's own caption calls it "SFMTA figure, average daily;
date unverified", and the methodology says "Boardings are the leadership list's own figures where
present" — both assert a ridership reading the source does not support.

**Why it misleads.** This is the dashboard's entire "cost of removal" side. A reader weighing
whether to remove a shelter is being shown a number labelled as daily ridership that may be a
wheelchair-lift deployment count — a different measurement by one to two orders of magnitude. If
it *is* ridership, the label is right by luck and the source heading is wrong; either way nobody
can currently tell which, and the dashboard resolves the ambiguity silently in the direction that
makes the figure more useful. That is exactly the failure mode Dimension 1 exists to catch: an
intermediary's number transcribed under an assumption instead of confirmed against the source.

**Proposed change** — pick one:
1. **Remove the figure** until SFMTA confirms what the column measures (the skill's bias-toward-removal
   default; the card already has a clean "stop-level ridership not yet available" state).
2. **Relabel to the source's own words** — "Lift deployments / day (SFMTA list; column heading
   ambiguous, unconfirmed)" — and drop "boardings" from the H1, the homepage card and the methodology.

Recommend (1), with (2) as the fallback if the figure is load-bearing for the current decision.
Whichever is chosen, the `or` fallback in `04_rollup.py` should be deleted rather than left to fire
invisibly — if the `Boardings` column is ever populated, the two sources must not silently merge
into one field.

**Status: Resolved 2026-09-12 — figure kept, framing corrected.**

Aaron confirmed the figures *are* daily boardings and are cleared for publication; the source sheet's
`Lift deployments: Aver/day` heading is legacy. The value distribution supports this independently —
median 56, max 303, which is plausible ridership and implausible as lift cycles (303 would be one
deployment every three minutes all day). There is no published SFMTA dataset to link to yet, and
boardings will not become available for non-listed stops.

Applied:
- Card caption now reads "Average daily, from the leadership list — no published source to link yet",
  replacing "SFMTA figure, average daily; date unverified" — it states the gap instead of implying a
  verifiable SFMTA source. The empty state reads "only available for concern-list stops".
- Methodology says the figures exist only for listed stops, that no dataset can be linked yet, and
  that they therefore can't be checked on the page.
- [build/04_rollup.py:56](build/04_rollup.py#L56) carries a comment recording the column-heading
  history and the basis for reading it as boardings — so the provenance survives in the repo even
  though the public TSV renames the column (F12).

The `or` fallback stays: the private list needs it, and it is now documented rather than silent.

---

### F2 — The same metric reads 756 in one panel and 746 in another · **High**

**Location:** [build/04_rollup.py:154](build/04_rollup.py#L154) (`"all": sum(...)`) vs
[js/app.js:227](js/app.js#L227) (`sum(stop, 0, partialIdx - 1)`).

**Problem.** The citywide table's "Since 2023" column sums the **whole** series including the
current partial month. The stop card's "since 2023" figure excludes it. Verified on Market &
Castro: **756** in the table, **746** on the card (the partial month holds 10).

**Why it misleads.** The table row links to the card. A reader clicks the top stop and the headline
total changes by 10 with no explanation, under an identical label. It reads as a bug in the data
rather than a window difference — and it quietly undermines the trust the rest of the provenance
work earns.

**Proposed change.** Exclude the partial month in `04_rollup.py`'s `all` ([line 154](build/04_rollup.py#L154)) and in
`months_active` ([line 155](build/04_rollup.py#L155)), which has the same exposure, so both panels mean "through the last complete month". Keep the
card's behaviour as the reference — it is the correct one.

**Status: Done 2026-09-12.** `all` and `months_active` now stop at the last complete month
([04_rollup.py:154-156](build/04_rollup.py#L154-L156)); data rebuilt from the cached join. Market &
Castro reads **746** in both places. `t12` (363) and the concentration curve (0.156/0.220/0.351) are
unchanged, confirming the fix touched only the intended span. `sheltered_with_zero` moved 188 → 189:
one stop's only reports fell in the partial month, which is correct under the corrected definition
and consistent with F7's relabel.

---

### F3 — The page promises ridership it has for 0.9% of stops · **High**

**Location:** [index.html:62-66](index.html#L62-L66) (H1 + sub), [../index.html](../index.html) (homepage card).

**Problem.** The H1 is "Bus stops — who complains, **who rides**, what a change would cost" and the
sub-head offers "the cost side — routes, **boardings**, and the walk to the next stop" for "any Muni
stop". The homepage card repeats it: "**Any stop**: … plus routes, **boardings** and the walk". A
boardings figure exists only for the 29 matched concern-list stops — **29 of 3,260 stops (0.9%)**.
Every other stop shows "not available".

**Why it misleads.** The promise is made at the two places a reader decides whether to trust the
tool, and is broken on the first arbitrary stop they look up. It also overstates what the dashboard
can say about removal cost in general.

**Proposed change.** Drop "who rides" from the H1 and "boardings" from both sub-heads; describe the
cost side as routes and the walk to the next stop, which *are* universal. If F1 resolves toward
keeping the figure, reintroduce it as "boardings for listed stops" rather than as a general feature.

**Status: Partly resolved 2026-09-12.** Aaron rewrote the page copy: title → "Muni stops", H1 →
"Bus stops", sub-head → "Look up any Muni stop. Four community-reported signals at the stop, the
same signals at its neighbours and the surrounding block." The ridership promise is gone from the
dashboard itself, and the sub-head now describes only what the page delivers for every stop.

**Done 2026-09-12.** The homepage card now reads "Any stop: … plus routes and the walk to the next
stop. Includes the concern list, **with boardings for the stops on it**" — the universal claim covers
only what is universal, and boardings are scoped to where they exist rather than dropped.

---

### F4 — "3 nearest unsheltered" when the divisor is often not 3 · **Medium-High**

**Location:** [js/app.js:246](js/app.js#L246), mean computed at [js/app.js:214-216](js/app.js#L214-L216).

**Problem.** The comparison line is hardcoded "Neighbours (3 nearest unsheltered)". Two ways the
actual divisor differs: **144 stops have fewer than 3 neighbours** within 400 m (73 have 2, 50 have
1, **21 have none**); and for the two 911 signals `nbMean` drops neighbours with a null series
(`.filter(Boolean)`) before averaging, so a stop whose neighbours are mid-block averages over 1 or 2.

**Why it misleads.** This is the card's baseline for "is it the shelter or the corner?" — the single
comparison a removal decision leans on. A mean over one neighbour presented as a mean over three
reads as more robust than it is, and the reader has no way to see the difference.

**Proposed change.** Render the actual count — "Neighbours (nearest 2 unsheltered)" — and suppress
the comparison entirely where it is 0, rather than printing "—" next to a confident label.

**Status: Done 2026-09-12.** `nbMean` now records how many neighbour series it averaged, and the label
renders that count — "Neighbours (nearest 2 unsheltered)". Where no unsheltered neighbour exists within
400 m the comparison is replaced by "No unsheltered neighbour within 400 m" instead of a confident label
next to an em dash.

---

### F5 — The map legend describes the wrong quantity · **Medium**

**Location:** [index.html:93](index.html#L93).

**Problem.** "Dot colour = the checked signal with **the most reports there** (each scaled to its own
citywide spread)". The main clause is not what the code does: `dotPaint` picks the signal with the
highest **p95-normalised** value. A stop with 40 encampment reports can be coloured shelter-maintenance
because 5 shelter-maintenance reports sit higher against that signal's own spread.

**Why it misleads.** A reader scanning the map reads colour as "what is worst here". The parenthetical
technically corrects the main clause, but it reads as a footnote about scaling rather than a
redefinition of what the colour means.

**Proposed change.** Lead with the real quantity: "Dot colour = the checked signal that stands out
most at this stop relative to its own citywide spread (not the largest raw count) · size = combined
intensity".

**Status: Done 2026-09-12.** Legend now reads "Dot colour = the checked signal that stands out most here
against its own citywide spread (not the largest raw count) · size = combined intensity". The correction
is in the main clause rather than a trailing parenthetical.

---

### F6 — Two vertical scales in one sparkline · **Medium**

**Location:** [js/app.js:306-307](js/app.js#L306-L307); legend at [js/app.js:282](js/app.js#L282).

**Problem.** Bars (this stop) and the neighbour line share `max`. The ring line (25–250 m) is drawn
against its own `ringMax`. The legend discloses it as "scaled to fit".

**Why it misleads.** Dimension 5: encoded height should be proportional to value. Three series in one
frame invite level comparison, and here the ring's height is meaningless against the bars — it can sit
below the bars while representing several times as many reports. "Scaled to fit" is doing a lot of work
in small grey text.

**Proposed change.** Either plot the ring on the shared scale (its shape survives; it will simply sit
high), or move it out of the bar frame into its own thin strip. If the dual scale stays, label it in
the chart itself — "ring: own scale" — not only in the shared legend below.

**Status: Done 2026-09-12 — separated, not merged.** The shared scale was rejected: the ring counts a
much larger area, so folding it into `max` squashes the stop's own bars, which are the primary series.
Instead the SVG is now two stacked frames — bars + neighbour mean in the main area, and the ring in its
own 20 px strip below with its own baseline and its own maximum. A second scale is legitimate once the
frames are visually separate; it was only dishonest while the two shared one frame and invited a height
comparison. The strip is labelled in the chart itself — "surrounding 25–250 m · own scale, peak N" —
so the scale is stated where it is read, not only in the legend. `styles.css` `.spark` height moved
84 → 106 px to match the taller viewBox (`preserveAspectRatio="none"` would otherwise squash it).

---

### F7 — "Never" measured over a different window than the sentence states · **Medium**

**Location:** [js/app.js:340](js/app.js#L340); computed at [build/04_rollup.py:159](build/04_rollup.py#L159).

**Problem.** The sentence opens by scoping itself to Sep 2025–Aug 2026, then says "991 sheltered
stops; 188 have **never** had a report". `sheltered_with_zero` is `not any(series)` — i.e. none since
**Jan 2023**, the history start, not "never" and not within the stated window.

**Proposed change.** "…188 have had none since 2023." Also worth stating the history start once near
the citywide panel, since "since 2023" appears as a column header there too.

**Status: Done 2026-09-12.** Now "…189 have had none since 2023", with the year read from the series
rather than hardcoded. The count itself was also corrected to the same span (see F2).

---

### F8 — The GTFS-derived figures have no reader-facing source · **Medium**

**Location:** [js/app.js:267](js/app.js#L267) and [js/app.js:270](js/app.js#L270) (Routes, Nearest alternative stop),
links row at [js/app.js:283-288](js/app.js#L283-L288).

**Problem.** Routes served and the walk to the next stop come from the SFMTA GTFS feed. The reader
gets no link — the methodology names the feed in prose, and `provenance.json` holds the URL, but
nothing in the published view is clickable. The links row offers Street View, Google Maps and the
Muni Stops dataset, so the omission is specifically GTFS.

**Why it matters.** Dimension 4 is explicit that reviewer-side verification is not sufficient. The
walk-to-next-stop distance is half the removal-cost argument and is currently unverifiable by the
reader. Default fix is to **add the link**, not cut the figure.

**Proposed change.** Add the GTFS feed URL from `provenance.json` to the links row, labelled with what
it sources ("Routes & next stop: SFMTA GTFS ↗"), and surface `gtfs_as_of` next to it.

**Status: Done 2026-09-12.** Links row gained "Routes & next stop: SFMTA GTFS (as of <date>) ↗", built
from `PROV.gtfs.url` and `gtfs_as_of`, so the feed and its vintage are both reader-visible.

---

### F9 — "removal is one option among several reversible ones" · **Medium**

**Location:** [index.html:65-66](index.html#L65-L66).

**Problem.** As written this places removal *among* the reversible options. Removal of a shelter is
the one irreversible move on the table; the project's own framing is removal weighed **against**
reversible alternatives (lighting, cleaning, foot patrols).

**Why it misleads.** It inverts the central trade-off the dashboard exists to support, in the
sub-head. Whether read as a typo or as framing, it lowers the stakes of the decision.

**Proposed change.** "Complaints measure who reports, not harm. Removal is permanent; the
alternatives — lighting, cleaning, added service — are reversible." States the distinction and lets
it stand without advocacy.

**Status: Resolved 2026-09-12** — by deletion rather than rewording. Aaron cut the whole framing
sentence from the sub-head. The muddled reversibility claim is gone, and the page now states what it
shows without arguing a position, which is the skill's preferred default (Dimension 7).

**Rationale worth keeping:** the dropped clause "complaints measure who reports, not harm" was a
genuine honesty caveat, but it survives in the methodology on the encampment signal itself ("Counts
who reports, not harm; a burst can be one neighbour"). That is better placement than a sub-head —
the caveat now sits next to the figure it qualifies. No action needed. Note it is phrased for the
encampment signal only; if the other three ever need the same warning, it belongs in their
`provenance.json` caveats, not back in the header.

---

### F10 — Query links return a series, not the number on the card · **Low-Med**

**Location:** `stop_query_template` in [data/provenance.json](data/provenance.json), used at
[js/app.js:231-235](js/app.js#L231-L235).

**Problem.** The link is genuinely live and correct — but it returns ~45 monthly rows from 2023
onward with no upper bound. To check the "last 12 mo" figure the card shows, a reader must pick out
12 of those rows and add them. The gold standard in Dimension 4 is a link that returns the displayed
number.

**Proposed change.** Freeze the displayed window into the URL for the "last 12 mo" figure
(`AND requested_datetime >= '<t12 start>' AND requested_datetime < '<t12 end+1mo>'`, no `GROUP BY`),
so the query returns one number equal to the one on the card. Keep the full monthly series as a
second link for the sparkline, which is what it actually sources.

**Status: Done 2026-09-12 — gold standard reached.** `signals.py` gained `stop_total_template()`,
a query with no `GROUP BY` over a closed `[from, to)` window, exposed per signal in `provenance.json`
and filled from `META.t12_window`. The displayed 12-month figure is now itself the link. Verified live:
the link under Market & Castro's **363** returns `[{"reports":"363"}]` — the number on the card, not a
series to add up. The monthly-series link remains, relabelled "Monthly series on DataSF ↗", since that
is what actually sources the sparkline. The linked number keeps the text colour with a dotted underline
so it still reads as a figure rather than a blue link.

The stops e2e test asserted exactly 4 DataSF links per card; it now asserts 8, checks that the four
totals are anchors, and asserts the total query contains `SELECT count(*)` and no `GROUP BY` — so the
round-trip property is what's actually tested, not just the link count.

---

### F11 — 311 counts restate after publication, silently · **Low**

**Location:** whole page; observed in the live trace.

**Problem.** Re-running the query found 2023-02 now returns 2 where the baked series holds 1 — 311
cases get re-geocoded and backfilled, so history moves slightly. This is normal and small, but the
page presents baked counts as settled.

**Proposed change.** One clause in the methodology: "311 records are occasionally re-geocoded, so
counts for past months can shift slightly between refreshes." The weekly refresh makes this a
recurring, not one-off, condition.

**Status: Done 2026-09-12.** Methodology now states that 311 records are occasionally re-geocoded and
past-month counts can shift slightly between weekly refreshes.

---

### F12 — The committed public TSV republishes a list figure under a renamed column · **Low-Med**

**Location:** [build/concern_list.public.tsv](build/concern_list.public.tsv).

**Problem.** The public extract has three columns — `Stop ID`, `Location`, `Boardings` — and the
`Boardings` column carries the values that in the source list sit under `Lift deployments: Aver/day`.
Two consequences: the provenance trail is erased in the committed artifact (downstream, the rename
*is* the only surviving evidence of what the column means), and a per-stop figure from the leadership
list is published, which the project's privacy note lists among the details to keep out of committed
files.

**Why it matters.** F1 is only discoverable today because the gitignored original is still on this
machine. Anyone rebuilding from the public TSV alone would have no way to find the mislabel.

**Proposed change.** Rename the column in the public extract to the source's own heading, and confirm
explicitly whether this figure is cleared for publication — the privacy note says no, the approved
build behaviour says yes. Worth resolving the contradiction in the note either way.

**Status: Resolved 2026-09-12.** Aaron confirmed the boardings figure is cleared for publication, so
the public TSV may carry it. The lost-provenance half is addressed by the comment now in
`04_rollup.py` (see F1). Worth amending the privacy note, which still lists boardings among the
details to keep out of committed files — that line is now out of date.

---

### F13 — "Red rows are on the concern list" · **Low**

**Location:** [js/app.js:340](js/app.js#L340); the tag is rendered at [js/app.js:344](js/app.js#L344).

**Problem.** Nothing renders a red row. Concern-list stops get a red "on list" tag inside the Stop
cell. The description sends the reader looking for a row highlight that does not exist.

**Proposed change.** "Stops on the concern list are tagged." (The tag already carries text as well as
colour, so it does not depend on colour alone — that part is fine.)

**Status: Done 2026-09-12.** Now "Stops on the concern list are tagged."

---

### F14 — Appendix: dead history path, unused binding · **Low**

**Location:** [js/app.js:203](js/app.js#L203), [js/app.js:159](js/app.js#L159).

- `showStop` takes a `push` option but calls `history.replaceState` in both cases, so viewing a
  series of stops leaves no history entries and the `popstate` handler at
  [js/app.js:62-65](js/app.js#L62-L65) can never fire for them. Either use `pushState` when
  `push` is true, or drop the option and the handler.
- `drawHalo` computes `const ink` and immediately discards it with `void ink;` — leftover from the
  ring-colour change. Remove.

**Status: Done 2026-09-12.** `showStop` uses `pushState` when `push` is true (so back steps through
viewed stops and the `popstate` handler is live) and `replaceState` otherwise; the unused `ink`
binding and its `void ink;` are gone.

---

## What remains

**F6** (sparkline draws the ring on its own scale) and **F10** (query links return a monthly series
rather than the displayed total) are the only findings still open. Both are real but neither is a
wording fix: F6 needs a layout decision (shared scale vs. its own strip), and F10 needs the t12 window
frozen into a second URL per signal. Neither blocks publication.

**Verification after applying:** `validate_stops.py` passes; stops e2e 3/3; homepage e2e 7/7 (1
pre-existing skip). The live DataSF trace was re-run against the rebuilt data — Market & Castro still
returns 363 for the 12-month window.
