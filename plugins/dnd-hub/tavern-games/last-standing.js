// last-standing.js — Last One Standing at a tavern table: round after round, the whole table drinks (DM's Hub).
//
// Each round: keep your tankard steady for a few seconds (follow the ale's level with the mouse, or the arrow keys),
// then the house rolls everyone's Constitution save. Out, and you wake up poisoned (your sheet is told).
// Cheating: pour it in the plant pot (Sleight of Hand vs the host's eye). Rules: last-standing-rules.js.
import * as R from './last-standing-rules.js?v=20261014m';
import { guardFrame, useKit, loadCss, el, btn, banner, coins, sleep, pick, chips, tableClient, esc } from './kit.js?v=20261014m';
import { clack, chime, buzz, thump, tick } from './tavern-sfx.js?v=20261014m';

const STEADY_MS = 5000;
const BARKS = { start: ['Tankards up! Last one standing drinks free.', 'House brew. Strong as a mule\'s kick.'], caught: ['Feeding my plant? OUT!'] };

export async function play(root, ctx) {
  useKit();
  loadCss('ls-css', './last-standing.css?v=20261014m', import.meta.url);
  const wrap = el('div', 'tk-felt ls');
  wrap.innerHTML = `<div class="ls-top"></div><div class="ls-stage"><canvas class="ls-ale"></canvas><div class="ls-results" aria-live="polite"></div></div>
    <div class="tk-row ls-btns"></div><div class="tk-note ls-status" aria-live="polite"></div>`;
  root.appendChild(wrap);
  const $ = s => wrap.querySelector(s);
  let S = null, steadying = false, cheatUsed = false, poisoned = false;
  const me = () => S?.players.find(p => p.id === ctx.me);
  const nameOf = id => (id === ctx.me ? 'You' : S.players.find(p => p.id === id)?.name || '?');

  const drawTop = () => {
    $('.ls-top').innerHTML = chips(S.players, { me: ctx.me, active: R.toAct(S), out: p => p.out,
      line: p => (p.out ? 'under the table' : S.phase === 'steady' ? (p.steady == null ? 'drinking…' : 'done') : 'upright') });
  };
  const drawResults = () => {
    const box = $('.ls-results');
    if (S.phase !== 'results') { box.classList.remove('on'); return; }
    box.innerHTML = `<h3>Round ${S.round} · DC ${S.dc}</h3>` + S.rolls.map(r => `<div class="ls-roll ${r.pass ? 'pass' : 'fail'}">` +
      `<b>${esc(nameOf(r.id))}</b><span>${r.poured ? 'poured it in the plant pot' : `d20 ${r.d20} ${r.mod >= 0 ? '+' : '−'} ${Math.abs(r.mod)} CON ${r.bonus >= 0 ? '+' : '−'} ${Math.abs(r.bonus)} steady = <b>${r.total}</b>`}</span>` +
      `<i>${r.pass ? (r.saved ? 'last up' : 'still up') : 'down!'}</i></div>`).join('');
    box.classList.add('on');
  };

  /** The steadiness trial: follow the ale's level (a wandering bubble) for STEADY_MS; returns 0..1. */
  const steady = () => new Promise(resolve => {
    const canvas = $('.ls-ale'), g = canvas.getContext('2d');
    canvas.classList.add('on');
    const d = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * d; canvas.height = h * d; g.setTransform(d, 0, 0, d, 0, 0);
    const R0 = Math.min(w, h) * 0.42, cx = w / 2, cy = h / 2;
    const wobble = 0.5 + 0.12 * (S.round - 1);           // the room sways harder each round
    const bub = { x: 0, y: 0, vx: 0, vy: 0 }, hand = { x: 0, y: 0 }, keys = {};
    let inside = 0, total = 0, t0 = performance.now(), last = t0, raf = 0;
    const target = 0.28 * R0;
    const move = e => { const r = canvas.getBoundingClientRect(); hand.x = (e.clientX - r.left - cx) / R0; hand.y = (e.clientY - r.top - cy) / R0; };
    const key = e => { if (e.key.startsWith('Arrow')) { keys[e.key] = e.type === 'keydown'; e.preventDefault(); } };
    canvas.addEventListener('pointermove', move); document.addEventListener('keydown', key); document.addEventListener('keyup', key);
    const frame = guardFrame(now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      bub.vx += (Math.random() - 0.5) * wobble * 3 * dt - bub.x * 0.8 * dt; bub.vy += (Math.random() - 0.5) * wobble * 3 * dt - bub.y * 0.8 * dt;
      bub.vx *= 0.995; bub.vy *= 0.995; bub.x += bub.vx * dt * 2.2; bub.y += bub.vy * dt * 2.2;
      const m = Math.hypot(bub.x, bub.y); if (m > 0.75) { bub.x *= 0.75 / m; bub.y *= 0.75 / m; }
      hand.x += ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * dt * 0.9; hand.y += ((keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0)) * dt * 0.9;
      const off = Math.hypot(bub.x - hand.x, bub.y - hand.y) * R0;
      total += dt; if (off < target) inside += dt;
      drawAle(g, w, h, cx, cy, R0, bub, hand, off < target, (now - t0) / STEADY_MS, inside / Math.max(0.01, total));
      if (now - t0 < STEADY_MS && !ctx.signal.aborted) raf = requestAnimationFrame(frame);
      else {
        canvas.removeEventListener('pointermove', move); document.removeEventListener('keydown', key); document.removeEventListener('keyup', key);
        canvas.classList.remove('on'); resolve(inside / Math.max(0.01, total));
      }
    });
    raf = requestAnimationFrame(frame);
  });

  const drawButtons = () => {
    const b = $('.ls-btns'); b.innerHTML = '';
    const m = me();
    if (S.phase === 'steady' && m && !m.out && m.steady == null && !steadying) {
      b.appendChild(btn('Drink!', async () => {
        steadying = true; drawButtons(); clack();
        $('.ls-status').textContent = 'Keep your hand on the ale\'s level — follow the bubble with the mouse or the arrow keys.';
        const score = await steady();
        steadying = false;
        client.act({ type: 'steady', score: Math.round(score * 100) / 100 });
        $('.ls-status').textContent = `Steadiness ${Math.round(score * 100)}%. Waiting for the others…`;
      }, { primary: true }));
      if (ctx.setup.cheating && !cheatUsed) b.appendChild(btn('🤫 Pour it in the plant pot', () => { cheatUsed = true; client.cheat(); drawButtons(); }, { title: 'Sleight of Hand against the host\'s eye: pass this round without drinking' }));
    }
  };

  ctx.say(pick(BARKS.start));
  const client = tableClient(wrap, ctx, R, {
    lobbyText: 'Last One Standing — tankards up',
    onState: (s, prev) => {
      S = s;
      $('.ls-stage').style.setProperty('--sway', `${Math.min(3, (s.round - 1) * 0.5)}deg`);
      if (s.phase === 'steady' && (!prev || prev.round !== s.round)) { thump(0.4); banner(wrap, `Round ${s.round}`, `Constitution save, DC ${R.dcFor(s.round)}`, 1000); $('.ls-status').textContent = me()?.out ? 'You\'re under the table. Watch the rest.' : 'Your tankard is poured. Drink when you are ready.'; }
      if (s.phase === 'results' && prev?.phase !== 'results') {
        for (const r of s.rolls) if (!r.pass) { buzz(); break; }
        const mine = s.rolls.find(r => r.id === ctx.me);
        if (mine && !mine.pass && !poisoned) { poisoned = true; ctx.condition?.('Poisoned'); $('.ls-status').textContent = 'The room tips over. You wake up poisoned.'; }
      }
      drawTop(); drawResults(); drawButtons();
    },
    onCheated: d => {
      if (d.seatId !== ctx.me) return;
      $('.ls-status').textContent = d.caught ? `Sleight of Hand ${d.total} against the host's eye (${d.perception}). Caught!` : `Sleight of Hand ${d.total} — the plant drinks for you this round.`;
      if (d.caught) ctx.say(pick(BARKS.caught));
    },
    onRefused: reason => { $('.ls-status').textContent = reason; },
  });
  const out = await client.done;
  if (out.caught) { await sleep(1400); return out; }
  if (S) {
    await sleep(600);
    const up = S.players.filter(p => !p.out);
    if (out.won === true) { chime(); const r = wrap.getBoundingClientRect(); coins(wrap, r.width / 2, r.height / 2, 26); }
    await banner(wrap, out.won === true ? 'Last one standing!' : up.length === 1 ? `${nameOf(up[0].id)} stands alone` : 'Still standing, together', '', 1700);
  }
  return out;
}

