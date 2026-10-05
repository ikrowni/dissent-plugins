// beetle-derby.js — Beetle Derby at a tavern table: back a beetle, then watch the race with everyone (DM's Hub).
//
// Pick a beetle (odds pay that many times your bet), then the house runs the race and every screen plays the same
// frames. Insight brings a whisper about one beetle. Cheating: slip your beetle a sugar cube (Sleight of Hand vs
// the host's eye, judged by the DM's Hub). Rules: beetle-derby-rules.js.
import * as R from './beetle-derby-rules.js?v=20261014g';
import { useKit, loadCss, el, btn, banner, coins, sleep, pick, chips, tableClient, esc } from './kit.js?v=20261014g';
import { tick, chime, thump } from './tavern-sfx.js?v=20261014g';

const BARKS = { start: ['Place your bets! Six shells, one chalk line.', 'Back a beetle, friend. Any beetle.'], caught: ['Feeding the runners? Disqualified — and so are you!'] };

export async function play(root, ctx) {
  useKit();
  loadCss('bd-css', './beetle-derby.css?v=20261014g', import.meta.url);
  const wrap = el('div', 'tk-felt bd');
  wrap.innerHTML = `<div class="bd-top"></div><canvas class="bd-track"></canvas><div class="bd-call" aria-live="polite"></div>
    <div class="bd-board"></div><div class="tk-row bd-btns"></div><div class="tk-note bd-status" aria-live="polite"></div>`;
  root.appendChild(wrap);
  const $ = s => wrap.querySelector(s);
  const canvas = $('.bd-track'), g = canvas.getContext('2d');
  let S = null, raf = 0, playT0 = 0, cheatUsed = false, lastLeader = -1;
  const me = () => S?.players.find(p => p.id === ctx.me);

  const frameAt = t => {
    if (!S?.frames) return Array(R.LANES).fill(0);
    const f = t / R.TICK_MS, i = Math.min(S.frames.length - 1, Math.floor(f)), k = Math.min(1, f - i);
    const a = S.frames[i], b = S.frames[Math.min(S.frames.length - 1, i + 1)];
    return a.map((x, j) => x + (b[j] - x) * k);
  };
  const draw = now => {
    raf = requestAnimationFrame(draw);
    const d = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
    g.setTransform(d, 0, 0, d, 0, 0);
    const racing = S?.phase === 'race' || S?.phase === 'done';
    const pos = racing ? frameAt(now - playT0) : Array(R.LANES).fill(0);
    drawTrack(g, w, h, S, pos, racing ? (now - playT0) / 1000 : now / 1000, me()?.pick);
    if (racing && S.phase === 'race') {
      const leader = pos.indexOf(Math.max(...pos));
      if (leader !== lastLeader && Math.max(...pos) > 0.08) {
        lastLeader = leader; tick(0.15);
        $('.bd-call').textContent = pick([`${S.beetles[leader].name} takes the lead!`, `It's ${S.beetles[leader].name} in front!`, `${S.beetles[leader].name} scuttles ahead!`]);
      }
    }
  };
  raf = requestAnimationFrame(draw);

  const drawBoard = () => {
    const m = me();
    const picking = S.phase === 'pick' && m && m.pick == null;
    $('.bd-top').innerHTML = chips(S.players, { me: ctx.me, active: R.toAct(S),
      line: p => (p.pick == null ? 'choosing…' : esc(S.beetles[p.pick].name)) });
    $('.bd-board').innerHTML = S.beetles.map(b => `<button class="bd-card${m?.pick === b.lane ? ' mine' : ''}${S.winner === b.lane && S.phase === 'done' ? ' won' : ''}" data-lane="${b.lane}" ${picking ? '' : 'disabled'}>` +
      `<i style="background:${b.shell}"></i><b>${esc(b.name)}</b><span class="bd-odds">pays ${b.odds}×</span>` +
      `<span class="bd-form" title="Form">${'★'.repeat(b.form)}${'☆'.repeat(5 - b.form)}</span></button>`).join('');
    const btns = $('.bd-btns'); btns.innerHTML = '';
    if (S.phase === 'pick' && m && ctx.setup.cheating && !cheatUsed) btns.appendChild(btn('🤫 Slip it a sugar cube', () => { cheatUsed = true; ctx.send({ kind: 'cheat' }); drawBoard(); }, { title: 'Sleight of Hand against the host\'s eye: your beetle runs keener' }));
    $('.bd-status').textContent = S.phase === 'pick'
      ? (m?.pick == null ? (S.whispers?.[ctx.me] || 'Back a beetle: odds pay that many times your bet.') : 'Your bet is down. Waiting for the others…')
      : S.phase === 'race' ? '' : '';
  };
  wrap.addEventListener('click', e => {
    const c = e.target.closest('.bd-card');
    if (c && !c.disabled) { thump(0.3); client.act({ type: 'pick', beetle: Number(c.dataset.lane) }); }
  });

  ctx.say(pick(BARKS.start));
  const client = tableClient(wrap, ctx, R, {
    lobbyText: 'Beetle Derby — bets are open',
    onState: (s, prev) => {
      S = s;
      if (s.phase === 'race' && prev?.phase !== 'race') { playT0 = performance.now(); lastLeader = -1; banner(wrap, 'And they\'re off!', '', 900); }
      drawBoard();
    },
    onCheated: d => {
      if (d.seatId !== ctx.me) return;
      $('.bd-status').textContent = d.caught ? `Sleight of Hand ${d.total} against the host's eye (${d.perception}). Caught!` : `Sleight of Hand ${d.total} — a sugar cube, unseen. Your beetle will run keen.`;
      if (d.caught) ctx.say(pick(BARKS.caught));
    },
    onRefused: reason => { $('.bd-status').textContent = reason; },
  });
  const out = await client.done;
  try {
    if (out.caught) { await sleep(1400); return out; }
    if (S?.winner != null) {
      const b = S.beetles[S.winner];
      $('.bd-call').textContent = `${b.name} wins!`;
      if (out.won === true) { chime(); const r = wrap.getBoundingClientRect(); coins(wrap, r.width / 2, r.height / 3, 30); }
      await banner(wrap, `${b.name} wins!`, out.won === true ? `Your beetle! It pays ${b.odds}×.` : me()?.pick != null ? `Your ${S.beetles[me().pick].name} trailed in.` : '', 1800);
    }
    return out;
  } finally { cancelAnimationFrame(raf); }
}

