// ──────────────────────────────────────────────────────────────────────
// Hand-rolled SVG chart (zero deps), styled to the root tool's look.
// Monthly bars for the focused series + optional overlay lines:
//   • trailing-12-month average  (the de-seasonalized "larger trend")
//   • prior-year ghost           (same-season comparison)
//   • citywide, scaled to shape  (does this district track the city?)
// Plus a dashed break marker (e.g. the 2025-06 category reroute) and a faint
// bar for the current partial month. Pure consumer of arrays aligned to `months`.
// ──────────────────────────────────────────────────────────────────────

function niceStep(rough) {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const labelFor = ym => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? String(y) : MONTH_ABBR[m - 1];
};

export function renderChart(host, model) {
  if (host._chartRO) host._chartRO.disconnect();
  const draw = () => paint(host, model);
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  host._chartRO = ro;
}

function linePath(values, x, y, band, yMax) {
  // Build path segments, breaking on nulls. x positions at band centre.
  let d = '', pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const px = x(i) + band / 2;
    const py = y(Math.min(v, yMax));
    d += `${pen ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

function paint(host, model) {
  const { months, values, partialIdx, overlays = {}, breaks = [], noun = 'report', window: win } = model;
  const W = Math.max(320, host.clientWidth || 900);
  const H = 340;
  const M = { top: 18, right: 16, bottom: 42, left: 44 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  if (!months.length) { host.innerHTML = ''; return; }

  // y-axis from bars + any visible overlay lines (so lines don't clip)
  const lineVals = [overlays.trend, overlays.priorYear, overlays.citywideScaled]
    .filter(Boolean).flat().filter(v => v != null);
  const maxN = Math.max(1, ...values, ...lineVals);
  const step = niceStep(maxN / 4);
  const yMax = Math.ceil(maxN / step) * step;
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  const band = innerW / months.length;
  const barW = Math.max(1, Math.min(band * 0.7, 40));
  const labelStep = Math.ceil(months.length / 14);
  const x = i => M.left + i * band;
  const y = v => M.top + innerH - (v / yMax) * innerH;
  const idxOfMonth = ym => months.indexOf(ym);

  const parts = [];

  // active time window band (cards + map summarise this span)
  const hasWin = win && Number.isInteger(win.lo) && Number.isInteger(win.hi);
  if (hasWin) {
    const wx = x(win.lo);
    const wW = x(win.hi + 1) - wx;
    parts.push(`<rect class="chart-window" x="${wx.toFixed(1)}" y="${M.top}" width="${Math.max(0, wW).toFixed(1)}" height="${innerH}"/>`);
    parts.push(`<line class="chart-window-edge" x1="${wx.toFixed(1)}" y1="${M.top}" x2="${wx.toFixed(1)}" y2="${M.top + innerH}"/>`);
    parts.push(`<line class="chart-window-edge" x1="${(wx + wW).toFixed(1)}" y1="${M.top}" x2="${(wx + wW).toFixed(1)}" y2="${M.top + innerH}"/>`);
  }

  parts.push('<g class="chart-grid">');
  for (const v of yTicks) parts.push(`<line x1="${M.left}" y1="${y(v)}" x2="${M.left + innerW}" y2="${y(v)}"/>`);
  parts.push('</g><g class="chart-axis">');
  for (const v of yTicks) parts.push(`<text x="${M.left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  months.forEach((ym, i) => {
    if (i % labelStep === 0) parts.push(`<text x="${x(i) + band / 2}" y="${M.top + innerH + 16}" text-anchor="middle">${labelFor(ym)}</text>`);
  });
  parts.push('</g>');

  // bars (current partial month faint; bars outside the active window dimmed)
  values.forEach((v, i) => {
    const bx = x(i) + (band - barW) / 2;
    const by = y(v);
    const bh = M.top + innerH - by;
    let cls = 'chart-bar';
    if (i === partialIdx) cls += ' chart-bar--partial';
    else if (hasWin && (i < win.lo || i > win.hi)) cls += ' chart-bar--dim';
    parts.push(`<rect class="${cls}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="1.5"/>`);
  });

  // overlay lines — each gets a white/surface "casing" underneath so it stays
  // legible over the bars (including coloured district bars). Trend drawn last (on top).
  const lines = [];
  if (overlays.priorYear) lines.push(['line-prioryear', overlays.priorYear]);
  if (overlays.citywideScaled) lines.push(['line-citywide', overlays.citywideScaled]);
  if (overlays.trend) lines.push(['line-trend', overlays.trend]);
  const linePaths = lines.map(([cls, vals]) => [cls, linePath(vals, x, y, band, yMax)]);
  for (const [, d] of linePaths) parts.push(`<path class="line-casing" d="${d}"/>`);
  for (const [cls, d] of linePaths) parts.push(`<path class="${cls}" d="${d}"/>`);

  // break markers (only those within the axis)
  for (const b of breaks) {
    const bi = idxOfMonth(b.month);
    if (bi < 0) continue;
    const bx = x(bi);
    parts.push(`<line class="chart-break" x1="${bx}" y1="${M.top}" x2="${bx}" y2="${M.top + innerH}"/>`);
    const anchor = bi > months.length * 0.55 ? 'end' : 'start';
    const dx = anchor === 'end' ? -6 : 6;
    parts.push(`<text class="chart-break-label" x="${bx + dx}" y="${M.top + 12}" text-anchor="${anchor}">${b.label || 'data break'}</text>`);
  }

  // invisible hover hit areas
  months.forEach((ym, i) => {
    parts.push(`<rect data-i="${i}" x="${x(i)}" y="${M.top}" width="${band}" height="${innerH}" fill="transparent"/>`);
  });

  // legend — only the series actually drawn (bars + whichever overlay lines exist).
  // Swatches reuse the chart's stroke/fill classes so colour + dash pattern match exactly.
  const legend = [['bar', `Monthly ${noun}s`]];
  if (overlays.trend) legend.push(['line-trend', '12-mo average (trend)']);
  if (overlays.priorYear) legend.push(['line-prioryear', 'A year earlier']);
  if (overlays.citywideScaled) legend.push(['line-citywide', 'Citywide (scaled)']);
  const legendHTML =
    `<div class="chart-legend">${legend.map(([k, lab]) =>
      `<span class="cl-item">${legendSwatch(k)}<span>${lab}</span></span>`).join('')}</div>`;

  host.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${noun} reports over time">${parts.join('')}</svg>` +
    legendHTML +
    `<div class="chart-tip" hidden></div>`;

  const tip = host.querySelector('.chart-tip');
  host.querySelectorAll('rect[data-i]').forEach(rect => {
    rect.addEventListener('mouseenter', () => {
      const i = +rect.dataset.i;
      const n = values[i];
      const py = overlays.priorYear?.[i];
      const partial = i === partialIdx ? ' (partial)' : '';
      const pyLine = py != null ? `<br>${py} a year earlier` : '';
      tip.innerHTML = `<strong>${labelLong(months[i])}${partial}</strong>${n} ${noun}${n === 1 ? '' : 's'}${pyLine}`;
      tip.style.left = `${x(i) + band / 2}px`;
      tip.style.top = `${y(Math.min(n, yMax)) - 8}px`;
      tip.hidden = false;
    });
    rect.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}

// Tiny legend swatch: a bar pair for the focused series, or a mini line that
// reuses the matching stroke class (so dashes/colour stay in sync with the chart).
function legendSwatch(kind) {
  if (kind === 'bar')
    return `<svg class="cl-sw" viewBox="0 0 22 12" width="22" height="12" aria-hidden="true">` +
      `<rect class="chart-bar" x="3" y="3" width="6" height="7" rx="1"/>` +
      `<rect class="chart-bar" x="13" y="5" width="6" height="5" rx="1"/></svg>`;
  return `<svg class="cl-sw" viewBox="0 0 22 12" width="22" height="12" aria-hidden="true">` +
    `<line class="${kind}" x1="1" y1="6" x2="21" y2="6"/></svg>`;
}

function labelLong(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
}
