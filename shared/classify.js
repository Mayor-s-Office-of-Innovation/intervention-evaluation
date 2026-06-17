// ──────────────────────────────────────────────────────────────────────
// Parametric difference-in-differences hot/cold classifier — the browser-side
// source of truth (port of build/04_transitions.py §classify). Pure functions over
// each cell's `monthly[]` and its district's monthly totals (both aligned to the
// transitions month axis). Given any analysis window + baseline, it reclassifies a
// cell as persistent / cooled / emerged (or null) the same way the build did for the
// fixed Lurie split — so the build's baked `category` is an exact PARITY ORACLE
// (validated in validation/parity.mjs). See ../plan-scrubber.md §4.
//
// The trick that makes short, seasonal windows safe: the cell is judged against the
// DISTRICT TIDE recomputed over the SAME window, so movement common to the whole
// district (seasonality, citywide trend) cancels in the difference-in-differences.
// ──────────────────────────────────────────────────────────────────────

const sumRange = (arr, lo, hi) => {
  let s = 0;
  for (let i = lo; i <= hi; i++) s += arr[i] || 0;
  return s;
};
const meanRange = (arr, lo, hi) => sumRange(arr, lo, hi) / (hi - lo + 1);

/**
 * Classify one cell for an analysis window vs a baseline (inclusive index ranges into the month axis).
 * @returns {category, preRate, nowRate, expected, tide, total} — category null if not classified.
 */
export function classifyCell(cell, districtMonthly, win, base, knobs) {
  const { hot, floor, band } = knobs;
  const preRate = meanRange(cell.monthly, base.lo, base.hi);
  const nowRate = meanRange(cell.monthly, win.lo, win.hi);
  const dPre = meanRange(districtMonthly, base.lo, base.hi);
  const dNow = meanRange(districtMonthly, win.lo, win.hi);
  const tide = dPre > 0 ? dNow / dPre : 1.0;
  const expected = preRate * tide;            // "now" rate if the cell had merely tracked its district

  // floor gate: enough volume across baseline + window (mirrors Python's pre+now ≥ FLOOR)
  const vol = sumRange(cell.monthly, base.lo, base.hi) + sumRange(cell.monthly, win.lo, win.hi);
  let category = null;
  if (vol >= floor) {
    const hotBefore = preRate >= hot;
    const hotNow = nowRate >= hot;
    if (hotBefore || hotNow) {
      const rose = nowRate > expected * (1 + band);
      const fell = nowRate < expected * (1 - band);
      if (hotNow && !hotBefore) category = rose ? 'emerged' : null;
      else if (fell && (hotBefore || nowRate < hot)) category = 'cooled';
      else if (hotBefore && hotNow) category = 'persistent';
    }
  }
  return {
    category, tide,
    preRate, nowRate,
    expectedRate: expected,                          // named to match the map's cell consumer
    total: sumRange(cell.monthly, win.lo, win.hi),   // window volume (for marker sizing)
  };
}

/** Classify a list of cells; each result keeps the cell's static fields + the per-window verdict. */
export function classifyCells(cells, districtMonthly, win, base, knobs) {
  return cells.map(c => ({ ...c, ...classifyCell(c, districtMonthly[c.district], win, base, knobs) }));
}

/** Resolve the {lo,hi} index range for a [startYM, endYM] (or [startYM,…,endYM]) against the axis. */
export function ymRange(months, span) {
  const lo = months.indexOf(span[0]);
  const hi = months.indexOf(span[span.length - 1]);
  return { lo, hi };
}

/** District "tide": how the whole district's monthly rate moved from baseline → window (×). */
export function districtTide(districtMonthly, win, base) {
  const dPre = meanRange(districtMonthly, base.lo, base.hi);
  const dNow = meanRange(districtMonthly, win.lo, win.hi);
  return dPre > 0 ? dNow / dPre : 1.0;
}
