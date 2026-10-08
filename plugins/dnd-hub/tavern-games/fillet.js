// fillet.js — Five-Finger Fillet at a tavern table: a hand spread on the wood, a knife, and a quickening beat.
//
// A ring closes on the gap to strike; strike it as the ring meets it (keys 1–6 or A S D F G H, or click the gap).
// The host runs first; beat their count before your third miss. Cheating: get the crowd to slow the count.
// Rules: fillet-rules.js.
import { MISSES, targetGap, bpm, beatTimes, retime, windowFor, judge, hostStrikes, result } from './fillet-rules.js?v=20261015u';
import { guardFrame, useKit, el, btn, banner, coins, sleep, pick } from './kit.js?v=20261015u';
import { thunk, tick, buzz, chime } from './tavern-sfx.js?v=20261015u';

const KEYS = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, a: 0, s: 1, d: 2, f: 3, g: 4, h: 5 };
const BARKS = {
  start: ['Keep your fingers. You\'ll miss them.', 'Watch me first. Then you.'],
  host: ['Child\'s play.', 'Tap-tap-tap.'], ouch: ['Ooh. That\'ll scar.', 'Count your fingers!', 'Blood on my table…'],
  win: ['Quick hands. Take it.'], lose: ['Fingers and coin — keep one of them.'], caught: ['Paying the drummer to slow down? Out!'],
};

