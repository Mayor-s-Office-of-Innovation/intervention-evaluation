# Plan — inline editing of interventions on the homepage

## Context

The homepage intervention list is read-only: to change any field you click through to the
full hypothesis tool (`?edit=ID`). We want to edit a saved intervention **without leaving the
list**. This was the deferred ask #3 from the earlier form-UX work.

Decisions locked with the user:
- **Expand-in-place editor**: clicking Edit expands a full-width editor panel beneath the row.
- **Edit all fields except location** (pin/radius stays in the full tool — it needs the map).
- The always-visible Close button goes away; a **reversible Archive** action (labeled
  "Archive") lives inside edit mode instead. Archiving is the existing `closeIntervention`
  (status → `closed_completed`, recoverable). Nothing is permanently deleted.
- **Easy exit** from edit mode (Cancel button + Esc + toggling Edit off).

## Behavior / UX

- **Default row**: data + a single **Edit** affordance in the actions cell. No Close/Reopen
  buttons in the default view. Curated rows without an `id` stay non-editable (keep their
  "Evaluate" link). Whole-row click still opens the read-only view (`?view=ID`).
- **Click Edit** → set `editingId` and re-render; an editor `<tr>` is injected right after the
  row (`<td colspan=N>`), fields pre-filled. Only one row edits at a time. The editing row's
  click-to-view is suppressed; its Edit control reads "Editing" / toggles off.
- **Editor footer**: **Save changes** (accent) · **Cancel** · **Archive** (reversible; confirm).
  For an already-archived record (shown via "View closed") the destructive button is **Restore**
  (`reopenIntervention`) instead of Archive. Esc cancels.
- **Location**: not inline. Show current pin coords + radius read-only, with a link
  "Adjust location in the full editor →" (`?edit=ID`).

## Fields editable inline (all except location)

title · status · owner · agencies · levers (multiselect) · start date · end date ·
description · evidence · tactics · roadblock · outcomes · notes · related links · "Edited by"
(→ `edited_by`; optional). `person_submitted` stays as the original submitter.

**District is intentionally NOT editable inline** — the list is already filtered by district, and
the Worker's PATCH doesn't support district changes. Keeping it out avoids any backend change.
Moving an intervention between districts stays a full-tool operation (and even there is currently
a no-op server-side).

## Implementation

### Homepage — [js/app.js](js/app.js)
- **Imports**: add `updateIntervention` to the existing `interventions-client.js` import; add
  `import { LEVERS } from '../hypothesis/js/datapoints.js'` (that module is standalone/no imports;
  `LEVERS` gives `{key,label}` and the keys round-trip with stored `levers`).
- **State**: `let editingId = null;`
- **`renderActions(i)`** ([js/app.js:326](js/app.js#L326)): for records with `id`, render one
  **Edit** button (`.action-edit` `data-id`). Drop the always-on Close/Reopen here.
- **`renderInterventionRow(i, cols)`** ([js/app.js:346](js/app.js#L346)): when `i.id === editingId`,
  append `<tr class="intervention-edit-row"><td colspan="${cols.length}">${renderEditor(i)}</td></tr>`
  and omit `is-clickable`/`data-href` on that row.
- **New `renderEditor(i)`**: builds a responsive field grid (reuse the `wa-grid` /
  `--min-column-size` pattern), the read-only location block + full-tool link, and the footer
  actions (Save/Cancel/Archive|Restore). Reuse `esc`, `STATUS_LABELS`, and `LEVERS`. Scope all
  field lookups to the editor container (query within, not global ids) so re-renders are clean.
- **`wireEvents(container)`** ([js/app.js:453](js/app.js#L453)):
  - `.action-edit` → `editingId = id; render(container)`, then scroll the editor into view.
  - Editor **Save** → gather fields into a `data` object mirroring the hypothesis form's payload
    (`hypothesis/js/app.js` `handleSubmit`) **minus lat/lng/radius**, plus `edited_by`; `await
    updateIntervention(id, data)`; replace the item in `savedInterventions`; `editingId = null`;
    `render`. Reuse the exact cache-update-then-render pattern already in the close/reopen handlers
    ([js/app.js:474-507](js/app.js#L474)).
  - **Cancel** / **Esc** → `editingId = null; render`.
  - **Archive** → `closeIntervention` (existing); **Restore** → `reopenIntervention` (existing).
  - Row-click handler: ignore when the row is in edit mode.
- **Links parsing**: add a tiny local `parseLinks` (one URL per line, add https\://, cap) mirroring
  the one in `hypothesis/js/app.js`.

### Styles — [styles.css](styles.css)
- `.intervention-edit-row td` — full-width panel (padding, subtle inset background, no hover tint).
- `.intervention-editor` — CSS grid of fields (reuse `--min-column-size` like the form); textareas
  span full width. Footer action bar (right-aligned). Add `.action-edit` plus editor
  Save/Cancel/Archive button styling (reuse existing `.action-link` / `.action-btn` tokens).

### Worker — no change
No backend change needed. District (like location) is deliberately not editable inline, so the
existing deployed Worker handles everything. `update()` remains a partial merge that preserves
untouched fields (including the stored pin/radius).

## Reuse
- `updateIntervention` / `closeIntervention` / `reopenIntervention` — [js/interventions-client.js](js/interventions-client.js).
- Close/reopen handler pattern (optimistic cache update → `render`) — [js/app.js:474-507](js/app.js#L474).
- `LEVERS` — [hypothesis/js/datapoints.js](hypothesis/js/datapoints.js).
- Payload shape — `handleSubmit` `data` in [hypothesis/js/app.js](hypothesis/js/app.js).
- PATCH is a partial merge, so omitting location preserves the stored pin/radius.

## Out of scope
- Location/pin/radius editing inline (stays in the full tool).
- Permanent delete (we chose reversible archive).

## Verify
Note: the client defaults to the **prod** Worker even in dev, so edits hit real KV. Test against a
throwaway record (e.g. the "testing" one) and revert, or set
`localStorage.interventionsApi='http://localhost:8787'` with `wrangler dev`.
- `node --check js/app.js`.
- `npm run dev` (http-server :8090) → open `/`:
  1. Row shows only **Edit**. Click Edit → editor expands beneath the row, fields populated.
  2. Change owner/status/levers/notes → **Save** → row collapses, new values shown, persist on reload.
  3. **Cancel** and **Esc** exit without saving; clicking another row's Edit moves the editor.
  4. **Archive** → row leaves the open list; under "View closed", editing it shows **Restore** → restores.
  5. Location block is read-only with a working link to `?edit=ID`.
  6. Edit + Save a record that has a pin → confirm lat/lng/radius survive (PATCH merge).
- After `wrangler deploy`: changing district moves the row to the new district's list.
