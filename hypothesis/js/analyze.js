// ──────────────────────────────────────────────────────────────────────
// Analysis — PURE functions, data → data. No DOM, no fetch.
// Produces the bucketed time series for the chart (adaptive day/week/month
// granularity) and the before/after window summary for the verdict + stats.
// ──────────────────────────────────────────────────────────────────────

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── date helpers (UTC, ISO 'YYYY-MM-DD') ──
export function addDays(iso, n) {
  return new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10);
}
export function daysBetween(aISO, bISO) {
  return Math.round((Date.parse(bISO) - Date.parse(aISO)) / DAY_MS);
}
function mondayOf(iso) {
  const dt = new Date(iso + 'T00:00:00Z');
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(dt.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}

// ── label formatters ──
function dayLabel(iso) { const [, m, d] = iso.split('-'); return `${+m}/${+d}`; }            // 5/13
function dayTip(iso)   { const [y, m, d] = iso.split('-'); return `${MONTHS[+m - 1]} ${+d}, ${y}`; }
function monthLabel(ym){ const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} '${y.slice(2)}`; } // May '26
function monthTip(ym)  { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; }

/** Pick bucket size so the chart stays readable across any window length. */
export function chooseGranularity(startDay, endDay) {
  const days = daysBetween(startDay, endDay) + 1;
  if (days <= 75) return 'day';
  if (days <= 540) return 'week';
  return 'month';
}

/**
 * Zero-filled buckets between startDay..endDay (inclusive) at the given
 * granularity. Each bucket: { start, label, tip, n }.
 */
export function bucketSeries(events, startDay, endDay, granularity) {
  const inRange = events.filter(e => e.day && e.day >= startDay && e.day <= endDay);
  const counts = new Map();
  const bump = key => counts.set(key, (counts.get(key) || 0) + 1);
  const out = [];

  if (granularity === 'day') {
    for (const e of inRange) bump(e.day);
    for (let t = Date.parse(startDay); t <= Date.parse(endDay); t += DAY_MS) {
      const iso = new Date(t).toISOString().slice(0, 10);
      out.push({ start: iso, label: dayLabel(iso), tip: dayTip(iso), n: counts.get(iso) || 0 });
    }
    return out;
  }

  if (granularity === 'week') {
    for (const e of inRange) bump(mondayOf(e.day));
    let wk = mondayOf(startDay);
    const endWk = mondayOf(endDay);
    while (wk <= endWk) {
      out.push({ start: wk, label: dayLabel(wk), tip: `Week of ${dayTip(wk)}`, n: counts.get(wk) || 0 });
      wk = addDays(wk, 7);
    }
    return out;
  }

  // month
  for (const e of inRange) bump(e.day.slice(0, 7));
  let [y, m] = startDay.slice(0, 7).split('-').map(Number);
  const endYm = endDay.slice(0, 7);
  let cur = `${y}-${String(m).padStart(2, '0')}`;
  while (cur <= endYm) {
    out.push({ start: `${cur}-01`, label: monthLabel(cur), tip: monthTip(cur), n: counts.get(cur) || 0 });
    if (++m > 12) { m = 1; y++; }
    cur = `${y}-${String(m).padStart(2, '0')}`;
  }
  return out;
}

const median = arr => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const maxDay = (a, b) => (a > b ? a : b);

/**
 * Suggest a default "before" window start: the onset of the most recent
 * elevated regime (the spike that likely prompted the intervention), so the
 * before/after comparison isn't diluted against years of quiet baseline.
 *
 * Method: monthly counts of pre-intervention events; baseline = median of all
 * but the trailing 3 months; threshold = max(2×baseline, baseline+2); walk back
 * over a 3-month rolling average while it stays ≥ threshold. Falls back to a
 * recent 90-day window when history is short or no clear spike is found.
 * Returns { start, onsetMonth|null, method:'regime'|'fallback' }.
 */
export function detectWindowStart(events, interventionISO, historyStart = '2023-01-01') {
  const interMonth = interventionISO.slice(0, 7);
  const months = [];
  let [y, m] = historyStart.slice(0, 7).split('-').map(Number);
  let cur = `${y}-${String(m).padStart(2, '0')}`;
  while (cur <= interMonth) { months.push(cur); if (++m > 12) { m = 1; y++; } cur = `${y}-${String(m).padStart(2, '0')}`; }

  const counts = new Map(months.map(mm => [mm, 0]));
  let totalPre = 0;
  for (const e of events) {
    if (!e.day || e.day >= interventionISO) continue;
    const mk = e.day.slice(0, 7);
    if (counts.has(mk)) { counts.set(mk, counts.get(mk) + 1); totalPre++; }
  }
  const series = months.map(mm => counts.get(mm));

  const fallbackStart = maxDay(historyStart, addDays(interventionISO, -90));
  if (months.length < 6 || totalPre < 12) {
    return { start: fallbackStart, onsetMonth: null, method: 'fallback' };
  }

  const baseline = median(series.slice(0, Math.max(1, series.length - 3)));
  const threshold = Math.max(2 * baseline, baseline + 2);
  const roll = series.map((_, i) => {
    const seg = series.slice(Math.max(0, i - 2), i + 1);
    return seg.reduce((a, b) => a + b, 0) / seg.length;
  });

  let onsetIdx = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (roll[i] >= threshold) onsetIdx = i; else break;
  }
  if (onsetIdx === null || series.length - onsetIdx < 2) {
    return { start: fallbackStart, onsetMonth: null, method: 'fallback' };
  }
  return { start: maxDay(historyStart, `${months[onsetIdx]}-01`), onsetMonth: months[onsetIdx], method: 'regime' };
}

/**
 * Before/after summary WITHIN a selected window [windowStart, windowEnd],
 * split at the intervention date (D12 — the date-range slider is the
 * analysis window). Rates normalized per 30 days.
 *   pre  = [windowStart, intervention)   within the window
 *   post = [intervention, windowEnd]     within the window
 */
export function analyzeWindow(events, interventionISO, windowStart, windowEnd) {
  const inWin = events.filter(e => e.day && e.day >= windowStart && e.day <= windowEnd);
  const pre = inWin.filter(e => e.day < interventionISO).length;
  const post = inWin.length - pre;

  const endExcl = addDays(windowEnd, 1);
  const clamp = d => (d < windowStart ? windowStart : d > endExcl ? endExcl : d);
  const split = clamp(interventionISO);
  const preDays = Math.max(0, daysBetween(windowStart, split));
  const postDays = Math.max(0, daysBetween(split, endExcl));

  const preRate = preDays > 0 ? (pre / preDays) * 30 : 0;
  const postRate = postDays > 0 ? (post / postDays) * 30 : 0;

  let pct;
  if (preRate > 0) pct = ((postRate - preRate) / preRate) * 100;
  else pct = postRate > 0 ? Infinity : 0;

  const direction = postRate < preRate ? 'down' : postRate > preRate ? 'up' : 'flat';
  const interventionInWindow = interventionISO >= windowStart && interventionISO <= windowEnd;

  return {
    interventionISO, windowStart, windowEnd,
    pre, post, preDays, postDays, preRate, postRate, pct, direction,
    total: inWin.length, shortWindow: postDays > 0 && postDays < 30, interventionInWindow,
  };
}
