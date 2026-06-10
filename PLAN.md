# Plan — Self-serve tool: "Does the data support my hypothesis?"

**Status:** 🟢 Stage 1 + Stage 1.1 built & working (5 data points, OS dark mode, adjustable radius, slider-driven summary). Smart default date window (§8.3). **Save & share via URL (§8.4).** Playwright e2e suite in `tests/` (`npm test`, 8 passing). **Next up: Stage 2 (AI verdict).**
**Source brief:** [`spce-self-hypothesis-test.md`](spce-self-hypothesis-test.md)
**Owner:** Aaron · **Drafted:** 2026-06-01 · **Last updated:** 2026-06-02

> This is a **living document** — keep it current as we make changes. See the Changelog (§13).

---

## 1. Goal

Give a city official who recently changed an environment, procedure, or staffing level
(in response to resident complaints) a fast, self-serve way to see whether SF OpenData
shows any evidence the change had the intended effect.

**Canonical example (drives the prototype):** Koshland Park (Page & Buchanan).
On 2026-05-13/14, new lighting + tree trimming were installed to improve sight lines
and reduce drug-related activity. Did nearby drug-related complaints change afterward?

This tool **generalizes work that already exists** in the companion `emergent-map`
repo — the hand-built notebook `notebooks/hayes_koshland_intervention.md` there
is effectively the prototype analysis (same park, same intervention, same 250 m radius,
same drug-noted 911 signal). We turned that one-off analysis into a reusable,
pin-and-date-driven tool, then generalized it to many vetted data points.

---

## 2. Domain context & motivation

Why this matters, from stakeholder conversations:

- **DPW meeting notes** (street/environmental services):
  - **Balloon / displacement effect.** Encampment *removal* in the Tenderloin/Civic Center
    worked, but "that doesn't mean unhoused are gone, they are scattered… now Market St, 6th,
    spreading toward Franklin, Gough. I think data will prove this type of call will come in."
    → Falling encampment reports ≠ fewer unhoused. This motivates the **`homeless_presence`
    aggregate** (§7, combines encampment + displacement-type 911 calls) and a standing caveat (§12).
  - **Cleaning priorities:** "needle, oil, blood are higher priority." (Blood has no 311 code —
    see §8 hazard caveat.) → informs a future priority-weighting / AI-verdict emphasis.
  - **"Using AI to eliminate duplication"** of service orders → relevant to data quality.
  - Mental health is a recurring theme; repetition/routine of cleaning + PD presence is what
    holds gains (UN Plaza → 6th → Hayes Valley balloon).

- **"Request for BI assistance" initiative** (resident-sentiment theory): residents with a
  direct line to leadership demand immediate action (e.g. one tent in a wealthy block),
  pulling resources away from higher-concentration districts. Theory: if we **show residents
  the data on the city's efforts**, they feel heard and tolerate a slower response. Proposed
  test = survey → show data → re-survey.
  - **Relevance to this tool:** our tool is exactly the kind of artifact that could *show that
    data* — a potential second audience beyond officials (a resident-facing "here's what the
    data shows" view). Recorded as a possible future direction, not yet scoped.
  - **Data gap noted:** "city response" metrics they'd want (cost to clear a tent, # of times a
    person is contacted/week) are **not in OpenData** and aren't queryable today. Also: residents
    who contact the city outside 911/311 generate no queryable data — 911/311 is our universe.

---

## 3. Decisions locked

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **No backend in v1.** Query `data.sfgov.org` directly from the browser. | Notebooks already do this with a `soda()` fetch + Socrata `within_circle()`. Static hosting, no key, no server. |
| D2 | **AI synthesis deferred to Stage 2.** | Build the data + visualization first; see how a no-AI version reads before investing in the AI verdict. |
| D3 | **Verdict is lightweight in v1.** A descriptive line ("X before → Y after") in a slot that's the future home of the AI verdict. | Honest binary true/false is hard without AI and would be thrown away once AI lands. |
| D4 | **Lives in `/hypothesis-tool/`** as a self-contained static app. | Its own Leaflet + Web Awesome frontend — not the emergent-map deck.gl stack. |
| D5 | **Data decoupled from rendering.** Query + aggregation → plain arrays; chart/map are pure consumers. | Keeps adding a new data point localized to the registry (§7). |
| D6 | **Hand-rolled SVG chart** styled to the resultsfor look. | Leanest — zero chart dep, full pixel control. (resultsfor uses Recharts, React-only, never shareable.) |
| D7 | **Short post-window → render with a caution flag**, don't refuse a result. | Keeps the UX exercised; honesty via caveat, not by hiding output. |
| D8 | **No Tailwind / no CSS framework.** Plain CSS reusing only resultsfor *token values*. | Lean, dependency-free; we want the look, not a framework. |
| D9 | **Data points live in a registry** (`js/datapoints.js`); the "What do you expect to change?" picker is generated from it. | One object per vetted signal = adding an effect is a data change, not a code change. |
| D10 | **Normalize the SF 311 taxonomy migration** (2024-06-13 Title Case → snake_case) in every litter filter via `lower(...) LIKE`. | Otherwise the time series shows a fake cliff on that date. |
| D11 | **Stale-run guard.** Rapid dropdown/pin changes discard in-flight fetches; only the latest selection renders. | Prevents race conditions clobbering the UI. |
| D12 | **Slider window = analysis window.** The date-range slider also bounds the before/after used by the verdict + stat cards (split at the intervention date). | One coherent window drives chart, map, stats, and verdict; lets users interactively define their comparison. |
| D14 | **Smart default date window.** The slider's default *start* = detected elevated-regime onset (overrideable); end = today. | Avoids diluting the before/after against quiet baseline — an ongoing spike shouldn't look resolved. |
| D15 | **Save & share reports as URL state — no backend, live re-query.** A report is just its inputs (`dp, date, lat, lng, r, from, to, what`) serialized as plain query params; the data is never stored, it's re-queried live from Socrata on open. Address bar live-syncs via `history.replaceState`; a "Copy shareable link" button copies it. | The tool stores no data, so a report is fully reproducible from a tiny, human-readable URL. Fits D1 (no backend). Tradeoff: a shared link re-queries, so counts drift as new data lands (a feature here — always current); a frozen snapshot would need storage (deferred). |
| D13 | **Multi-source data points + within-source dedup.** A data point may declare `sources: [...]` across datasets; each is fetched, deduped by record id, then concatenated. Cross-source records are kept (no shared key). | Lets one option (e.g. "homelessness presence") combine 311 + 911 without double-counting rows; cross-system overlap is genuinely distinct reports. |

