// core/chart.js — static SVG charts, built with createElementNS (no markup strings).
//
// 🔴 Drawn once. No animation and no animation-frame callbacks (a source scan forbids them): the same
// code runs in the overlay, whose frame-budget rule this meets by never redrawing.

const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const frame = (label, width, height, cls) =>
  s('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label, class: `chart ${cls}` }, s('title', {}, label));

/** Vertical bars, `[{ label, n }]`, each with its count above and label below. */
export function barChart(bars, { label, width = 360, height = 140 } = {}) {
  const svg = frame(label, width, height, 'bars');
  const max = Math.max(1, ...bars.map((b) => b.n));
  const slot = width / Math.max(1, bars.length);
  const top = 18;
  const plot = height - top - 20;
  bars.forEach((b, i) => {
    const hgt = Math.round((b.n / max) * plot);
    const w = Math.max(1, Math.round(slot * 0.6));
    const x = Math.round(i * slot + (slot - w) / 2);
    svg.appendChild(s('g', { class: 'bar' },
      s('rect', { x, y: top + plot - hgt, width: w, height: hgt, rx: 3 }),
      s('text', { x: x + w / 2, y: top + plot - hgt - 4, 'text-anchor': 'middle', class: 'n' }, String(b.n)),
      s('text', { x: x + w / 2, y: height - 5, 'text-anchor': 'middle', class: 'l' }, b.label)));
  });
  return svg;
}

/** A value line (`y`) under a ceiling line (`max`), over `x`. `marks` draw labelled verticals. */
export function lineChart(points, { label, width = 1000, height = 220, marks = [] } = {}) {
  const svg = frame(label, width, height, 'line');
  if (!points.length) return svg;
  const pad = { l: 32, r: 10, t: 14, b: 22 };
  const x0 = points[0].x;
  const x1 = points[points.length - 1].x;
  const ceiling = Math.max(1, ...points.map((p) => Math.max(p.y ?? 0, p.max ?? 0)));
  const X = (x) => pad.l + (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * (width - pad.l - pad.r));
  const Y = (y) => pad.t + (1 - y / ceiling) * (height - pad.t - pad.b);
  const path = (key) => points.filter((p) => Number.isFinite(p[key]))
    .map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ');

  for (const m of marks) {
    svg.appendChild(s('g', { class: 'mark' },
      s('line', { x1: X(m.x), x2: X(m.x), y1: pad.t, y2: height - pad.b }),
      s('text', { x: X(m.x) + 4, y: height - pad.b - 4, class: 'l' }, m.label)));
  }
  const maxPath = path('max');
  if (maxPath) svg.appendChild(s('path', { d: maxPath, class: 'max', fill: 'none' }));
  svg.appendChild(s('path', { d: path('y'), class: 'value', fill: 'none' }));
  svg.appendChild(s('text', { x: pad.l - 4, y: Y(ceiling) + 4, 'text-anchor': 'end', class: 'l' }, String(ceiling)));
  svg.appendChild(s('text', { x: pad.l - 4, y: Y(0), 'text-anchor': 'end', class: 'l' }, '0'));
  svg.appendChild(s('text', { x: X(x0), y: height - 5, class: 'l' }, String(x0)));
  if (x1 !== x0) svg.appendChild(s('text', { x: X(x1), y: height - 5, 'text-anchor': 'end', class: 'l' }, String(x1)));
  return svg;
}
