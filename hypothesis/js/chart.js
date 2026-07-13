// ──────────────────────────────────────────────────────────────────────
// Hand-rolled SVG bar chart — zero dependencies, styled to mirror the
// resultsfor.sf.gov (Recharts) look: light dashed horizontal grid, gray
// axis ticks, flat category bars, a dashed intervention marker, and a
// white hover tooltip. Pure consumer of [{start, label, tip, n}] buckets.
// ──────────────────────────────────────────────────────────────────────

function niceStep(rough) {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * @param {HTMLElement} host
 * @param {{start:string,label:string,tip:string,n:number}[]} series
 * @param {{interventionISO?:string, breaks?:{date:string,label:string}[]}} [opts]
 */
export function renderChart(host, series, opts = {}) {
  if (host._chartRO) host._chartRO.disconnect();
  const draw = () => paint(host, series, opts);
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  host._chartRO = ro;
}

function paint(host, series, opts) {
  const interventionISO = opts.interventionISO;
  const W = Math.max(320, host.clientWidth || 900);
  const H = 320;
  const M = { top: 18, right: 16, bottom: 46, left: 40 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  if (!series.length) { host.innerHTML = ''; return; }

  const maxN = Math.max(1, ...series.map(s => s.n));
  const step = niceStep(maxN / 4);
  const yMax = Math.ceil(maxN / step) * step;
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  const band = innerW / series.length;
  const barW = Math.max(1, Math.min(band * 0.68, 48));
  const labelStep = Math.ceil(series.length / 12);

  const x = i => M.left + i * band;
  const y = v => M.top + innerH - (v / yMax) * innerH;

  // bucket index whose span contains a given ISO date, or -1 if outside the series
  const bucketIndexFor = iso => {
    if (!iso) return -1;
    for (let i = 0; i < series.length; i++) {
      const next = i + 1 < series.length ? series[i + 1].start : null;
      if (series[i].start <= iso && (next === null || next > iso)) return i;
    }
    return -1;
  };

  // bucket index that contains the intervention date (for marker + post coloring)
  const markerIndex = bucketIndexFor(interventionISO);
  const postFrom = markerIndex >= 0
    ? markerIndex
    : (interventionISO && interventionISO < series[0].start ? 0 : series.length);

  const parts = [];

  // gridlines + y ticks
  parts.push('<g class="chart-grid">');
  for (const v of yTicks) parts.push(`<line x1="${M.left}" y1="${y(v)}" x2="${M.left + innerW}" y2="${y(v)}"/>`);
  parts.push('</g><g class="chart-axis">');
  for (const v of yTicks) parts.push(`<text x="${M.left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);

  // x labels (thinned)
  series.forEach((s, i) => {
    if (i % labelStep === 0) {
      parts.push(`<text x="${x(i) + band / 2}" y="${M.top + innerH + 18}" text-anchor="middle">${s.label}</text>`);
    }
  });
  parts.push('</g>');

  // bars
  series.forEach((s, i) => {
    const bx = x(i) + (band - barW) / 2;
    const by = y(s.n);
    const bh = M.top + innerH - by;
    const cls = i >= postFrom ? 'chart-bar chart-bar--post' : 'chart-bar';
    parts.push(`<rect class="${cls}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="1.5"/>`);
  });

  // intervention marker (left edge of the containing bucket)
  if (markerIndex >= 0) {
    const mx = x(markerIndex);
    parts.push(`<line class="chart-marker" x1="${mx}" y1="${M.top}" x2="${mx}" y2="${M.top + innerH}"/>`);
    const anchor = markerIndex > series.length * 0.7 ? 'end' : 'start';
    const dx = anchor === 'end' ? -6 : 6;
    parts.push(`<text class="chart-marker-label" x="${mx + dx}" y="${M.top + 10}" text-anchor="${anchor}">intervention</text>`);
  }

  // data-reporting break markers (e.g. a sensor feed ending) — only drawn when the
  // break date falls within the visible window, i.e. the window straddles it.
  for (const b of (opts.breaks || [])) {
    const bi = bucketIndexFor(b.date);
    if (bi < 0) continue;
    const bx = x(bi);
    parts.push(`<line class="chart-break" x1="${bx}" y1="${M.top}" x2="${bx}" y2="${M.top + innerH}"/>`);
    const anchor = bi > series.length * 0.7 ? 'end' : 'start';
    const dx = anchor === 'end' ? -6 : 6;
    parts.push(`<text class="chart-break-label" x="${bx + dx}" y="${M.top + 24}" text-anchor="${anchor}">${b.label || 'data break'}</text>`);
  }

  // invisible hit areas for tooltip
  series.forEach((s, i) => {
    parts.push(`<rect data-i="${i}" x="${x(i)}" y="${M.top}" width="${band}" height="${innerH}" fill="transparent"/>`);
  });

  const noun = opts.noun || 'report';
  const ariaLabel = `${opts.title || 'Reports'} over time`;
  host.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${ariaLabel}">${parts.join('')}</svg>` +
    `<div class="chart-tip" hidden></div>`;

  // tooltip wiring
  const tip = host.querySelector('.chart-tip');
  host.querySelectorAll('rect[data-i]').forEach(rect => {
    rect.addEventListener('mouseenter', () => {
      const i = +rect.dataset.i;
      const s = series[i];
      tip.innerHTML = `<strong>${s.tip}</strong>${s.n} ${noun}${s.n === 1 ? '' : 's'}`;
      tip.style.left = `${x(i) + band / 2}px`;
      tip.style.top = `${y(s.n) - 8}px`;
      tip.hidden = false;
    });
    rect.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}
