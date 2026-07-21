# Plan — Retire the separate-page `?edit=` experience & fix view-URL persistence

## Problem
Clicking an intervention from the homepage opens `hypothesis/?view=ID` (read-only,
correct). But copying that URL after it loads and reopening it shows the **editable
form** instead.

### Root cause
`syncURL()` rebuilds the query string from scratch and only re-adds `edit`, never
`view`. On a `?view=ID` load, `loadRecord(id,'view')` → `run(true)` → `syncURL()` →
`history.replaceState` rewrites the address bar to `?dp=…&lat=…&lng=…&r=…`, dropping
the `view` marker. Copying that rewritten URL and reloading hits `readParams()` truthy
→ the **shared-link branch** in `init()` → the full editable form renders.

## Goal
- Fix: a `?view=ID` URL stays read-only across load / copy / reload.
- Totally disable the separate-page editing experience (`?edit=ID`), per the long-
  standing intent to retire it now that the homepage has an inline editor.

## Changes (all in `hypothesis/js/app.js`)
1. **`init()`** — stop honoring `?edit=`. Route legacy `?edit=ID` links into read-only
   view: `viewId = urlParams.get('view') || urlParams.get('edit')`; do not populate
   `editId` from the URL.
2. **`syncURL()`** — persist the view marker instead of edit:
   `const pid = viewId || editId; if (pid) p.set('view', pid);`
   Fixes the copy-reload bug and makes a just-created record reload read-only.
3. **`handleSubmit()`** — remove the now-dead "Edit intervention" affordance
   (the branch that navigates to `?edit=ID`).

## Left intact
- Create-new flow (no param → editable form; `editId` still set after create so a
  second save in the same session updates rather than duplicates).
- Homepage inline expand-in-place editor.

## Follow-on fix — duplicate creates on submit
Reported: submitting a new intervention produced 2 duplicates (one looking incomplete).
Root cause: `btn.disabled` on a `<wa-button>` isn't a reliable re-entrancy guard, so a
fast double-click (or a click during the create round-trip, before `editId` is set)
fired two create POSTs; the server mints a fresh UUID per POST → two records. Secondary
risk: the dedup guard read `id` only from the top-level response, so a missing/moved
`id` would leave `editId` null and duplicate on every save.

Fixes (in `handleSubmit`):
- Module-level `submitting` flag; `if (submitting) return;` at the top, set true after
  validation passes, cleared in `finally`. The button state is now cosmetic only.
- Read the created id as `created?.id || created?.item?.id` so the edit/dedup state
  always engages after a successful create.

## Verify
- `hypothesis/?view=ID` → read-only; address bar keeps `?view=ID` after load; copy +
  reload stays read-only.
- Legacy `hypothesis/?edit=ID` → read-only (no editable form).
- Create a new intervention → still works, saves exactly one record, and a second save
  updates the same record. Double-clicking Submit creates only one record.
