// kit.js — what every tavern game shares: its stylesheet, small helpers, banners, coin bursts, player chips, and the
// client side of a whole-table game (talking to the DM's Hub through ctx.send / ctx.onMessage; see table-runner.js).

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const pick = list => list[Math.floor(Math.random() * list.length)];
export const rint = (lo, hi, rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1));

/** A seeded random number generator (tests and the house's replays). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Load a stylesheet that sits next to `base` (a module's import.meta.url), once. */
export function loadCss(id, file, base) {
  if (document.getElementById(id)) return;
  document.head.appendChild(Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: new URL(file, base).href }));
}
export const useKit = () => loadCss('tk-css', './kit.css?v=20261015c', import.meta.url);

export function el(tag, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
export function btn(label, onclick, { primary = false, title = '' } = {}) {
  const b = el('button', 'tv-btn' + (primary ? ' primary' : ''), label);
  if (title) b.title = title;
  b.onclick = onclick;
  return b;
}

/** A big word across the table that fades ("Bullseye!", "Round 2"). */
export async function banner(root, text, sub = '', ms = 1300) {
  const b = el('div', 'tk-banner');
  b.innerHTML = '<b></b><span></span>';
  b.querySelector('b').textContent = text;
  b.querySelector('span').textContent = sub;
  root.appendChild(b);
  await sleep(ms);
  b.classList.add('out');
  await sleep(300);
  b.remove();
}

/** Coins bursting from a point in `root` (a win). */
export function coins(root, x, y, n = 18) {
  for (let i = 0; i < n; i++) {
    const c = el('div', 'tk-coin');
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, d = 60 + Math.random() * 120;
    c.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--r:${Math.random() * 720}deg;animation-delay:${i * 18}ms`;
    root.appendChild(c);
    setTimeout(() => c.remove(), 1400);
  }
}

/** A bone die's face (the pips come from kit.css). */
export const dieHtml = (f, cls = '') => `<div class="tk-die ${cls}" data-f="${f}">${'<i></i>'.repeat(9)}</div>`;

/** One chip per player at a whole-table game: initial, name, a line of their own, the one whose turn it is lit. */
export function chips(players, { me, active = [], line = () => '', out = () => false } = {}) {
  return '<div class="tk-chips">' + players.map(p => `<div class="tk-chip${p.id === me ? ' me' : ''}${active.includes(p.id) ? ' active' : ''}${out(p) ? ' out' : ''}" data-id="${p.id}">` +
    `<i>${esc((p.name || '?')[0])}</i><b>${esc(p.id === me ? 'You' : p.name)}</b><span>${line(p)}</span></div>`).join('') + '</div>';
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The client side of a whole-table game. Draws the lobby until the game starts, then calls `onState(state, prev)` on
 * every state the house sends; resolves with this hero's outcome (from the game's rules) when the game is over.
 * Returns { act(action), cheat(), done }.
 */
export function tableClient(root, ctx, rules, { onState, onCheated = () => {}, onRefused = () => {}, lobbyText = 'Pull up a stool…' }) {
  let prev = null, lobbyTimer = 0;
  const lobby = el('div', 'tk-lobby');
  root.appendChild(lobby);
  let resolve;
  const done = new Promise(r => { resolve = r; });
  ctx.onMessage((data) => {
    if (!data) return;
    if (data.kind === 'lobby') {
      clearInterval(lobbyTimer);
      const draw = () => {
        const s = Math.max(0, Math.ceil((data.startsAt - Date.now()) / 1000));
        lobby.innerHTML = `<h3>${esc(lobbyText)}</h3><p>${data.names.map(esc).join(', ')} ${data.names.length === 1 ? 'is' : 'are'} at the table.</p>` +
          `<div class="tk-count">${s || '…'}</div><p class="tk-dim">The game starts when the sand runs out. Others can still sit down.</p>`;
      };
      draw(); lobbyTimer = setInterval(draw, 250);
    } else if (data.kind === 'state' && data.state) {
      clearInterval(lobbyTimer); lobby.remove();
      const s = data.state;
      onState(s, prev);
      prev = s;
      if (rules.over(s) || s.players.find(p => p.id === ctx.me)?.gone) resolve(rules.outcome(s, ctx.me));
    } else if (data.kind === 'cheated') {
      onCheated(data);
      if (data.seatId === ctx.me && data.caught) resolve({ won: false, caught: true });
    } else if (data.kind === 'refused' && data.seatId === ctx.me) onRefused(data.reason);
  });
  ctx.signal.addEventListener('abort', () => { clearInterval(lobbyTimer); resolve({ won: false }); });
  ctx.send({ kind: 'hello' });
  return { act: action => ctx.send({ kind: 'act', action }), cheat: () => ctx.send({ kind: 'cheat' }), done };
}

/**
 * An animation frame that can never take the Hub down: the Hub shows any uncaught error over the whole screen, so
 * one bad frame (a race drawn a moment before it began) blanked the tavern. Logged once, and the next frame runs.
 */
export function guardFrame(fn) {
  let told = false;
  return t => { try { fn(t); } catch (e) { if (!told) { told = true; console.warn('[tavern game] a frame failed to draw:', e); } } };
}
