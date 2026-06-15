// OKR mapping diagram — hand-rolled SVG cubic-bezier wires (no library).
// Left = draft OKRs from the planning spreadsheet; right = the three dashboard
// OKRs. Wires are colored by their target dashboard; hover any node to trace.

const DRAFTS = [
  { id: 'd1', html: 'Reduce drug activity in <em>Hayes Hotspots</em>' },
  { id: 'd2', html: 'Reduce <em>hotspot activity</em> at <em>priority locations</em>' },
  { id: 'd3', html: 'Reduce <em>visible disorder</em> at <em>hotspots</em>' },
  { id: 'd4', html: 'Reduce encampments' },
  { id: 'd5', html: 'Restore merchant confidence in <em>Hayes Valley</em>' },
];

const OKRS = [
  { id: 'drug',     text: 'Reduce drug disorder',          href: '../drug/index.html',     accent: 'var(--okr-drug)' },
  { id: 'unhoused', text: 'Reduce unsheltered homelessness', href: '../unhoused/index.html', accent: 'var(--okr-unhoused)' },
  { id: 'merchant', text: 'Restore merchant confidence',    href: '../theft/index.html',    accent: 'var(--okr-merchant)' },
];

// draft → dashboard OKR links
const EDGES = [
  ['d1', 'drug'],
  ['d2', 'drug'],
  ['d3', 'drug'], ['d3', 'unhoused'],
  ['d4', 'unhoused'],
  ['d5', 'merchant'],
];

const SVGNS = 'http://www.w3.org/2000/svg';
const stage  = document.getElementById('stage');
const svg    = document.getElementById('wires');
const $ = id => document.getElementById(id);

// ── render nodes ──
$('draft-col').innerHTML = DRAFTS.map(d =>
  `<div class="node node--draft" id="n-${d.id}" data-id="${d.id}">${d.html}</div>`).join('');

$('okr-col').innerHTML = OKRS.map(o =>
  `<a class="node node--okr" id="n-${o.id}" data-id="${o.id}" href="${o.href}" style="--accent:${o.accent}">
     <span class="node__dot"></span><span>${o.text}</span><span class="node__go" aria-hidden="true">↗</span>
   </a>`).join('');

$('legend').innerHTML = OKRS.map(o =>
  `<li style="--accent:${o.accent}"><span class="swatch"></span>${o.text}</li>`).join('');

// ── build one <path> per edge ──
const wires = EDGES.map(([from, to]) => {
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('class', 'wire');
  p.dataset.from = from;
  p.dataset.to = to;
  p.style.stroke = OKRS.find(o => o.id === to).accent;   // CSS var() → re-themes for free
  svg.appendChild(p);
  return { p, from, to };
});

function anchor(el, side, box) {
  const r = el.getBoundingClientRect();
  return {
    x: (side === 'right' ? r.right : r.left) - box.left,
    y: r.top + r.height / 2 - box.top,
  };
}

function draw() {
  const box = svg.getBoundingClientRect();
  svg.setAttribute('width', box.width);
  svg.setAttribute('height', box.height);
  for (const w of wires) {
    const a = anchor($('n-' + w.from), 'right', box);
    const b = anchor($('n-' + w.to),   'left',  box);
    const dx = Math.max(48, (b.x - a.x) * 0.5);          // horizontal control-point reach
    w.p.setAttribute('d', `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`);
  }
}

// ── hover: trace an item's connections ──
function neighbors(id) {
  const set = new Set([id]);
  for (const w of wires) {
    if (w.from === id) set.add(w.to);
    if (w.to === id) set.add(w.from);
  }
  return set;
}
function focus(id) {
  stage.classList.toggle('has-focus', !!id);
  const lit = id ? neighbors(id) : null;
  for (const w of wires)
    w.p.classList.toggle('is-on', !!id && (w.from === id || w.to === id));
  document.querySelectorAll('.node').forEach(n =>
    n.classList.toggle('is-dim', !!id && !lit.has(n.dataset.id)));
}

document.querySelectorAll('.node').forEach(n => {
  const id = n.dataset.id;
  n.addEventListener('mouseenter', () => focus(id));
  n.addEventListener('mouseleave', () => focus(null));
  n.addEventListener('focusin',    () => focus(id));
  n.addEventListener('focusout',   () => focus(null));
});

// ── keep wires aligned through layout changes ──
const redraw = () => requestAnimationFrame(draw);
redraw();
window.addEventListener('load', redraw);
window.addEventListener('resize', redraw);
window.addEventListener('themechange', redraw);
if (window.ResizeObserver) new ResizeObserver(redraw).observe(stage);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