export async function play(root, ctx) {
  useKit();
  const wrap = el('div', 'tk-felt');
  wrap.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%;cursor:pointer;touch-action:none"></canvas>' +
    '<div style="position:absolute;bottom:12px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:8px">' +
    '<div class="tk-note ff-status" aria-live="polite"></div><div class="tk-row ff-tricks"></div></div>';
  root.appendChild(wrap);
  const canvas = wrap.querySelector('canvas'), g = canvas.getContext('2d');
  const status = t => { wrap.querySelector('.ff-status').textContent = t; };
  const tricks = wrap.querySelector('.ff-tricks');
  let w = 0, h = 0;
  const resize = () => { const d = Math.min(2, devicePixelRatio || 1); w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * d; canvas.height = h * d; g.setTransform(d, 0, 0, d, 0, 0); };
  resize(); const ro = new ResizeObserver(resize); ro.observe(canvas);

  const win = windowFor(ctx.edge);
  const S = { mode: 'host', hits: 0, misses: 0, beat: 0, times: [], t0: 0, knife: { gap: 0, stab: 0 }, nicks: [], flashes: [], hostTarget: hostStrikes(ctx.setup.npcSkill), slowedFrom: Infinity, ouch: null };
  const geo = () => {
    const U = Math.min(w / 1000, h / 660), cx = w / 2, base = h * 0.8;
    // gap x positions across the spread hand, outside thumb (0) to outside little finger (5)
    const xs = [-235, -150, -52, 30, 112, 205].map(x => cx + x * U);
    return { U, cx, base, xs, gy: base - 200 * U };
  };

  let raf = 0;
  const frame = guardFrame(now => {
    raf = requestAnimationFrame(frame);
    const G = geo(), t = (now - S.t0) / 1000;
    drawTable(g, w, h);
    for (const n of S.nicks) { g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(n.x - 4, n.y - 3); g.lineTo(n.x + 4, n.y + 3); g.stroke(); }
    drawHand(g, G, S.ouch && now - S.ouch.t < 500 ? S.ouch.finger : -1);
    if (S.mode === 'hero' && S.times.length) {
      const bt = S.times[S.beat], tg = targetGap(S.beat), x = G.xs[tg];
      const lead = 60 / bpm(S.beat, S.beat >= S.slowedFrom);
      const k = Math.max(0, Math.min(1, (bt - t) / lead));
      g.strokeStyle = `rgba(255,211,106,${0.35 + 0.6 * (1 - k)})`; g.lineWidth = 3;
      g.beginPath(); g.arc(x, G.gy, 16 * G.U + k * 70 * G.U, 0, 6.283); g.stroke();
      g.fillStyle = 'rgba(255,211,106,.25)'; g.beginPath(); g.arc(x, G.gy, 16 * G.U, 0, 6.283); g.fill();
    }
    const ks = Math.max(0, 1 - (now - S.knife.stab) / 140);
    drawKnife(g, G.xs[S.knife.gap], G.gy - 8 * G.U - (1 - ks) * 60 * G.U, G.U);
    for (const f of S.flashes) {
      const k = (now - f.t) / 600; if (k > 1) continue;
      g.globalAlpha = 1 - k; g.font = `800 ${Math.round(22 * G.U)}px Cinzel, Georgia, serif`; g.textAlign = 'center';
      g.fillStyle = f.kind === 'miss' ? '#e0705a' : '#ffd36a'; g.fillText(f.kind === 'perfect' ? 'Perfect' : f.kind === 'hit' ? 'Tak!' : 'Miss!', f.x, G.gy - 70 * G.U - k * 24); g.globalAlpha = 1;
    }
    drawHud(g, w, S, ctx.host.name, S.mode === 'hero' ? bpm(S.beat, S.beat >= S.slowedFrom) : null);
  });
  raf = requestAnimationFrame(frame);

  const strikeAt = (gap, kind) => {
    const G = geo();
    S.knife = { gap, stab: performance.now() };
    if (kind !== 'miss') { thunk(); S.nicks.push({ x: G.xs[gap] + (Math.random() - 0.5) * 10, y: G.gy + (Math.random() - 0.5) * 8 }); if (S.nicks.length > 60) S.nicks.shift(); }
    S.flashes.push({ kind, x: G.xs[gap], t: performance.now() });
  };

  // ── the host's run, quick and showy ──
  ctx.say(pick(BARKS.start));
  status(`${ctx.host.name} spreads a hand on the table…`);
  await sleep(700);
  for (let b = 0; b < S.hostTarget; b++) {
    if (ctx.signal.aborted) { cancelAnimationFrame(raf); ro.disconnect(); return { won: false }; }
    strikeAt(targetGap(b), 'hit'); tick(0.08);
    await sleep(Math.max(70, 210 - b * 4));
  }
  ctx.say(pick(BARKS.host));
  await banner(wrap, `${S.hostTarget} strikes`, `${ctx.host.name}'s run. Beat it.`, 1500);

  // ── the hero's run ──
  S.mode = 'hero'; S.nicks = []; S.knife = { gap: 0, stab: 0 };
  S.times = beatTimes(400);
  status('Strike the gap the ring closes on: keys 1–6 (or A–H), or click it.');
  let resolveRun;
  const run = new Promise(r => { resolveRun = r; });
  let caught = null;
  if (ctx.setup.cheating) tricks.appendChild(btn('🤫 Slow the count', async () => {
    tricks.innerHTML = '';
    const res = await ctx.tryCheat();
    if (res?.caught) { caught = res; resolveRun('caught'); return; }
    if (res) { S.slowedFrom = S.beat + 1; S.times = retime(S.times, S.beat); status(`Sleight of Hand ${res.total} — a coin to the drummer, and the count slows.`); }
  }, { title: 'Sleight of Hand against the host\'s eye. Get caught, and you lose your bet.' }));
  S.t0 = performance.now();
  const resolveBeat = kind => {
    const gap = targetGap(S.beat);
    if (kind === 'miss') {
      S.misses++; buzz(); S.ouch = { finger: Math.min(4, Math.max(0, gap - 1)), t: performance.now() };
      if (Math.random() < 0.4) ctx.say(pick(BARKS.ouch));
    } else S.hits++;
    S.beat++;
    if (S.misses >= MISSES || S.hits > S.hostTarget + 40) resolveRun('done');
  };
  const onKey = e => {
    if (e.target.closest?.('input,textarea')) return;
    const gap = KEYS[e.key?.toLowerCase()];
    if (gap == null) return;
    e.preventDefault(); strike(gap);
  };
  const onClick = e => {
    const r = canvas.getBoundingClientRect(), G = geo(), x = e.clientX - r.left;
    let best = 0; G.xs.forEach((gx, i) => { if (Math.abs(gx - x) < Math.abs(G.xs[best] - x)) best = i; });
    strike(best);
  };
  const strike = gap => {
    if (S.misses >= MISSES) return;
    const t = (performance.now() - S.t0) / 1000, dt = t - S.times[S.beat];
    if (dt < -win * 2.5) return; // far too early: ignored, not punished
    const kind = judge(gap, targetGap(S.beat), dt, win);
    strikeAt(gap, kind);
    resolveBeat(kind);
  };
  document.addEventListener('keydown', onKey); canvas.addEventListener('pointerdown', onClick);
  const lateCheck = setInterval(() => {   // a beat that passes with no strike is a miss
    const t = (performance.now() - S.t0) / 1000;
    if (S.mode === 'hero' && S.misses < MISSES && t - S.times[S.beat] > win) { S.flashes.push({ kind: 'miss', x: geo().xs[targetGap(S.beat)], t: performance.now() }); resolveBeat('miss'); }
  }, 20);
  ctx.signal.addEventListener('abort', () => resolveRun('abort'), { once: true });
  const end = await run;
  clearInterval(lateCheck); document.removeEventListener('keydown', onKey); canvas.removeEventListener('pointerdown', onClick);
  tricks.innerHTML = '';
  try {
    if (end === 'abort') return { won: false };
    if (end === 'caught') { ctx.say(pick(BARKS.caught)); status(`Sleight of Hand ${caught.total} against ${ctx.host.name}'s eye (${caught.perception}). Caught!`); await sleep(1400); return { won: false, caught: true }; }
    const r = result(S.hits, S.hostTarget);
    ctx.say(pick(r === 'hero' ? BARKS.win : BARKS.lose));
    if (r === 'hero') { chime(); coins(wrap, w / 2, h / 2, 26); }
    await banner(wrap, `${S.hits} strikes`, r === 'hero' ? `You beat ${ctx.host.name}'s ${S.hostTarget}.` : r === 'draw' ? `Level with ${ctx.host.name}.` : `${ctx.host.name} had ${S.hostTarget}.`, 1600);
    return { won: r === 'hero' ? true : r === 'draw' ? 'draw' : false };
  } finally { cancelAnimationFrame(raf); ro.disconnect(); }
}

