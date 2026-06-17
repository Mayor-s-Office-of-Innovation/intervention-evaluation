// ──────────────────────────────────────────────────────────────────────
// Rollup math — pure functions over the monthly series in aggregates.json.
// The build does the expensive once-only work (point-in-polygon); the cheap
// seasonal arithmetic (YoY, trailing-12mo trend, share) lives here so the
// data file stays small and flexible (see ../plan.md §7).
// ──────────────────────────────────────────────────────────────────────

export const monthIndex = (agg, ym) => agg.months.indexOf(ym);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Year-over-year: latest complete month vs the same month one year earlier. */
export function yoy(series, idx) {
  if (idx < 12) return null;
  const cur = series[idx], prior = series[idx - 12];
  if (prior === 0) return { cur, prior, pct: null };
  return { cur, prior, pct: (cur - prior) / prior };
}

/** Trailing-12-month average ending at idx (null if <12 months of history). */
export function trailing12(series, idx) {
  if (idx < 11) return null;
  let s = 0;
  for (let i = idx - 11; i <= idx; i++) s += series[i];
  return s / 12;
}

/** Direction of the trailing-12mo average vs a year before it (seasonality removed). */
export function trend12(series, idx) {
  const now = trailing12(series, idx);
  const prev = trailing12(series, idx - 12);
  if (now == null || prev == null || prev === 0) return null;
  return { now, prev, pct: (now - prev) / prev };
}

/** A full trailing-12mo average line aligned to the months axis (null before month 12). */
export function trailing12Line(series) {
  return series.map((_, i) => trailing12(series, i));
}

/** Prior-year line: series shifted forward 12 months (null for the first year). */
export function priorYearLine(series) {
  return series.map((_, i) => (i >= 12 ? series[i - 12] : null));
}

/** District share of the citywide total at a month. */
export function share(districtSeries, citySeries, idx) {
  const c = citySeries[idx];
  return c ? districtSeries[idx] / c : null;
}

// ── Window-based (the global time window drives cards/chart/map together) ──

export function sumRange(series, lo, hi) {
  let s = 0;
  for (let i = lo; i <= hi; i++) s += series[i] || 0;
  return s;
}

/**
 * Momentum over horizon n: the trailing-n-month total ending at idx vs the immediately preceding
 * n-month block. One consistent definition for the card's 1/3/12-mo chips (n=12 equals trend12).
 * Short horizons are NOT season-adjusted (the card labels them so); only n=12 is season-neutral.
 */
export function momentumN(series, idx, n) {
  const lo = idx - 2 * n + 1;
  if (lo < 0) return null;                         // not enough history for the prior block
  const cur = sumRange(series, idx - n + 1, idx);
  const prior = sumRange(series, lo, idx - n);
  return prior ? (cur - prior) / prior : null;
}

/** Total over [lo,hi] vs the same-length window one year earlier (same season). */
export function windowYoY(series, lo, hi) {
  const cur = sumRange(series, lo, hi);
  if (lo - 12 < 0) return { cur, prior: null, pct: null };
  const prior = sumRange(series, lo - 12, hi - 12);
  return { cur, prior, pct: prior ? (cur - prior) / prior : null };
}

/** District share of citywide over a window. */
export function windowShare(districtSeries, citySeries, lo, hi) {
  const c = sumRange(citySeries, lo, hi);
  return c ? sumRange(districtSeries, lo, hi) / c : null;
}

export const fmtPct = x => (x == null ? '—' : `${x >= 0 ? '▲' : '▼'} ${Math.abs(x * 100).toFixed(0)}%`);
export const deltaClass = x => (x == null ? 'delta-flat' : x > 0.005 ? 'delta-up' : x < -0.005 ? 'delta-down' : 'delta-flat');
