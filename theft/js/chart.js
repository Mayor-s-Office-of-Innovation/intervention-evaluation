// Hand-rolled SVG multi-line chart (no chart lib; mirrors ../districts/ approach).
// Draws monthly series as lines over the full months axis, with year gridlines,
// the current partial month flagged, and a small legend.

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * @param host        container element
 * @param months      ['2018-01', …]
 * @param lines       [{ values:[…], color, label, dashTailFrom?:idx, width? }]
 * @param opts        { unsettledFromIdx } — first month index still filling in (shaded)
 */
export function drawChart(host, months, lines, opts = {}) {
  host.replaceChildren();
  const W = host.clientWidth || 680, H = 240;
  const m = { t: 14, r: 12, b: 26, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = months.length;

  const allVals = lines.flatMap(l => l.values.filter(v => v != null));
  const maxV = Math.max(1, ...allVals);
  const x = i => m.l + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = v => m.t + ih - (v / maxV) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img' });

  // shade months still filling in (reporting lag) so they aren't read as a real drop
  if (opts.unsettledFromIdx != null && opts.unsettledFromIdx < n) {
    const x0 = x(Math.max(0, opts.unsettledFromIdx - 0.5));
    svg.appendChild(el('rect', {
      x: x0, y: m.t, width: Math.max(0, W - m.r - x0), height: ih, class: 'chart-unsettled',
    }));
    const t = el('text', { x: Math.min(W - m.r - 2, x0 + 3), y: m.t + 11, class: 'chart-axis chart-unsettled-label' });
    t.textContent = 'still settling';
    svg.appendChild(t);
  }

  // y gridlines + labels (0, mid, max)
  [0, maxV / 2, maxV].forEach(v => {
    const yy = y(v);
    svg.appendChild(el('line', { x1: m.l, y1: yy, x2: W - m.r, y2: yy, class: 'chart-grid' }));
    const t = el('text', { x: m.l - 6, y: yy + 3, 'text-anchor': 'end', class: 'chart-axis' });
    t.textContent = Math.round(v);
    svg.appendChild(t);
  });

  // x year labels (January of each year)
  months.forEach((ym, i) => {
    if (ym.endsWith('-01')) {
      const t = el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'chart-axis' });
      t.textContent = ym.slice(0, 4);
      svg.appendChild(t);
    }
  });

  const path = vals => {
    let d = '', started = false;
    vals.forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  for (const ln of lines) {
    svg.appendChild(el('path', {
      d: path(ln.values), fill: 'none', stroke: ln.color,
      'stroke-width': ln.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'stroke-dasharray': ln.dash || '', 'stroke-opacity': ln.opacity != null ? ln.opacity : 1,
    }));
  }

  host.appendChild(svg);
}
