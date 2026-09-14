# Plan — Citywide concentration: multi-signal toggle + label fix

**Owner:** Aaron · **Drafted:** 2026-09-14 · **Sibling of:** plan.md (§ "Citywide context", D9)
**Status:** 🟢 Built (2026-09-14) — all steps done, stops e2e + validators green, light/dark/phone verified.

## Build notes (as-shipped)
- **Months active (combined)** solved with a per-signal active-month **bitmask** baked in `citywide.json`
  (`stops.<id>.mask`), OR'd client-side in **BigInt** (44 bits > JS 32-bit bitwise; < 2^53 so JSON-exact).
  Union of active months, not sum/max. Encampment-only popcount == old `months_active` (41 for top stop).
- `citywide.json` schema: `signals[]`, per-stop `{name,supe,on_list,t12[],all[],mask[]}` for all 973 active
  sheltered stops. Dropped baked `top`/`months_active`; kept `concentration`+`signal:"encampment"`+
  `sheltered_with_zero`(=189, encampment) as no-JS fallback. ~256 KB.
- **Regenerated from committed data** (stops.json + series shards + concern.json), NOT a live Socrata pull —
  no `build/cache/` locally and I would not trigger an unplanned refresh. Curve/total/top-stop numbers tie
  out exactly to the previously-shipped file.
- `provenance.json` `encampment.short` patched directly to "311 encampment + unhoused" to match signals.py
  (pure label, no data), since provenance regen also needs the pull.
- Heading generalized "encampment reports" → "these reports"; curve label → "of selected reports";
  meta line signal-aware + 911 intersection caveat when a 911 signal is checked.

---

## Goal

Two changes to the **"Citywide context — where … reports concentrate"** section on the stops page:

1. **Multi-signal toggle.** Today the concentration curve (top 5/10/25/… = X% of reports) and the
   top-stops table are computed on the **encampment signal only**. Add checkboxes so the section can
   include any combination of the four card signals (encampment+unhoused, shelter-maintenance,
   911-presence, 911-drug). Toggling recomputes the top-line percentages **and** the table (rank,
   totals, "Since 2023", "Months active") live in the browser.

2. **Label fix (independent, ship regardless).** The map "Color dots by" checkbox reads
   **"311 encampment"**, but that signal is the union of encampment (tents/structures) + the
   unhoused-individual requests SF split out mid-2025. Change the `short` label so the grouping is
   explicit.

## Decision (locked)

**Bake per-signal totals for all active sheltered stops** so the whole section recomputes live for
any signal subset — no series-shard loading, static-data change only. (Chosen over a 12-mo-only
toggle that would grey out the two full-series columns.)

Key implication: re-ranking for *any* signal combo needs data for **all ~800 active sheltered
stops**, not just the current top 50 — a stop ranked low on encampment can be top-5 on 911-drug.

## Data model change — `citywide.json` (build/04_rollup.py)

Current: `signal: "encampment"`, one `concentration` curve, `top` = 50 stops with encampment
`{t12, all, months_active}`.

New: keep the encampment defaults for back-compat, add a per-signal, per-stop matrix over all
sheltered stops with any activity:

```
"signals": ["encampment","shelter_maint","cfs_presence","cfs_drug"],   // order = checkbox order
"stops": {                       // all sheltered stops with any activity in any signal
  "5667": { "name":"Market St&Castro St E-NS/SB", "supe":"8", "on_list":false,
            "t12":  [363, 4, 88, 12],       // per signal, index-aligned to "signals"
            "all":  [746, 9, 210, 30],
            "active":[41, 6, 33, 11] }       // nonzero-month count
  ...
}
```

Drop the now-redundant precomputed `concentration` + `top` (client derives both), OR keep
`concentration` as an encampment fallback for no-JS. Decide during build; leaning **drop** since the
section is JS-rendered anyway. Keep `window`, `sheltered_stops`, `sheltered_with_zero`, `total_t12`
(recompute `total_t12` client-side per combo).

Size check: ~800 stops × (name + 4 ints ×3) ≈ well under 100 KB. Acceptable as a baked file.

## Client changes — js/app.js `renderCitywide()`

1. **Checkbox row** above the curve, same pattern as `#colour-by` ([app.js:75-84](js/app.js#L75)):
   one checkbox per signal, colored swatch, `PROV.signals[k].short` label. Default = encampment only
   (preserves current headline). Persist selection in-memory for the session.
2. **Recompute on change:**
   - For the active signal set, each stop's contribution = **sum of its `t12` across checked
     signals** (same for `all` / `active` in the table).
   - Rank sheltered stops desc by summed `t12`; rebuild `concentration` curve at k∈{5,10,25,50,100,200}
     as running-share of the combo total; rebuild top-25 table rows.
   - `total_t12` for the meta line = sum over all stops of summed `t12`.
3. **Dynamic meta line** — reflect the active set instead of the hardcoded encampment string. When
   only encampment is on, keep today's wording (incl. the "not the other signals" clarifier from the
   text-cleanup pass). When >1 signal, list them and note the caveat that 911 signals are
   intersection-resolved (per cfs caveats) so their per-stop attribution is coarser than 311.
4. **Curve label** already says "of encampment reports" (text-cleanup pass) → make it
   signal-aware: "of selected reports" or list the signals.

### Attribution honesty (must surface in UI)

Combining 311 (point→nearest stop ≤25 m) with 911 (intersection centroid → *every* stop at the
intersection) mixes two attribution models. When any 911 signal is checked, the meta line must say
the 911 component is intersection-level (a stop shares its intersection's count), matching the
per-card labeling. See [[cfs-node-snapping-attribution]].

## Provenance

`renderMethodology` / provenance.json: note that the citywide section is now multi-signal and that
combined figures mix 311 point-attribution with 911 intersection-attribution. The runnable
per-signal queries already exist in provenance.json.

## Label fix (part 2)

build/signals.py: `encampment.short` "311 encampment" → **"311 encampment + unhoused"** (or
"311 encamp./unhoused"). Rebuild propagates to `provenance.json` → map checkbox + table headers +
citywide checkboxes all pick it up. Check column-header width on the top-stops table + concern table
(short is used there too, [app.js:363](js/app.js#L363)).

## Steps

1. Label fix in signals.py; rebuild (04_rollup / provenance regen); eyeball checkbox + headers.
2. Extend `citywide.json` schema in 04_rollup.py (per-signal matrix, all active sheltered stops).
3. `renderCitywide()`: checkbox row + live recompute of curve, table, meta.
4. Signal-aware meta + curve labels + 911 attribution caveat.
5. Methodology/provenance note.
6. Tests: extend stops/tests (validation trace ties baked per-signal totals to Socrata; e2e toggles
   a 911 signal and asserts the curve + table change). See [[e2e-data-trace-harness]].
7. Verify light/dark, phone width, `themechange` redraw path if the section draws colored swatches.

## Out of scope

- Changing which signals exist or their WHERE clauses.
- Per-signal separate curves side by side (single combined curve only).
- Ring/neighbour data in the citywide section.
