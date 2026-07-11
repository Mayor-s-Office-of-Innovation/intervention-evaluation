// ──────────────────────────────────────────────────────────────────────
// Hotspots view UI helpers, shared by the Drugs + Unsheltered dashboards so the
// wiring lives in ONE place (the two app.js files only call in). Covers:
//   • the Combined | Day-vs-night split-view toggle (Change #2)
// The docked detail panel + panel-scoped hour slider (Changes #3/#1) are added here too.
// See plan-hotspots-enhancements.md.
// ──────────────────────────────────────────────────────────────────────
import { setSplitView, getSplitView } from './transition-map.js';

let _refresh = null;                 // re-renders the toggle buttons from current split state
let _legendSel = '#split-legend';

/**
 * Wire the Combined | Day-vs-night toggle. Clicking flips the shared split-view state and shows/hides
 * the split legend, then calls `onChange(isSplit)` so the app can keep the page Day/Night FILTER
 * coherent (split view is a lens on the full day/night mix → the app resets the filter to both) and
 * re-render the map. The app must render on onChange; this helper never renders the map itself.
 * @param {object} [opts]
 * @param {(isSplit:boolean)=>void} [opts.onChange]
 */
export function wireSplitToggle({ toggleSel = '#map-view-toggle', legendSel = '#split-legend', onChange } = {}) {
  const container = document.querySelector(toggleSel);
  if (!container) return;
  _legendSel = legendSel;

  _refresh = () => {
    const split = getSplitView();
    container.innerHTML =
      `<button class="seg ${split ? '' : 'is-active'}" data-v="combined" aria-pressed="${!split}">Combined</button>` +
      `<button class="seg ${split ? 'is-active' : ''}" data-v="split" aria-pressed="${split}">Day vs night</button>`;
    container.querySelectorAll('.seg').forEach(btn => {
      btn.onclick = () => {
        const isSplit = btn.dataset.v === 'split';
        setSplitView(isSplit);
        _refresh();
        const legend = document.querySelector(_legendSel);
        if (legend) legend.hidden = !isSplit;
        if (onChange) onChange(isSplit);
      };
    });
  };

  _refresh();
}

/** Re-sync the toggle buttons + legend to the current split state — call after the app changes it
 *  programmatically (e.g. forcing Combined when the page filter excludes a day/night bucket). */
export function refreshSplitToggle() {
  if (_refresh) _refresh();
  const legend = document.querySelector(_legendSel);
  if (legend) legend.hidden = !getSplitView();
}
