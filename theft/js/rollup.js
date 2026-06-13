// ──────────────────────────────────────────────────────────────────────
// Metric math — pure functions over the monthly series in aggregates.json.
//
// Primary success metric = theft REPORTED BY BUSINESSES (../plan.md §3.5).
// The headline is the latest complete month, shown against three references
// (last month, same month a year earlier, the all-time monthly average) so a
// single number can't mislead, plus a de-noised 12-month-trend badge.
// Arrests are SECONDARY CONTEXT (below the chart), not a success target (D11).
// ──────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
export const shortMonth = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`; };
export const monthIndex = (agg, ym) => agg.months.indexOf(ym);

/** Sum of the 12 months ending at idx (inclusive); null if <12 months available. */
export function trailing12Sum(series, idx) {
  if (idx < 11) return null;
  let s = 0;
  for (let i = idx - 11; i <= idx; i++) s += series[i] || 0;
  return s;
}
/** A full trailing-12mo line aligned to the months axis (null before month 12). */
export function trailing12Line(series) {
  return series.map((_, i) => trailing12Sum(series, i));
}

/** De-noised yearly trend: trailing-12mo total at idx vs the trailing-12mo total a year earlier. */
export function trailingYoY(series, idx) {
  const cur = trailing12Sum(series, idx);
  const prior = trailing12Sum(series, idx - 12);
  if (cur == null || prior == null) return { cur, prior: null, pct: null };
  return { cur, prior, pct: prior ? (cur - prior) / prior : null };
}

/** A single-month value at idx compared to a reference month at refIdx. */
export function compareMonth(series, idx, refIdx) {
  const cur = series[idx];
  if (refIdx < 0 || refIdx >= series.length) return { cur, ref: null, pct: null };
  const ref = series[refIdx];
  return { cur, ref, pct: ref ? (cur - ref) / ref : null };
}

/** Latest month vs the average of every complete month from the start through idx. */
export function compareToAverage(series, idx) {
  let s = 0;
  for (let i = 0; i <= idx; i++) s += series[i] || 0;
  const avg = (idx + 1) > 0 ? s / (idx + 1) : 0;
  const cur = series[idx];
  return { cur, avg, pct: avg ? (cur - avg) / avg : null };
}

/** Northern's share of the citywide total over the trailing 12 months ending at idx. */
export function shareAt(nSeries, cSeries, idx) {
  const n = trailing12Sum(nSeries, idx), c = trailing12Sum(cSeries, idx);
  return (n == null || c == null || !c) ? null : n / c;
}

/** Northern's all-time share (robust baseline — avoids cherry-picking a distorted year). */
export function shareAllTime(nSeries, cSeries) {
  const n = nSeries.reduce((a, b) => a + b, 0), c = cSeries.reduce((a, b) => a + b, 0);
  return c ? n / c : null;
}

export const fmtSharePct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);

const THRESH = 0.05; // ±5% — below this we treat a move as "flat" given the noise
const sign = pct => (pct == null ? 0 : pct <= -THRESH ? -1 : pct >= THRESH ? 1 : 0);

/** Per-metric coloring: business reports are good when DOWN. 'good' | 'bad' | 'flat'. */
export function reportTone(pct) {
  const s = sign(pct);
  return s === 0 ? 'flat' : s < 0 ? 'good' : 'bad';
}

/** Headline verdict, based on the de-noised 12-month trend of business reports. */
export function trendVerdict(pct) {
  const s = sign(pct);
  if (s < 0) return { label: 'Improving', tone: 'good', text: 'Fewer thefts reported by businesses over the past year.' };
  if (s > 0) return { label: 'Worsening', tone: 'bad', text: 'More thefts reported by businesses over the past year.' };
  return { label: 'Little change', tone: 'flat', text: 'Business-reported theft is about flat over the past year.' };
}

export const fmtPct = x => (x == null ? '—' : `${x >= 0 ? '▲' : '▼'} ${Math.abs(x * 100).toFixed(0)}%`);