function drawAle(g, w, h, cx, cy, R0, bub, hand, good, k, share) {
  g.clearRect(0, 0, w, h);
  // the tankard from above: pewter rim, dark ale, foam at the edge
  const rim = g.createRadialGradient(cx - R0 * 0.3, cy - R0 * 0.3, R0 * 0.2, cx, cy, R0 * 1.12);
  rim.addColorStop(0, '#d9dde0'); rim.addColorStop(1, '#5e6468');
  g.fillStyle = rim; g.beginPath(); g.arc(cx, cy, R0 * 1.1, 0, 6.283); g.fill();
  const tilt = { x: cx + (bub.x - hand.x) * R0 * 0.6, y: cy + (bub.y - hand.y) * R0 * 0.6 };
  const ale = g.createRadialGradient(tilt.x, tilt.y, R0 * 0.05, cx, cy, R0);
  ale.addColorStop(0, '#d89a3a'); ale.addColorStop(0.6, '#8a4a14'); ale.addColorStop(1, '#3a1a06');
  g.fillStyle = ale; g.beginPath(); g.arc(cx, cy, R0, 0, 6.283); g.fill();
  g.strokeStyle = 'rgba(255,248,230,.75)'; g.lineWidth = R0 * 0.08; g.beginPath(); g.arc(cx, cy, R0 * 0.95, 0, 6.283); g.stroke();
  // the level (the bubble to follow) and your hand
  const bx = cx + bub.x * R0, by = cy + bub.y * R0, hx = cx + hand.x * R0, hy = cy + hand.y * R0;
  g.fillStyle = 'rgba(255,250,235,.9)'; g.beginPath(); g.arc(bx, by, R0 * 0.07, 0, 6.283); g.fill();
  g.strokeStyle = good ? '#7fbf6a' : '#e0705a'; g.lineWidth = 3; g.beginPath(); g.arc(hx, hy, R0 * 0.28, 0, 6.283); g.stroke();
  g.beginPath(); g.moveTo(hx - 8, hy); g.lineTo(hx + 8, hy); g.moveTo(hx, hy - 8); g.lineTo(hx, hy + 8); g.stroke();
  // time and steadiness
  g.strokeStyle = 'rgba(224,181,82,.9)'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R0 * 1.18, -Math.PI / 2, -Math.PI / 2 + 6.283 * Math.min(1, k)); g.stroke();
  g.font = '700 14px Cinzel, Georgia, serif'; g.fillStyle = '#efe4cc'; g.textAlign = 'center'; g.shadowColor = "#000"; g.shadowBlur = 6; g.fillText(`Steady ${Math.round(share * 100)}%`, cx, cy + R0 * 0.72); g.shadowBlur = 0;
}