function drawTable(g, w, h) {
  const bg = g.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.max(w, h) * 0.75);
  bg.addColorStop(0, '#5c3a1a'); bg.addColorStop(1, '#160c05');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 1.5;
  for (let x = 0; x < w; x += 70) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 10, h * 0.3, x - 10, h * 0.6, x + 4, h); g.stroke(); }
}

function drawHand(g, G, hurt) {
  const { U, cx, base } = G;
  const skin = g.createLinearGradient(0, base - 320 * U, 0, base);
  skin.addColorStop(0, '#e9bd97'); skin.addColorStop(1, '#b97e56');
  const line = 'rgba(80,40,20,.45)';
  g.lineWidth = 2 * U;
  // fingers first (their roots tuck under the palm): [anchor x, anchor y above the wrist, lean, length, width]
  const fingers = [[-120, 90, -1.0, 112, 32], [-80, 140, -0.22, 150, 27], [-10, 145, -0.04, 172, 28], [65, 140, 0.1, 156, 27], [135, 128, 0.3, 122, 24]];
  g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 14 * U; g.shadowOffsetY = 6 * U;
  fingers.forEach(([x, y, rot, len, wd], i) => {
    g.save(); g.translate(cx + x * U, base - y * U); g.rotate(rot);
    g.fillStyle = i === hurt ? '#e0705a' : skin; g.strokeStyle = line;
    g.beginPath(); g.roundRect(-wd * U / 2, -len * U, wd * U, len * U + 30 * U, wd * U / 2); g.fill(); g.stroke();
    g.shadowColor = 'transparent';
    g.fillStyle = 'rgba(255,240,230,.6)'; g.beginPath(); g.ellipse(0, -len * U + 15 * U, wd * U * 0.32, 11 * U, 0, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(80,40,20,.3)';
    for (const k of [0.38, 0.68]) { g.beginPath(); g.moveTo(-wd * U * 0.28, -len * U * k); g.quadraticCurveTo(0, -len * U * k + 3 * U, wd * U * 0.28, -len * U * k); g.stroke(); }
    g.restore();
  });
  // the palm over the roots, and the wrist down off the bottom
  g.fillStyle = skin; g.strokeStyle = line;
  g.beginPath(); g.moveTo(cx - 140 * U, base - 95 * U);
  g.quadraticCurveTo(cx - 150 * U, base - 175 * U, cx - 70 * U, base - 170 * U);
  g.quadraticCurveTo(cx + 20 * U, base - 182 * U, cx + 155 * U, base - 150 * U);
  g.quadraticCurveTo(cx + 175 * U, base - 60 * U, cx + 100 * U, base + 10 * U);
  g.lineTo(cx + 95 * U, base + 120 * U); g.lineTo(cx - 105 * U, base + 120 * U); g.lineTo(cx - 110 * U, base + 10 * U);
  g.quadraticCurveTo(cx - 135 * U, base - 30 * U, cx - 140 * U, base - 95 * U); g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(80,40,20,.25)'; g.lineWidth = 2 * U;   // knuckle creases
  for (const x of [-75, -8, 62, 122]) { g.beginPath(); g.arc(cx + x * U, base - 150 * U, 10 * U, 3.6, 5.8); g.stroke(); }
}

function drawKnife(g, x, y, U) {
  g.save(); g.translate(x, y); g.rotate(0.05);
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 10; g.shadowOffsetY = 6;
  const blade = g.createLinearGradient(-10 * U, 0, 10 * U, 0);
  blade.addColorStop(0, '#8e98a2'); blade.addColorStop(0.5, '#eef2f5'); blade.addColorStop(1, '#7c8690');
  g.fillStyle = blade; g.beginPath(); g.moveTo(0, 0); g.lineTo(-9 * U, -22 * U); g.lineTo(-8 * U, -95 * U); g.lineTo(8 * U, -95 * U); g.lineTo(9 * U, -22 * U); g.closePath(); g.fill();
  g.fillStyle = '#9a7a3a'; g.fillRect(-20 * U, -100 * U, 40 * U, 8 * U);
  g.fillStyle = '#4a2a14'; g.beginPath(); g.roundRect(-8 * U, -160 * U, 16 * U, 60 * U, 6 * U); g.fill();
  g.fillStyle = '#c9a050'; g.beginPath(); g.arc(0, -162 * U, 9 * U, 0, 6.283); g.fill();
  g.restore();
}

function drawHud(g, w, S, hostName, beatsPerMin) {
  g.font = '700 15px Cinzel, Georgia, serif'; g.textAlign = 'left'; g.fillStyle = '#e0b552';
  g.fillText(S.mode === 'host' ? `${hostName}'s run` : `Your strikes: ${S.hits}`, 24, 34);
  g.font = '600 12px system-ui'; g.fillStyle = 'rgba(239,228,204,.75)';
  if (S.mode === 'hero') g.fillText(`To beat: ${S.hostTarget}${beatsPerMin ? ` · ${beatsPerMin} beats a minute` : ''}`, 24, 54);
  g.textAlign = 'right';
  for (let i = 0; i < MISSES; i++) {   // three drops: red once spent
    const x = w - 30 - i * 26, y = 30;
    g.fillStyle = i < S.misses ? '#c42f1f' : 'rgba(239,228,204,.18)';
    g.beginPath(); g.moveTo(x, y - 12); g.quadraticCurveTo(x + 10, y + 2, x, y + 8); g.quadraticCurveTo(x - 10, y + 2, x, y - 12); g.fill();
  }
}