---

## 4. Design language

Mirror the **visual design** of [resultsfor.sf.gov](https://resultsfor.sf.gov/) — *style only*
(it's a React + Mapbox + Tailwind SPA we explicitly avoid). We reuse the **token values**:

- **Fonts:** system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`).
- **Palette:** blue `#3b82f6`, amber `#f59e0b`, orange `#f97316`, purple `#a855f7`,
  green `#22c55e`, red `#ef4444`, slate `#1f2937`, gray `#6b7280`.
- Light surfaces, clean cards, restrained accents.

Implemented as CSS custom properties (`--c-blue`, `--c-red`, `--font-sans`, …) in `styles.css`,
layered alongside Web Awesome's theme tokens.

---

## 5. Architecture & tech stack

```
Browser (static files)
  ├─ Web Awesome 3.7.0   (UI components, via CDN autoloader)
  ├─ Leaflet 1.9.4       (maps, via CDN; CARTO Positron light tiles)
  ├─ hand-rolled SVG     (chart, no dependency)
  └─ ES modules          (our code)
        │  fetch()
        ▼
  data.sfgov.org Socrata SoDA API   (live, CORS-enabled, no key)
```

- **No build step, no backend, no secrets.** Serve the folder statically.
- **Web Awesome** runtime via CDN. Its **Agent Skill** (`.agents/skills/webawesome/`,
  symlinked into `.claude/skills/`) is dev-time only — component docs for Claude while building.
  (Web Awesome ships **no MCP server**; the "MCP" in the brief is this skill.)

```
hypothesis-tool/        ← repo root (standalone GitHub Pages site)
  PLAN.md            ← this document
  index.html         ← shell: Web Awesome + Leaflet (CDN) + ES modules
  styles.css         ← resultsfor token values, plain CSS
  js/
    datapoints.js    ← REGISTRY: vetted data points (label, description, query, mapper)  [D9]
    soda.js          ← generic Socrata fetch: adds within_circle + date filter per data point
    analyze.js       ← bucketSeries (day/week/month) + pre/post window summary   (pure)
    chart.js         ← hand-rolled SVG bar chart + intervention marker + tooltip  (render)
    map.js           ← Leaflet pin picker + event dots w/ popups                  (render)
    app.js           ← orchestration: inputs → query → analyze → render (+ slider, stale-guard)
  tests/e2e.spec.js  ← Playwright e2e against live Socrata (run: npm test)
  playwright.config.js ← Playwright config (dev server on :8090)
  .github/workflows/deploy.yml ← GitHub Pages deploy on push to main
```

> **Out of scope for now:** integrating into resultsfor.sf.gov (design-style reuse only).

---

## 6. Data layer (the registry) — §7 catalog lists the entries

Each data point in `js/datapoints.js` is self-contained:

```
{ key, label, title, noun, description,
  dataset, dateCol, geoCol, select, signalWhere, mapRow }
```

A data point is **single-source** (dataset/geoCol/… directly on the object) or **multi-source**
(a `sources: [...]` array of the same shape) per D13. `soda.js` `fetchEvents(dp, {lat,lng,radiusM,
startISO})` fetches each source — `within_circle(<geoCol>, lat,lng,radiusM) AND <dateCol> >= startISO
AND <signalWhere>`, `$limit 5000`, maps rows via `mapRow` to `{ datetime, day, ym, id, place, lat,
lng, notes }`, **dedupes within the source by `id`** — then concatenates. Returns
`{ events, queries:[{dataset,url}] }`; every source's Socrata URL is surfaced (transparency norm).

- **Spatial:** `within_circle` — radius fixed at **250 m** (adjustable slider planned, §8.1).
- **Temporal:** full history `2023-01-01` → today, as individual events (chart + map both consume).
- Works across two datasets: SFPD CFS `2zdj-bwza` (911) and SF311 `vw6y-z8j6`.

---

## 7. Implemented data points (5)

Grouped by theme; all community-reported where applicable (`onview_flag IN ('N','HSOC')` for 911).

| Key | Label | Dataset(s) | Signal | Note / caveat |
|---|---|---|---|---|
| `drug` | Reduce drug-related activity | 911 `2zdj-bwza` | Suspicious Person calls with drug notes (`DRUG/DEALER/SALES/METH`) | Cleanest community drug signal; broadened past literal "DRUGS". |
| `overflow` | Reduce overflowing trash cans | 311 `vw6y-z8j6` | Cleaning details `LIKE %overflow%` | Pure DPW servicing signal. |
| `dumping` | Reduce illegal dumping | 311 | Bulky items (furniture/mattress/appliance/electronics/tires) + dumping labels | No single 311 field; combined. Concentrated in southern districts (Bayview, Excelsior). |
| `hazard` | Reduce health-hazard waste | 311 | human waste/urine + needles + oil/spills + hazardous/medical | DPW priority. ⚠ can't isolate **blood** (no code); feces bundled w/ urine/animal/vomit. |
| `homeless_presence` | Reduce homelessness presence | 911 + 311 (**multi-source**, D13) | 911 Sit/Lie + Blocked Sidewalk + Homeless Complaint (non-duplicate) **and** 311 Encampment | Aggregate of unhoused-presence reports; 911 duplicates dropped via `dup_cad_number`. **Trespasser excluded** (only ~7% homeless-related — see §8.2); **HSOC dropped** (response signal). Cross-system overlap kept (distinct reports). |

> Each entry carries a user-facing **`description`** (shown under the dropdown today; can later
> move to a tooltip/popover or feed the AI verdict). All litter filters are migration-normalized (D10).
> The 4 earlier homelessness options (encampment / displacement / HSOC / homeless-complaint) were
> collapsed into `homeless_presence` on 2026-06-02 (HSOC dropped).

---

## 8. Stage 1 — DONE ✅

**Inputs** (Web Awesome): *What did you do?* (free text), *When?* (date), *What do you expect to
change?* (**dropdown** from the registry), *Where?* (Leaflet pin + 250 m circle; default
**Page & Buchanan, 37.77346/-122.42736**; default date 2026-05-13).

**Processing** (client-side): `fetchEvents(dp,…)` → `analyze.js` builds the chart series
(adaptive **day / week / month** buckets via `chooseGranularity`) and the fixed **90-day
before / after** window summary.

**Outputs:**
- **Verdict slot** — lightweight descriptive line (noun adapts per data point) + short-window
  caution flag. AI verdict will replace this (Stage 2).
- **Stat cards** — before, after, rate change, total in radius.
- **Chart** — hand-rolled SVG bars with dashed **intervention marker** + hover tooltip, and a
  **dual-thumb date-range slider**: drag to zoom; bars switch month→week→day; **the map dots
  re-filter to the window** (chart scrubs live; map commits on release, keeps pan/zoom).
- **Map** — Leaflet/CARTO light; pin + radius; one dot per event, popup = date + place + details.
- **Reproduction link** to the live Socrata query.

Verified end-to-end (Playwright, headless) across all 8 data points; counts match direct queries.

---

## 8.1 Stage 1.1 — UX & theming ✅ DONE (2026-06-02)

Built in the order 4 → 3 → 1 → 2, then a committed Playwright suite.

1. **Gate + scroll** ✅ — results hidden until a *successful* query, then smooth-scroll to them on
   "Check the data" (only the button scrolls; slider/pin auto-reruns don't). *Test-found bug:* the
   `hidden` attribute was being overridden by `.wa-stack` (`display:flex`); fixed with
   `[hidden] { display: none !important; }`.
2. **Dark mode (OS-respecting)** ✅ — inline `<head>` script toggles `html.wa-dark|wa-light` from
   `prefers-color-scheme` (live). `styles.css` overrides the same tokens under `html.wa-dark`; chart
   tooltip tokenized; Leaflet swaps to CARTO `dark_all` tiles (and back) on scheme change.
3. **Adjustable radius slider** ✅ — `wa-slider` 100–1000 m (default 250) drives `within_circle`;
   live-updates the circle + readout while dragging, refetches on release. Polygon draw → Stage 3.
4. **Slider-driven summary (D12)** ✅ — the date-range slider window is the analysis window: verdict +
   the four stat cards recompute before/after *within the window* (split at the intervention date),
   live on slider input (map commits on release). Default window = full range; intervention outside the
   window is flagged. (Stat cards: Before·Ndays / After·Mdays / Rate change / In view.)

**Tests** ✅ — `hypothesis-tool/tests/e2e.spec.js` + standalone `playwright.config.js` (server on
:8090, separate from the main app suite). 7 live-Socrata e2e tests (structural, count-tolerant):
data-point list + gate, default run, multi-source aggregate links, slider granularity + stat update,
radius refetch, smart-default window, OS dark mode. Run: `npm test`.

---

## 8.3 Smart default date window ✅ DONE (2026-06-02)

`analyze.js → detectWindowStart()` sets the slider's default *start* to the onset of the most recent
elevated regime, so the before/after isn't diluted by quiet history (D14). **Method:** monthly
pre-intervention counts; baseline = median excluding the trailing 3 months; threshold =
`max(2×baseline, baseline+2)`; walk back over a **3-month rolling average** while it stays ≥ threshold
(the smoothing rides over one-month dips — a raw threshold picked Apr, smoothing recovers the true
fall-2025 onset). **Fallback:** a recent 90-day window when history is short (<6 mo) or too sparse
(<12 pre events). End = today; before/after still splits at the intervention date (D12); the slider
overrides, and a note explains the pick.

**Chosen option 2a** (default chart zooms to onset→now). Koshland (drug): default = **Oct 2025 → now**,
verdict **≈7.9 → ≈10.0 / 30 days (▲27%)** — i.e. the spike is *continuing*, the honest read — vs the
old full-range default that diluted "before" against years of zeros.

**Still open:** option 2b — keep full history visible and just *mark* the onset instead of zooming;
revisit if the zoomed default feels too narrow.

---

## 8.4 Save & share reports (URL state) ✅ DONE (2026-06-03)

Pod leaders wanted to save and share reports (§13). Because the tool **stores no data**
(every figure is re-queried live from Socrata), a report is fully captured by its inputs —
so we encode them as plain query params and re-run on open (D15). No backend.

- **Params:** `dp` (data point), `date` (intervention), `lat`/`lng` (pin), `r` (radius),
  `from`/`to` (analysis window), `what` (the free-text intervention description — captured so
  nothing the user typed is lost). Human-readable; a link is ~100–200 chars, hand-editable.
- **Live URL sync** — `syncURL()` writes the current state to the address bar via
  `history.replaceState` on every change (data point, date, pin, radius, free text, committed
  slider window) and at the end of each run. So the URL is always current & bookmarkable.
- **Open a shared link** — `readParams()` restores the inputs and sets `urlWindow`, then
  auto-runs. The saved `from`/`to` **override the smart-default window (§8.3)** so the shared
  view reproduces exactly; the range note reads "Showing the shared report's saved date range."
  (Override is one-shot — changing radius/pin afterward recomputes the smart default.)
- **"Copy shareable link"** button in the results header → `navigator.clipboard` (falls back to
  showing the URL); confirmation line on success.
- **Live re-query, not a snapshot** (D15): counts refresh as new data lands. A frozen-snapshot
  mode (encode/store the data) is deferred — noted as a possible later pass.
- **Test:** +1 e2e (`save/share … serializes to the URL and reopening reproduces it`) — 8 total.
  Caught a real bug: empty `wa-input.value` is `null`, not `''`, so `.trim()` threw and skipped
  the post-change re-run; guarded with `(value || '')`.

---

## 8.5 `overflow` signal — citywide reporting break (2026-06-05) ✅ ROOT CAUSE FOUND

**Root cause — confirmed by SF 311 data supervisor Bryan Wong** (2026-06-05):

> "Those numbers are actually because of a contract DPW had with Nordsense (their sensor vendor).
> After 11/2025, their contract ended and they stopped submitting service requests automatically
> from the sensors."

DPW's vendor **Nordsense** ran **in-can sensors that auto-submitted overflow service requests** to
311. When the contract ended (after Nov 2025) the sensors stopped filing, so the automated share of
`city_garbage_can_overflowing` vanished — leaving only **human-filed** overflow reports (~1,600/mo
floor). So the ~5,000/mo that disappeared was **machine-generated, not resident-reported**. This
matches every observation below: the tapered Oct→Dec ramp (sensors decommissioned in waves), the
parent category absorbing the whole decline, and no migration to another field/service_name.

**Implication for the tool:** the `overflow` signal is **two populations spliced together** —
sensor telemetry (through Oct 2025) + human complaints (throughout). Pre-Nov-2025 counts are
**not comparable** to post-Dec-2025 counts, and the historical series massively over-represents
locations that happened to have Nordsense cans. Any before/after straddling the break is invalid.

**Symptom (reported by a colleague):** "overflowing trash cans" returns consistent data for years,
then **dries up in the last few months** — near-zero results at a pin.

**Investigation (live Socrata, citywide, dataset `vw6y-z8j6`):** the query filter is *correct* —
`service_details='city_garbage_can_overflowing'` still exists and is still matched by
`LIKE '%overflow%'`. The **reports themselves collapsed citywide**:

| Period | Overflow reports / mo |
|---|---|
| Jul–Oct 2025 | ~6,400–6,800 (steady, as for years) |
| **Nov 2025** | **3,547** ⬇ |
| **Dec 2025** | **1,648** ⬇⬇ |
| Jan–May 2026 | ~1,400–1,900 (new floor) |

A ~75% drop over a 6-week **tapered ramp** (full → half → quarter → floor). At 250 m around one pin,
~¼ of old volume rounds to **zero** — the reported symptom.

**Reproducible evidence (live SoDA, citywide count — verified 2026-06-05):**
- Nov 2025 → `3540`:
  `https://data.sfgov.org/resource/vw6y-z8j6.json?$select=count(*) as n&$where=service_name='Street and Sidewalk Cleaning' AND lower(service_details) like '%overflow%' AND requested_datetime >= '2025-11-01' AND requested_datetime < '2025-12-01'`
- May 2026 → `1865`:
  `https://data.sfgov.org/resource/vw6y-z8j6.json?$select=count(*) as n&$where=service_name='Street and Sidewalk Cleaning' AND lower(service_details) like '%overflow%' AND requested_datetime >= '2026-05-01' AND requested_datetime < '2026-06-01'`

Drop `$select=count(*) as n` for the rows; add `AND within_circle(point, <lat>, <lng>, 250)` to match a pin.

**Why it's structural, not a real-world win (three confirmations):**
1. **Parent absorbed the whole decline.** "Street and Sidewalk Cleaning" overall fell ~4,800/mo
   Oct→Dec 2025; overflow fell ~4,800/mo over the same span. Every *other* detail (loose garbage,
   human waste, furniture, bagged garbage) stayed flat → overflow reports **left 311 entirely**,
   they were not re-labeled into another detail (that would have kept the parent flat).
2. **No field/service_name migration.** Adding `OR lower(service_subtype) LIKE '%overflow%'` across
   the *whole* dataset reproduces the same collapsing curve. "Litter Receptacle Maintenance"
   (a separate service_name that stores overflow in `service_subtype`) has existed since mid-2024,
   is flat at ~800/mo, and did **not** jump to absorb the missing ~5,000/mo.
3. **Rollout shape, not behavior.** A tapered Oct→Dec ramp to a stable floor is the signature of a
   phased operational/reporting change (likely sensor/smart-bin servicing or a routing change that
   stopped minting 311 requests for overflow), not organic behavior — which never moves 75% in 6 weeks.

**Class of problem:** same family as the 2024-06-13 taxonomy migration (D10, §12.5) but a **volume
break**, not a wording break — so `lower(...) LIKE` normalization can't repair it. The **smart-default
window (§8.3) won't catch it** either: that detects spike *onsets*, not drop-offs.

**Risk to the tool:** any `overflow` report with an intervention date in late-2025/2026 shows
**"after ≈ 0"** and reads as a *success* when it's really the citywide reporting floor — a false positive.

**Responses:**
- ✅ **A+B built (2026-06-05) — data-driven `breaks` mechanism.** A data point can declare
  `breaks: [{date,label,detail}]` (registry, generalizes per D9). The `overflow` entry carries the
  Nordsense break (`2025-11-01`). Surfaced **only when the analysis window straddles the date** (the
  chosen trigger): a gray dotted **chart marker** (`label`) and a **verdict-slot ⚠ warning**
  (`detail`). `chart.js` reuses one `bucketIndexFor()` helper for both the intervention and break
  markers; `app.js` warns when `curStart < break.date < curEnd`. +1 e2e (straddle shows marker+warn;
  post-break window shows neither). *The manual `breaks` registry is response B's annotation half;
  auto step-change detection (no annotation needed) remains a Stage 3 item, §10.*
- ~~**C.** Root-cause~~ ✅ **Done** — Nordsense contract ended; in-can sensors stopped auto-filing
  overflow reports (see header). The residual ~1,600/mo is genuine human-reported overflow.

---

## 8.6 Cardboard signal — investigation (2026-06-05) ✅ CLOSED — DON'T BUILD

**Ask:** teammates are exploring **unrecycled cardboard**, acute in **Chinatown** — merchants leave it
out because the "mosquito fleet" of independent recyclers no longer finds it profitable to collect, so
it stays on the sidewalk. Can we query *only* this?

**Finding: 311 (`vw6y-z8j6`) cannot isolate cardboard structurally.**
- **No cardboard category.** `service_details`/`service_subtype` have no cardboard value (only 2 junk
  Parking-Enforcement matches citywide). Cardboard files as generic **`other_loose_garbage_debris_yard_waste`**
  or **`other_bagged_boxed_contained_garbage`** — the two buckets that dominate Chinatown — mixed in
  with all other loose/boxed garbage.
- **Only `status_notes` names cardboard.** That's the DPW crew's *resolution* note (free text). It's a
  real signal and confirms the merchant story — sample Chinatown notes: *"Reallocate to cardboard truck"*
  (recurring), *"Cardboard belongs to store not city responsibility"*, *"stores leaves out their toters
  and cardboards out allday"*, *"Cardboard-Recology"*. But as a metric it's unusable for the tool:
  - resolution-side, not complaint-side (written after response, by the crew);
  - **low recall / crew-dependent** → severe undercount; most cardboard cases get no note;
  - **tiny:** ~10/mo citywide mention "cardboard"; only **~13 cases ever** say "cardboard truck"
    (**8 of 13 in Chinatown** — a clean operational fingerprint, but far too sparse for a before/after).

**Best available query (qualitative discovery, NOT a quantitative trend):**
`service_name='Street and Sidewalk Cleaning' AND lower(status_notes) LIKE '%cardboard%'`
— a magnifying glass for real merchant-cardboard cases at neighborhood scale; rounds to zero at a pin.

**Implication:** adding it as a standard data point would repeat the overflow trap (near-zero "after"
reads as a false success).

**Decision (2026-06-05):** **look outside 311 for a cardboard-specific source first; if no clean signal
exists, build nothing** (don't ship a misleading proxy). Considered-but-rejected for now: a caveated
status_notes data point, and a relabeled generic "sidewalk garbage" proxy.

**External-source search — done (2026-06-05): no cardboard/commercial-recycling dataset on SF OpenData.**
- **Discovery method that worked:** SF's own catalog endpoint
  `https://data.sfgov.org/api/catalog/v1?domains=data.sfgov.org&search_context=data.sfgov.org&q=…`
  (the federated `api.us.socrata.com` endpoint returned 0 even for a `police` sanity check — wrong host;
  and the bare SF endpoint without `domains`/`search_context` federates across NYC/Austin/Cambridge, so
  filter to SF). Recorded for reuse.
- **SF-scoped results:** `cardboard` → 0, `recycling` → 0, `zero waste` → 0, `tonnage` → 0,
  `compost` → 0, `Recology` → 1 (just "Trash Can Locations"). Only waste-adjacent SF datasets are asset/
  schedule data (Trash Can Locations `5buk-jp7b`, street-sweeping routes) and DPW street-**cleanliness
  audits** (`Street & Sidewalk Maintenance Standards Results`) — none isolate cardboard, and audits are
  graded route inspections, not pin/date resident events.
- **Why:** Recology is a private contractor; its commercial-collection / diversion data isn't on the
  open portal (lives with SF Environment). No public cardboard-specific source exists.

**✅ DECISION EXECUTED: do not build a cardboard data point.** No clean signal in 311 *or* any external
SF OpenData source. Report back to the team: 311 can't isolate cardboard; the qualitative
`status_notes LIKE '%cardboard%'` query (above) is the only way to *read* real cases (and it confirms
the merchant-cardboard / "cardboard truck" story), but there's no dataset to support a quantitative
before/after. Revisit only if SF Environment / Recology publishes collection data.

---

## 8.2 `homeless_presence` signal quality — conclusions (2026-06-02)

**Resolved:**

- **TRESPASSER dropped from the aggregate.** SFPD CFS `TRESPASSER` is *not* a reliable homelessness
  proxy. Citywide (community-reported, since 2024) of **47,670** trespasser calls only **~7% are
  HSOC-routed** (Healthy Streets) and **~1% carry homeless keywords** in dispatcher notes (notes are
  sparse, so 1% is a floor). At Koshland the "sure homeless" subset (HSOC-only) was just **14** vs
  **130** total trespasser — the homeless-specific slice is insignificant, while keeping all trespasser
  would inject mostly non-homeless calls (business intrusion, disputes, ex-partners). So it's excluded.
  - **Reusable lesson:** raw `TRESPASSER` ≠ homelessness. If a future signal needs it, gate on
    `onview_flag='HSOC'` or homeless notes — but expect a small, sparse yield. By contrast `SIT/LIE
    ENFORCEMENT`, `BLOCKED SIDEWALK`, `HOMELESS COMPLAINT`, and 311 `Encampment` are inherently
    homelessness-related and need no extra gating.
- **Duplicate handling applied.** `cad_number` is already unique, so dedup-by-id alone was a no-op;
  added `AND dup_cad_number IS NULL` to the 911 source to drop SF's flagged duplicate calls (~1–1.3%).
  311 `service_request_id` is unique. Description now accurately says "each record counted once."

**Aggregate now = 911 (Sit/Lie + Blocked Sidewalk + Homeless Complaint, community-reported, non-dup)
+ 311 Encampment.** Koshland all-time total: **658** (176 + 482).

**Done 2026-06-02:** **Query footnote** — a "How this is measured" section at the page bottom lists,
per data point, the plain-language filtering (`filterDesc`) + the technical filter + the exact live
Socrata query link(s) for the current pin/radius. The dropdown description (and the chart note) link
down to it. Every data-point source now carries a `filterDesc`. §8.2 fully closed.

---

## 9. Stage 2 — AI verdict endpoint (not started)

- Minimal serverless function (Cloudflare Worker / Vercel) holding the API key.
- Input: computed stats + a sample of events (+ the data point's description/caveats).
- Output: a **binary true/false** with plain-language reasoning that weighs direction, baseline
  history, window length, and the reporting-bias / displacement caveats.
- Drops into the existing verdict slot.
- *Possible emphasis from DPW notes:* priority weighting (needle/oil/blood), de-duplication.

## 10. Stage 3 — more data points + rigor (ongoing)

The registry mechanism (D9) is **built**; 8 data points across 3 themes are live. Remaining:

- **More vetted data points** as needed (one at a time): candidates incl. SFPD Drug-Offense
  incidents (`wg3w-h783`), OD-fatality signature (SFFD ME `nuek-vuh3`), street/sidewalk defects.
- **Control baseline (difference-in-differences)** — compare the pin's before/after change vs the
  surrounding neighborhood / citywide trend over the same window, to neutralize secular trends.
- **Polygon / freehand area** (deferred from Stage 1.1, decided 2026-06-02) — let users draw a
  custom shape with Leaflet-Geoman and query Socrata `within_polygon(...)`, instead of only a circle.
- **Control baseline (difference-in-differences)** — compare the pin's before/after vs the
  surrounding neighborhood / citywide trend over the same window (still TODO; the slider window
  already serves as the analysis window per D12).
- ~~Smart default date window~~ **✅ Done 2026-06-02 — see §8.3** (D14).
- **Possible polish:** marker clustering when a window returns many dots (e.g. dumping ~1.2k).

- **🔍 Investigate: surface data-provenance / reporting breaks in the tool** (from §8.5, 2026-06-05).
  The `overflow` Nordsense break (sensor feed decommissioned after 11/2025, confirmed by 311 data
  supervisor Bryan Wong — see §8.5) showed a signal can collapse for reasons unrelated to the ground
  truth, and the tool currently gives no hint. Scope to explore:
  - **(a) Per-data-point provenance tag** — mark each signal as *resident-reported*, *sensor/automated*,
    or *mixed* (overflow = mixed), shown in the dropdown/footnote so users know what they're trusting.
    *(Not yet built; the `breaks` mechanism (b) covers the acute case for now.)*
  - ~~**(b) Known-break annotations**~~ ✅ **Built 2026-06-05** — registry `breaks: [{date,label,detail}]`;
    chart marker + verdict warning when the window straddles a break (§8.5). `overflow` carries the
    Nordsense break. Extend by adding entries to other data points as breaks are discovered.
  - **(c) Auto-detect step-changes** (§8.5 response B, *unannotated* case) — flag a window that crosses a
    citywide drop/spike even when no `breaks` entry exists; pairs with (b) as the manual override.
  - **Open design question:** annotate-and-warn (keep the data, caveat it) vs. truncate the series at
    the break (hide pre-break sensor data) — likely annotate, to stay honest and observational (§12).

---

## 11. (reserved)

## 12. Methodology caveats (carry into every stage)

1. **Reporting bias** — the intervention can change the *observation rate*, not just behavior
   (brighter lights → more visible/reported). More reports ≠ more activity.
2. **Citywide secular trends** — a local "drop" may track a citywide tide (e.g. ~4× citywide
   decline in needle reports). Addressed by the Stage 3 control baseline.
3. **Small N / short windows** — single-pin, weeks-of-post-data can't support causal inference.
   Stage 1 flags it; the AI verdict should weigh it.
4. **Balloon / displacement effect** — encampment removal scatters people into other call types
   and nearby blocks; encampment reports alone undercount unhoused presence. (DPW notes, §2.)
5. **311 taxonomy migration (2024-06-13)** — label casing/wording changed; filters must match
   both eras (D10) or the series shows a fake cliff.
6. **Program-growth artifacts** — HSOC routing rose as Healthy Streets scaled; increases can be
   program expansion, not rising need.
7. **Reporting volume breaks** — a signal can collapse (or surge) citywide due to an
   operational/reporting change, independent of conditions on the ground. Confirmed for `overflow`:
   the **Nordsense in-can sensor contract ended (Oct–Dec 2025)**, cutting ~75% of reports — the lost
   share was *machine-generated*, leaving only human complaints (§8.5). A recent "after" window thus
   reads as a false success. Unlike the wording migration (#5), `LIKE` normalization can't fix a
   volume break. **General lesson:** a signal may be an automated/sensor feed, not resident reports —
   vet whether a data point is human- or machine-generated before trusting its trend.

Framing everywhere: **observational, not causal.**

---

## 13. Open questions

- **AI provider/runtime for Stage 2** — Cloudflare Worker vs Vercel vs other.
- **Radius default & range** — adjustable radius slider planned (Stage 1.1); default 250 m, range ~100–1000 m (confirm bounds).
- ~~Collapse homelessness options?~~ **Resolved 2026-06-02:** merged into one multi-source
  `homeless_presence` aggregate; HSOC dropped; within-source dedup (D13).
- **Next data point(s)** to vet after the current 8.
- **Resident-facing direction?** — whether to pursue the BI-assistance "show residents the data"
  audience (§2), and if so what a resident view looks like.

**Settled:** hosting via **GitHub Pages** at `/hypothesis-tool/` — added to the existing
`.github/workflows/static.yml` deploy (fully static: CDN libs, no build step). resultsfor.sf.gov
integration **out of scope** (design-style reuse only). No Tailwind / CSS framework (D8).

---

## 14. Changelog

- **2026-06-05** — **Investigated a cardboard data point** (§8.6) for the Chinatown merchant-cardboard
  problem. Found 311 can't isolate cardboard: no structured category (bucketed into generic loose/boxed
  garbage); only `status_notes` names it (~10/mo citywide, "cardboard truck" ~13 ever, 8 in Chinatown)
  — resolution-side, low-recall, too sparse for a before/after. **Decision:** look for an external
  cardboard/recycling source first; build nothing if there's no clean signal. **Closed: searched SF
  OpenData (working method recorded in §8.6) — no cardboard/recycling/Recology dataset exists, so per
  the decision we built nothing.** The qualitative `status_notes LIKE '%cardboard%'` query stands as a
  case-reading tool for the team; no quantitative data point.
- **2026-06-05** — **Surfaced the `overflow` reporting break in the tool** (§8.5 responses A+B). Added
  a data-driven `breaks: [{date,label,detail}]` field to the registry (generalizes per D9); the
  `overflow` entry declares the Nordsense break. When the analysis window straddles the date, the chart
  shows a gray dotted marker and the verdict slot shows a ⚠ warning explaining the sensor decommission;
  silent otherwise (chosen trigger). Refactored `chart.js` to a shared `bucketIndexFor()` for both
  intervention + break markers. +1 e2e (9 total) covering straddle vs post-break windows.
- **2026-06-05** — **Investigated `overflow` dry-up** (§8.5, §12.7): colleague reported overflowing-can
  results vanishing in recent months. Confirmed via live Socrata it's a **citywide reporting break**,
  not a query bug or a real win — overflow reports collapsed ~75% over Nov–Dec 2025 (tapered ramp to a
  ~1,600/mo floor), the parent "Street and Sidewalk Cleaning" category absorbed the entire decline, and
  no field/service_name migration explains it. Risk: recent "after" windows read as false successes.
  **Root cause confirmed by SF 311 data supervisor Bryan Wong** (quoted in §8.5): DPW's **Nordsense
  sensor contract ended after 11/2025**, so the in-can sensors stopped auto-filing overflow requests;
  the ~5,000/mo that vanished was machine-generated, leaving a ~1,600/mo human-reported floor.
  Responses A (caveat) + B (step-change detection) still TODO.
  Added a Stage 3 investigative action item (§10) to **surface data-provenance & reporting breaks in
  the tool** — provenance tags, known-break annotations, and auto step-change detection.
- **2026-06-03** — **Save & share reports via URL** (§8.4, D15): report state (`dp, date, lat,
  lng, r, from, to, what`) serialized to plain query params; address bar live-syncs via
  `replaceState`; "Copy shareable link" button; opening a link restores inputs + saved window
  and auto-runs (live re-query, no backend). The free-text intervention description is captured
  too. +1 e2e (8 total) — found a real bug (empty `wa-input.value` is `null` → `.trim()` threw).
- **2026-06-02** — Wired the tool into the **GitHub Pages** deploy (`.github/workflows/static.yml`
  stages it to `/hypothesis-tool/`; fully static, no build). Verified staging + relative paths.
- **2026-06-02** — **Smart default date window** (§8.3, D14): slider default start = detected
  elevated-regime onset (3-mo smoothed), overrideable, with sparse fallback. Koshland drug now defaults
  to Oct 2025→now (▲27%, spike continuing) instead of diluting against 2023. +1 e2e test (7 total).
- **2026-06-02** — **Stage 1.1 shipped** (§8.1): slider-driven verdict + stat cards (D12), adjustable
  radius slider, gate + scroll-to-results, OS-respecting dark mode (CARTO dark tiles). Added a committed
  **Playwright e2e suite** (`tests/e2e.spec.js`, `npm test`, 6 passing) — which caught a real gate
  bug (`[hidden]` overridden by `.wa-stack`, now fixed).
- **2026-06-02** — Backlog added (§10): **smart default date window** — auto-detect the spike/regime
  onset so the before/after compares the elevated regime, not a diluted full-range baseline (current
  default can make an ongoing spike look resolved).
- **2026-06-02** — Built the **"How this is measured" methodology section** (query footnote): per-source
  plain-language filtering + technical filter + exact live Socrata query links; the data-point description
  and chart note link down to it. Added `filterDesc` to every data-point source. Closes §8.2.
- **2026-06-02** — `homeless_presence` refined: **dropped TRESPASSER** (only ~7% HSOC-routed / ~1%
  homeless-noted citywide; HSOC-only subset just 14 of 130 at Koshland — insignificant) and **applied
  duplicate handling** (`dup_cad_number IS NULL`) on the 911 source. Conclusions + reusable trespasser
  lesson in §8.2. Aggregate now Sit/Lie + Blocked Sidewalk + Homeless Complaint + Encampment (Koshland 658).
- **2026-06-02** — Investigated `homeless_presence` quality (paused, §8.2): trespasser is only ~7%
  HSOC / ~1% homeless-noted (loose proxy); `cad_number` already unique so dedup-by-id is a no-op while
  ~1.3% `dup_cad_number` duplicates slip through. Simplified the data-point description (removed
  balloon-effect text + dedup overclaim). Remaining work + query-footnote request tracked in §8.2.
- **2026-06-02** — Collapsed the 4 homelessness options into one multi-source `homeless_presence`
  aggregate (encampment + Trespasser/Sit-Lie/Blocked/Homeless-Complaint); **dropped HSOC**; added
  multi-source data-point support with within-source dedup by record id (D13). Dropdown now 5 options.
- **2026-06-02** — Planned Stage 1.1 (UX & theming): gate + scroll results, OS-respecting dark
  mode, adjustable-radius slider (polygon draw deferred to Stage 3), slider-driven verdict +
  summary boxes (D12). Discussing whether to collapse the 4 homelessness options into one aggregate.
- **2026-06-02** — Added 4 homelessness data points (encampment, street-homelessness/displacement
  aggregate, HSOC, homeless complaint). Added stale-run guard (D11). Recorded DPW notes + BI
  initiative as context (§2). Brought whole plan current.
- **2026-06-02** — Added 3 litter data points (overflowing cans, illegal dumping, health-hazard);
  generalized to a data-point **registry** (D9) with a dropdown picker + per-option descriptions;
  normalized the 311 taxonomy migration (D10).
- **2026-06-01** — Added date-range slider (day/week/month granularity) driving chart + map;
  moved default pin onto Page & Buchanan.
- **2026-06-01** — Stage 1 built & verified (drug-activity data point): inputs, live Socrata,
  SVG chart, Leaflet map, lightweight verdict.
- **2026-06-01** — Plan drafted and agreed.
