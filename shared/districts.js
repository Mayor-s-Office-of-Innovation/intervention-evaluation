// ──────────────────────────────────────────────────────────────────────
// Single source of truth for SF police districts across the whole site.
// The homepage picker and every dashboard's hash router import from here so
// the list can't drift. `validate_build.py` asserts this list matches each
// dashboard's baked `aggregates.json.districts`.
// ──────────────────────────────────────────────────────────────────────

// Canonical, ordered 10 SFPD districts. First four preserve the original
// homepage order; the six added in the all-districts expansion follow.
export const DISTRICTS = [
  'Northern', 'Central', 'Mission', 'Tenderloin', 'Southern',
  'Bayview', 'Park', 'Richmond', 'Ingleside', 'Taraval',
];

// Citywide is a scope, not a district: the true all-SF aggregate (not a sum
// of the 10). Every dashboard treats it as a first-class, selectable focus.
export const CITYWIDE = 'Citywide';

// Homepage picker order: the Citywide scope first, then the 10 districts.
export const PICKER = [CITYWIDE, ...DISTRICTS];

export const isCitywide = name => name === CITYWIDE;

// #northern → 'Northern', #citywide → 'Citywide', unknown/empty → null.
// Returning null (not a default) lets each caller keep its own default via
// `fromHash(location.hash) || 'Northern'` while #citywide resolves cleanly.
export function fromHash(hash) {
  const h = (hash || '').replace(/^#/, '').toLowerCase();
  if (h === CITYWIDE.toLowerCase()) return CITYWIDE;
  return DISTRICTS.find(d => d.toLowerCase() === h) || null;
}

export const toHash = name => '#' + name.toLowerCase();