function drawTrack(g, w, h, S, pos, t, mine) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#4a3018'); bg.addColorStop(1, '#2e1c0c');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const x0 = Math.min(150, w * 0.2), x1 = w - 40, lh = h / R.LANES;
  g.strokeStyle = 'rgba(240,230,210,.35)'; g.lineWidth = 2; g.setLineDash([10, 8]);
  for (let i = 1; i < R.LANES; i++) { g.beginPath(); g.moveTo(x0, i * lh); g.lineTo(x1, i * lh); g.stroke(); }
  g.setLineDash([]);
  g.strokeStyle = 'rgba(240,230,210,.8)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, h); g.stroke();
  for (let y = 0; y < h; y += 12) { g.fillStyle = (y / 12) % 2 ? '#f0e6d2' : '#1a1008'; g.fillRect(x1, y, 8, 12); g.fillStyle = (y / 12) % 2 ? '#1a1008' : '#f0e6d2'; g.fillRect(x1 + 8, y, 8, 12); }
  if (!S) return;
  for (const b of S.beetles) {
    const y = (b.lane + 0.5) * lh, x = x0 + (x1 - x0 - 30) * pos[b.lane] - 14;
    if (mine === b.lane) { g.fillStyle = 'rgba(224,181,82,.12)'; g.fillRect(0, b.lane * lh, w, lh); }
    g.font = '700 12px Cinzel, Georgia, serif'; g.fillStyle = mine === b.lane ? '#ffd36a' : 'rgba(240,230,210,.75)'; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText(b.name, x0 - 34, y); g.textBaseline = 'alphabetic';
    beetle(g, x, y, Math.min(lh * 0.32, 20), b.shell, t * 18 + b.lane, b.lane + 1);
  }
}

function beetle(g, x, y, r, shell, phase, n) {
  g.save(); g.translate(x, y);
  g.strokeStyle = '#1a0e06'; g.lineWidth = Math.max(1.5, r * 0.12);
  for (let i = -1; i <= 1; i++) for (const side of [-1, 1]) {           // six legs, scuttling
    const sw = Math.sin(phase + i * 2 + (side > 0 ? 1.5 : 0)) * r * 0.25;
    g.beginPath(); g.moveTo(i * r * 0.5, 0); g.lineTo(i * r * 0.5 + sw, side * r * 0.95); g.stroke();
  }
  g.beginPath(); g.moveTo(r * 1.2, -r * 0.2); g.lineTo(r * 1.6, -r * 0.6); g.moveTo(r * 1.2, r * 0.2); g.lineTo(r * 1.6, r * 0.6); g.stroke(); // antennae
  g.fillStyle = '#1a0e06'; g.beginPath(); g.ellipse(r * 0.95, 0, r * 0.38, r * 0.33, 0, 0, 6.283); g.fill();                             // head
  const sh = g.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r * 1.1);
  sh.addColorStop(0, '#fff8'); sh.addColorStop(0.25, shell); sh.addColorStop(1, '#0a0503');
  g.fillStyle = sh; g.beginPath(); g.ellipse(0, 0, r, r * 0.72, 0, 0, 6.283); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-r, 0); g.lineTo(r * 0.8, 0); g.stroke();                   // the shell's split
  g.fillStyle = '#f0e6d2'; g.font = `700 ${Math.round(r * 0.7)}px Cinzel, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), -r * 0.3, -r * 0.02);
  g.restore(); g.textBaseline = 'alphabetic';
}
