// core/ui.js — shared pure render primitives.
//
// Every view composes these and every one returns an HTML STRING, never a node.
// That keeps views testable by parsing their output, and keeps rendering a single
// innerHTML write rather than a tree of appendChild calls.
//
// Interactivity is delegation-only: primitives emit data-act (and data-* payload)
// attributes, and core/app.js has the single listener. Inline onclick would work
// under this CSP, but it forces every handler into module scope and makes the
// renders untestable.
//
// ⚠️ ONE IMPORT, AND IT IS ONE-WAY. `errorPane` has to tell a refusal apart from
// a failure, and that rule belongs to the outbound path that produces it — a
// second copy of the predicate here would drift from the node's wording. core/
// http.js imports only the SDK, so there is no cycle.
import { isPermissionDenied } from './http.js';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Lift a colour until it is legible on the hub's near-black background.
 *
 * Several NFL primaries are effectively black — Raiders and Steelers are #000000,
 * Houston is #021018, Chicago #0b1c3a — so tinting a chart line or a piece of text
 * with a team's own colour can render it invisible. Fills and large blocks are fine
 * as-is; this is for strokes and small marks.
 *
 * Blends toward white until relative luminance clears `min`, which keeps the hue
 * recognisably the team's rather than swapping in a generic accent.
 */
export function legibleColor(hex, min = 0.22) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return hex ?? 'var(--text-2)';
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const lum = () => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Bounded loop: each step closes 18% of the gap to white, so ~24 steps saturates.
  for (let i = 0; i < 24 && lum() < min; i += 1) {
    r += (255 - r) * 0.18;
    g += (255 - g) * 0.18;
    b += (255 - b) * 0.18;
  }
  const hx = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/** Team logo + abbreviation. The most repeated unit in the plugin. */
export function chip(side, { clickable = false, size = '', showRecord = true } = {}) {
  if (!side) return '';
  const inner = `<img src="${esc(side.logo)}" alt="" loading="lazy">`
    + `<span class="abbr">${esc(side.abbr)}</span>`
    + (showRecord && side.record ? `<span class="rec">${esc(side.record)}</span>` : '');
  const cls = `chip${size ? ` ${size}` : ''}`;
  if (!clickable) return `<span class="${cls}">${inner}</span>`;
  return `<button class="${cls} clickable" data-act="team" data-team="${esc(side.abbr)}"`
    + ` aria-label="${esc(side.fullName ?? side.abbr)}">${inner}</button>`;
}

export function tile(label, value, { good = false } = {}) {
  return `<div class="tile"><div class="label">${esc(label)}</div>`
    + `<div class="value num${good ? ' good' : ''}">${esc(value)}</div></div>`;
}

export function panel({ title, body, right = '', flush = false, id = '' }) {
  return `<section class="panel"${id ? ` id="${esc(id)}"` : ''}>`
    + `<div class="panel-head"><h2>${esc(title)}</h2>`
    + (right ? `<div class="right">${right}</div>` : '')
    + `</div><div class="panel-body${flush ? ' flush' : ''}">${body}</div></section>`;
}

/** Game-state badge. `state` is a Game.state: 'pre' | 'in' | 'post'. */
export function badge(state, detail = '') {
  if (state === 'in') {
    return '<span class="badge live"><span class="live-dot"></span>LIVE</span>';
  }
  if (state === 'post') return `<span class="badge final">${esc(detail || 'Final')}</span>`;
  return `<span class="badge">${esc(detail || 'Scheduled')}</span>`;
}

export function stateMsg(text, { spinner = false, retry = false } = {}) {
  return `<div class="state">${spinner ? '<div class="spinner"></div>' : ''}`
    + `<div>${esc(text)}</div>`
    + (retry ? '<button class="retry" data-act="retry">Try again</button>' : '')
    + '</div>';
}

/**
 * Inline sparkline. Returns '' for fewer than two usable points rather than a broken
 * svg with a single coordinate.
 */
export function sparkline(values, { w = 120, h = 22, stroke = 'var(--text-3)' } = {}) {
  // Nullish is dropped BEFORE coercion. Number(null) is 0, so coercing first would
  // draw a spurious dip to zero for a missing datapoint instead of skipping it.
  const vals = (values ?? [])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter(Number.isFinite);
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  // A flat series has zero span; dividing by it yields NaN coordinates.
  const span = max - min || 1;
  const step = w / (vals.length - 1);
  const pts = vals
    .map((v, i) => `${Math.round(i * step)},${Math.round(h - ((v - min) / span) * h)}`)
    .join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">`
    + `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.6"/></svg>`;
}

/** One row of the bidirectional team-stat comparison.
 *
 *  Values may be non-numeric ("18:04", "6/9"). The bar widths coerce to a number and
 *  fall back to 0, while the displayed text keeps the original string — that split is
 *  what keeps NaN out of the widths. */
export function cmpRow(label, left, right, leftColor, rightColor) {
  const n = (v) => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;
  const l = n(left);
  const r = n(right);
  const total = l + r;
  const lp = total ? Math.round((l / total) * 100) : 50;
  const rp = total ? 100 - lp : 50;
  return '<div class="cmp-row">'
    + `<span class="v l num">${esc(left)}</span>`
    + `<span class="cmp-bar l"><i style="width:${lp}%;background:${esc(leftColor)}"></i></span>`
    + `<span class="lbl">${esc(label)}</span>`
    + `<span class="cmp-bar"><i style="width:${rp}%;background:${esc(rightColor)}"></i></span>`
    + `<span class="v num">${esc(right)}</span>`
    + '</div>';
}

/**
 * The pane for a load that did not happen.
 *
 * ⚠️ A REFUSAL IS NOT A FAILURE, and answering one with "Try again" offers a
 * button that can never work. A viewer who picks "View Without Joining" grants
 * the plugin NOTHING — dissent-client's SidebarOrchestrator calls
 * `runGrant([], "view anonymously")` — so the node refuses every outbound call
 * for as long as that choice stands, and retrying simply re-refuses. Nine
 * surfaces in this hub made exactly that offer.
 *
 * So a refusal gets its own state: what is switched off, why, and the one route
 * that actually changes it. The wording matches the consent card's own footer
 * ("Revoke anytime in User Settings → Privacy") so the instruction names what
 * the user will actually see.
 */
export function errorPane(err, fallback = 'Could not load this.') {
  if (isPermissionDenied(err)) {
    return `<div class="state state-denied">
      <div><strong>Live data is off for you.</strong></div>
      <div class="muted">You opened this plugin without joining, which grants it no
        permissions — so it cannot fetch scores, stats or news. Nothing is broken.</div>
      <div class="tiny">To turn it on: User Settings → Privacy, revoke this plugin's
        entry, then reopen the channel and choose <strong>Join</strong>.</div>
    </div>`;
  }
  return stateMsg(fallback, { retry: true });
}
