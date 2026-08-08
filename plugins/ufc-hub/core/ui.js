// core/ui.js — shared pure render primitives.
//
// Every view composes these and every one returns an HTML STRING, never a node. That
// keeps views testable by parsing their output, and keeps rendering a single innerHTML
// write rather than a tree of appendChild calls.
//
// Interactivity is delegation-only: primitives emit data-act (and data-* payload)
// attributes, and core/app.js has the single listener. Inline onclick would work under
// this CSP, but it forces every handler into module scope and makes renders untestable.
//
// Copied from nfl-hub, minus its team-specific primitives: `chip` renders an NFL team
// logo, `legibleColor` exists to lift near-black NFL primaries off a dark background, and
// `sparkline`/`cmpRow` served the game-center charts. None has a UFC analogue.

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

/** Fight-state badge. `state` is 'pre' | 'in' | 'post'. */
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
