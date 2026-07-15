// ──────────────────────────────────────────────────────────────────────
// Hotspots view UI helpers, shared by the Drugs + Unsheltered dashboards so the
// wiring lives in ONE place (the two app.js files only call in). Covers:
//   • the Combined | Day-vs-night split-view toggle (Change #2)
// The docked detail panel + panel-scoped hour slider (Changes #3/#1) are added here too.
// See plan-hotspots-enhancements.md.
// ──────────────────────────────────────────────────────────────────────
import { setSplitView, getSplitView, searchIntersections, ensureCityIntersections, focusCellById, showSearchResult, clearSearchResult } from './transition-map.js';

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
 * Wire the cross-street search box (Change: hybrid local + Nominatim). Renders an input + button +
 * status line into the container, and routes each search to the most specific honest result:
 * tracked hotspot → select it; reported corner → locate + "not a tracked hotspot"; anywhere else in
 * SF → Nominatim locate + "no tracked activity"; otherwise a clear status. Escape clears everything.
 */
export function wireSearch({ containerSel = '#map-search' } = {}) {
  const container = document.querySelector(containerSel);
  if (!container) return;
  container.innerHTML =
    `<div class="map-search-wrap">` +
    `<input type="text" class="map-search-input" id="map-search-input" ` +
    `placeholder="Find cross streets (e.g. 16th & Mission)" aria-label="Find cross streets">` +
    `<button class="map-search-btn" id="map-search-btn" aria-label="Search">` +
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">` +
    `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg></button>` +
    `<span class="map-search-status" id="map-search-status" role="status" aria-live="polite"></span>` +
    `</div>`;

  const input = container.querySelector('#map-search-input');
  const btn = container.querySelector('#map-search-btn');
  const statusEl = container.querySelector('#map-search-status');
  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-error', !!isError);
  };

  async function doSearch() {
    const query = input.value.trim();
    if (!query) return;
    setStatus('Searching…');
    let r;
    try { r = await searchIntersections(query); }
    catch { setStatus('Search failed', true); return; }

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
  }

  // Deferred cost: the ~113 KB authoritative corner index is fetched only once the user actually
  // engages the box (focus), so it's warm by the time they hit Enter — with zero page-load impact.
  // Fire-and-forget; a failure here is retried (and surfaced) by the search itself.
  input.addEventListener('focus', () => { ensureCityIntersections().catch(() => {}); }, { once: true });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    else if (e.key === 'Escape') { input.value = ''; clearSearchResult(); setStatus(''); }
  });
  btn.addEventListener('click', doSearch);
}
