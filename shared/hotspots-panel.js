// ──────────────────────────────────────────────────────────────────────
// Hotspots view UI helpers, shared by the Drugs + Unsheltered dashboards so the
// wiring lives in ONE place (the two app.js files only call in). Covers:
//   • the Combined | Day-vs-night split-view toggle (Change #2)
// The docked detail panel + panel-scoped hour slider (Changes #3/#1) are added here too.
// See docs/plan-hotspots-enhancements.md.
// ──────────────────────────────────────────────────────────────────────
import { setSplitView, getSplitView, searchIntersections, focusCellById, showSearchResult, clearSearchResult } from './transition-map.js';
import { wireSearch as wireSearchBox } from './cross-street-search.js';

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

/**
 * Wire the hotspots map's cross-street search box. Fully offline (baked SF corner index — NO external
 * geocoder). The generic box (shared/cross-street-search.js) owns the input/button/status UI, focus
 * prefetch, and Escape-to-clear; here we only supply the hotspot-aware behavior: each result routes to
 * the most specific honest outcome — tracked hotspot → select it; reported corner → locate + "not a
 * tracked hotspot"; any other real SF corner → locate + a nearby-aware "no tracked activity" note.
 */
export function wireSearch({ containerSel = '#map-search' } = {}) {
  wireSearchBox({
    containerSel,
    label: 'Find cross streets',
    placeholder: 'e.g. 16th & Mission',
    onClear: () => clearSearchResult(),
    onSearch: async (query, { setStatus }) => {
      const r = await searchIntersections(query);   // hotspot-cell-aware tiering lives in transition-map.js
      switch (r.status) {
        case 'need-two':
          setStatus('Enter two cross streets (e.g. 16th & Mission)', true); break;
        case 'local':
          if (r.isHotspot) {
            if (focusCellById(r.cellId)) setStatus('');                       // selected the hotspot
            else { showSearchResult(r.lat, r.lng, r.name); setStatus('Tracked hotspot (currently filtered out)'); }
          } else {
            showSearchResult(r.lat, r.lng, r.name);
            setStatus('Reported location · not a tracked hotspot');
          }
          break;
        case 'city':
          // A real SF corner located via the authoritative baked index. If tracked activity sits just
          // off it (block-level attribution — see NEARBY_M), soften the note instead of implying the
          // area is clean; otherwise say plainly there's nothing logged here.
          showSearchResult(r.lat, r.lng, r.name);
          setStatus(r.nearby ? 'None logged at this exact corner — see nearby markers'
                             : 'No tracked activity at this corner');
          break;
        case 'none':
          setStatus('No results in SF', true); break;
        default:
          setStatus('Search failed', true);
      }
    },
  });
}
