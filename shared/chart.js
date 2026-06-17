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
  const { months, values, partialIdx, unsettledFromIdx, overlays = {}, breaks = [], noun = 'report',
          window: win, onBrush, maxSel, minWin = 3 } = model;
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
    parts.push(`<rect class="chart-window" data-brush="band" x="${wx.toFixed(1)}" y="${M.top}" width="${Math.max(0, wW).toFixed(1)}" height="${innerH}"/>`);
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

  // "still settling" band — recent report-approval-lag months for arrest signals (drawn behind bars)
  const hasUnsettled = Number.isInteger(unsettledFromIdx) && unsettledFromIdx < months.length;
  if (hasUnsettled) {
    const ux = x(unsettledFromIdx);
    parts.push(`<rect class="chart-unsettled" x="${ux.toFixed(1)}" y="${M.top}" width="${Math.max(0, M.left + innerW - ux).toFixed(1)}" height="${innerH}"/>`);
    parts.push(`<text class="chart-unsettled-label" x="${Math.min(M.left + innerW - 3, ux + 4).toFixed(1)}" y="${M.top + 12}" text-anchor="start">still settling</text>`);
  }

  // bars (current partial month faint; bars outside the active window dimmed)
  values.forEach((v, i) => {
    const bx = x(i) + (band - barW) / 2;
    const by = y(v);
    const bh = M.top + innerH - by;
    let cls = 'chart-bar';
    // D6: bars stay fully lit (the band conveys the selection); only partial/unsettled months fade.
    if (i === partialIdx || (hasUnsettled && i >= unsettledFromIdx)) cls += ' chart-bar--partial';
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

  // brush handles — drawn LAST so they sit above the hit areas and stay grabbable (interactive only)
  if (onBrush && hasWin) {
    for (const [edge, ex] of [['lo', x(win.lo)], ['hi', x(win.hi + 1)]]) {
      parts.push(`<rect class="chart-handle" data-brush="${edge}" x="${(ex - 5).toFixed(1)}" y="${M.top}" width="10" height="${innerH}"/>`);
      parts.push(`<line class="chart-handle-grip" data-brush="${edge}" x1="${ex.toFixed(1)}" y1="${(M.top + innerH / 2 - 7).toFixed(1)}" x2="${ex.toFixed(1)}" y2="${(M.top + innerH / 2 + 7).toFixed(1)}"/>`);
    }
  }

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

  if (onBrush && hasWin)
    wireBrush(host, { Mleft: M.left, band, W, top: M.top, innerH,
                      maxSel: Number.isInteger(maxSel) ? maxSel : months.length - 1, minWin, onBrush, win, tip });
}

// ── chart-as-scrubber: drag across the plot to set a new window; drag an edge handle to nudge it.
// Updates the band/handles live (cheap DOM writes — no repaint); fires onBrush(lo,hi,committed).
function wireBrush(host, geom) {
  const { Mleft, band, W, top, innerH, maxSel, minWin, onBrush, tip } = geom;
  const svg = host.querySelector('svg');
  if (!svg) return;
  let win = { ...geom.win };
  const bandRect = svg.querySelector('[data-brush="band"]');
  const edges = svg.querySelectorAll('.chart-window-edge');
  const handle = e => svg.querySelector(`rect.chart-handle[data-brush="${e}"]`);
  const grip = e => svg.querySelector(`line.chart-handle-grip[data-brush="${e}"]`);
  const xOf = i => Mleft + i * band;
  const idxAt = clientX => {
    const r = svg.getBoundingClientRect();
    const sx = (clientX - r.left) * (W / r.width);
    return Math.max(0, Math.min(maxSel, Math.floor((sx - Mleft) / band)));
  };
  const redraw = () => {
    const wx = xOf(win.lo), ex = xOf(win.hi + 1);
    bandRect?.setAttribute('x', wx.toFixed(1));
    bandRect?.setAttribute('width', Math.max(0, ex - wx).toFixed(1));
    edges[0]?.setAttribute('x1', wx.toFixed(1)); edges[0]?.setAttribute('x2', wx.toFixed(1));
    edges[1]?.setAttribute('x1', ex.toFixed(1)); edges[1]?.setAttribute('x2', ex.toFixed(1));
    for (const [e, gx] of [['lo', wx], ['hi', ex]]) {
      handle(e)?.setAttribute('x', (gx - 5).toFixed(1));
      grip(e)?.setAttribute('x1', gx.toFixed(1)); grip(e)?.setAttribute('x2', gx.toFixed(1));
    }
  };
  let mode = null, anchor = 0;
  const onMove = e => {
    if (!mode) return;
    const i = idxAt(e.clientX);
    if (mode === 'lo') win = { lo: Math.min(i, win.hi), hi: win.hi };
    else if (mode === 'hi') win = { lo: win.lo, hi: Math.max(i, win.lo) };
    else win = { lo: Math.min(anchor, i), hi: Math.max(anchor, i) };
    if (win.hi - win.lo + 1 < minWin) {                  // enforce the min-window guard
      if (mode === 'lo') win.lo = Math.max(0, win.hi - (minWin - 1));
      else win.hi = Math.min(maxSel, win.lo + (minWin - 1));
    }
    redraw();
    onBrush(win.lo, win.hi, false);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (mode) onBrush(win.lo, win.hi, true);             // commit → reclassify the map
    mode = null;
  };
  svg.addEventListener('pointerdown', e => {
    const t = e.target.getAttribute && e.target.getAttribute('data-brush');
    if (t === 'lo' || t === 'hi') { mode = t; anchor = t === 'lo' ? win.hi : win.lo; }
    else { mode = 'new'; anchor = idxAt(e.clientX); }
    if (tip) tip.hidden = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    onMove(e);
    e.preventDefault();
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

// ──────────────────────────────────────────────────────────────────────
// Stacked monthly bars — used by the "what drug arrests are made of" panel.
// layers = [{ values:[…aligned to months], color, label }] stacked bottom→top.
// ──────────────────────────────────────────────────────────────────────
export function renderStacked(host, model) {
  if (host._chartRO) host._chartRO.disconnect();
  const draw = () => paintStacked(host, model);
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  host._chartRO = ro;
}

function paintStacked(host, model) {
  const { months, layers, partialIdx } = model;
  if (!months.length) { host.innerHTML = ''; return; }
  const W = Math.max(320, host.clientWidth || 900);
  const H = 320;
  const M = { top: 16, right: 16, bottom: 42, left: 44 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const totals = months.map((_, i) => layers.reduce((s, l) => s + (l.values[i] || 0), 0));
  const maxN = Math.max(1, ...totals);
  const step = niceStep(maxN / 4);
  const yMax = Math.ceil(maxN / step) * step;
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  const band = innerW / months.length;
  const barW = Math.max(1, Math.min(band * 0.72, 40));
  const labelStep = Math.ceil(months.length / 14);
  const x = i => M.left + i * band;
  const y = v => M.top + innerH - (v / yMax) * innerH;

  const parts = ['<g class="chart-grid">'];
  for (const v of yTicks) parts.push(`<line x1="${M.left}" y1="${y(v)}" x2="${M.left + innerW}" y2="${y(v)}"/>`);
  parts.push('</g><g class="chart-axis">');
  for (const v of yTicks) parts.push(`<text x="${M.left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  months.forEach((ym, i) => {
    if (i % labelStep === 0) parts.push(`<text x="${x(i) + band / 2}" y="${M.top + innerH + 16}" text-anchor="middle">${labelFor(ym)}</text>`);
  });
  parts.push('</g>');

  months.forEach((ym, i) => {
    const bx = x(i) + (band - barW) / 2;
    let acc = 0;
    const partial = i === partialIdx ? ' chart-stack--partial' : '';
    layers.forEach(l => {
      const v = l.values[i] || 0;
      if (v <= 0) { return; }
      const yTop = y(acc + v), yBot = y(acc);
      acc += v;
      parts.push(`<rect class="chart-stack${partial}" x="${bx.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, yBot - yTop).toFixed(1)}" fill="${l.color}"/>`);
    });
    parts.push(`<rect data-i="${i}" x="${x(i)}" y="${M.top}" width="${band}" height="${innerH}" fill="transparent"/>`);
  });

  const legendHTML = `<div class="chart-legend">${layers.map(l =>
    `<span class="cl-item"><svg class="cl-sw" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" fill="${l.color}"/></svg><span>${l.label}</span></span>`).join('')}</div>`;

  host.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="drug arrest composition over time">${parts.join('')}</svg>` +
    legendHTML + `<div class="chart-tip" hidden></div>`;

  const tip = host.querySelector('.chart-tip');
  host.querySelectorAll('rect[data-i]').forEach(rect => {
    rect.addEventListener('mouseenter', () => {
      const i = +rect.dataset.i, tot = totals[i];
      const rows = layers.map(l => {
        const v = l.values[i] || 0;
        const pct = tot ? Math.round(v / tot * 100) : 0;
        return `<br><span style="color:${l.color}">■</span> ${l.label}: ${v} (${pct}%)`;
      }).join('');
      tip.innerHTML = `<strong>${labelLong(months[i])}${i === partialIdx ? ' (partial)' : ''}</strong> · ${tot} arrests${rows}`;
      tip.style.left = `${x(i) + band / 2}px`;
      tip.style.top = `${y(tot) - 8}px`;
      tip.hidden = false;
    });
    rect.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}
