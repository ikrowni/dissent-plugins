// arm-wrestle.js — Arm Wrestle at a tavern table: two forearms, two candles, and a timing bar.
//
// Press (Space, click or tap) while the marker is in the bright band to push; miss and you give ground. Strength
// widens the band. Cheating: lift your elbow off the pad for a sudden heave (Sleight of Hand vs the host's eye).
// Rules: arm-wrestle-rules.js.
import { bandWidth, markerAt, press, nextBand, lean, clampP, boutResult, HOST_HEAVE, TIME_LIMIT } from './arm-wrestle-rules.js?v=20261015t';
import { guardFrame, useKit, el, btn, banner, coins, sleep, pick } from './kit.js?v=20261015t';
import { thump, chime, buzz, tick } from './tavern-sfx.js?v=20261015t';

const BARKS = {
  start: ['Elbows on the table. On three.', 'Don\'t blink.', 'Hope that arm\'s not just for show.'],
  heave: ['Hnngh!', 'Now you\'re mine!', 'Rrraagh!'], push: ['Oh-ho!', 'Not bad…', 'Is that all?'],
  win: ['…my arm. My poor arm. Take the coin.'], lose: ['And DOWN! Next!'], caught: ['Elbow off the pad! Cheat!'],
};

export async function play(root, ctx) {
  useKit();
  const wrap = el('div', 'tk-felt');
  wrap.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%;cursor:pointer;touch-action:none"></canvas>' +
    '<div style="position:absolute;bottom:12px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:8px">' +
    '<div class="tk-note aw-status" aria-live="polite">Press when the marker is in the bright band — Space, click or tap.</div><div class="tk-row aw-tricks"></div></div>';
  root.appendChild(wrap);
  const canvas = wrap.querySelector('canvas'), g = canvas.getContext('2d');
  const status = t => { wrap.querySelector('.aw-status').textContent = t; };
  const tricks = wrap.querySelector('.aw-tricks');

  let w = 0, h = 0;
  const resize = () => { const d = Math.min(2, devicePixelRatio || 1); w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * d; canvas.height = h * d; g.setTransform(d, 0, 0, d, 0, 0); };
  resize(); const ro = new ResizeObserver(resize); ro.observe(canvas);

  const S = { p: 0, band: { at: 0.5, width: bandWidth(ctx.edge) }, t: 0, flash: null, strain: 0, sweat: [], started: false, over: false, cheatUsed: false };
  let nextHeave = 3 + Math.random() * 3, last = performance.now(), raf = 0;

  let resolveBout;
  const bout = new Promise(r => { resolveBout = r; });
  const frame = guardFrame(now => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.started && !S.over) {
      S.t += dt;
      S.p = clampP(S.p + lean(ctx.setup.npcSkill, dt));
      if (S.t >= nextHeave) {
        S.p = clampP(S.p - (HOST_HEAVE[ctx.setup.npcSkill] ?? 0.12)); S.strain = 1; thump(0.5);
        ctx.say(pick(BARKS.heave)); nextHeave = S.t + 2.5 + Math.random() * 3.5;
      }
      const r = boutResult(S.p, S.t);
      if (r) { S.over = true; resolveBout(r); }
    }
    S.strain *= 0.93;
    drawScene(g, w, h, S, ctx.host.name);
    drawBar(g, w, h, S, S.started ? markerAt(S.t) : 0.5);
  });
  raf = requestAnimationFrame(frame);

  const onPress = e => {
    if (!S.started || S.over) return;
    if (e?.type === 'keydown') { if (e.code !== 'Space' || e.repeat || e.target.closest?.('input,textarea,button')) return; e.preventDefault(); }
    const r = press(markerAt(S.t), S.band);
    S.p = clampP(S.p + r.push);
    S.flash = { kind: r.kind, t: performance.now() };
    if (r.kind === 'miss') buzz(); else { thump(r.kind === 'perfect' ? 0.55 : 0.35); S.band = nextBand(S.band); S.strain = 0.6; }
    if (r.kind === 'perfect' && Math.random() < 0.3) ctx.say(pick(BARKS.push));
  };
  canvas.addEventListener('pointerdown', onPress);
  document.addEventListener('keydown', onPress);
  ctx.signal.addEventListener('abort', () => { S.over = true; resolveBout('abort'); }, { once: true });

  let caught = null;
  if (ctx.setup.cheating) tricks.appendChild(btn('🤫 Elbow off the pad', async () => {
    tricks.innerHTML = '';
    const res = await ctx.tryCheat();
    if (res?.caught) { caught = res; S.over = true; resolveBout('caught'); return; }
    if (res) { S.p = clampP(S.p + 0.3); S.strain = 1; thump(0.6); status(`Sleight of Hand ${res.total} — a sneaky heave, unseen.`); }
  }, { title: 'Sleight of Hand against the host\'s eye. Get caught, and you lose your bet.' }));

  try {
    ctx.say(pick(BARKS.start));
    for (const n of ['3', '2', '1']) { tick(0.25); await banner(wrap, n, '', 520); }
    banner(wrap, 'Wrestle!', '', 700);
    S.started = true; last = performance.now();
    const r = await bout;
    tricks.innerHTML = '';
    if (r === 'abort') return { won: false };
    if (r === 'caught') { ctx.say(pick(BARKS.caught)); status(`Sleight of Hand ${caught.total} against ${ctx.host.name}'s eye (${caught.perception}). Caught!`); await sleep(1400); return { won: false, caught: true }; }
    ctx.say(pick(r === 'hero' ? BARKS.win : BARKS.lose));
    if (r === 'hero') { chime(); coins(wrap, w / 2, h / 2, 26); } else if (r === 'host') thump(0.7);
    status(r === 'draw' ? `Time! Neither arm gives (${TIME_LIMIT} s).` : r === 'hero' ? 'Slammed it down!' : 'Your knuckles hit the table.');
    await sleep(1500);
    return { won: r === 'hero' ? true : r === 'draw' ? 'draw' : false };
  } finally {
    cancelAnimationFrame(raf); ro.disconnect();
    canvas.removeEventListener('pointerdown', onPress); document.removeEventListener('keydown', onPress);
  }
}

function drawScene(g, w, h, S, hostName) {
  // the table seen from above, lit by two candles
  const bg = g.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.7);
  bg.addColorStop(0, '#5a3618'); bg.addColorStop(1, '#170d05');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2;
  for (let y = h * 0.08; y < h; y += h * 0.11) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 4); g.stroke(); }
  const cx = w / 2, cy = h * 0.42, U = Math.min(w, h) / 600;
  const shake = S.strain * 3 * U;
  for (const side of [-1, 1]) {   // the candles where a losing hand would land
    const x = cx + side * 190 * U, y = cy + 6 * U;
    const fl = 0.85 + Math.random() * 0.15;
    const glow = g.createRadialGradient(x, y - 28 * U, 0, x, y - 28 * U, 110 * U);
    glow.addColorStop(0, `rgba(255,190,90,${0.35 * fl})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(x - 120 * U, y - 140 * U, 240 * U, 240 * U);
    g.fillStyle = '#e8dcc0'; g.fillRect(x - 9 * U, y - 22 * U, 18 * U, 34 * U);
    g.fillStyle = '#ffcf6a'; g.beginPath(); g.ellipse(x, y - 30 * U, 5 * U * fl, 11 * U * fl, 0, 0, 6.283); g.fill();
  }
  // the pads
  g.fillStyle = '#2a1608'; g.beginPath(); g.ellipse(cx, cy + 160 * U, 60 * U, 26 * U, 0, 0, 6.283); g.ellipse(cx, cy - 160 * U, 60 * U, 26 * U, 0, 0, 6.283); g.fill();
  // the arms: forearms from each elbow to the hands, which turn about the centre
  const ang = S.p * 1.05;
  const hand = { x: cx + Math.sin(ang) * 165 * U + (Math.random() - 0.5) * shake, y: cy + (1 - Math.cos(ang)) * 10 * U };
  arm(g, { x: cx, y: cy + 160 * U }, hand, U, ['#e2b48c', '#b77c52'], '#3d5a8a');      // the hero, sleeve blue
  arm(g, { x: cx, y: cy - 160 * U }, hand, U, ['#c48a62', '#8a5634'], '#5a2a1a');      // the host, sleeve red-brown
  // the clasp: two fists locked, knuckles up
  const cg = g.createRadialGradient(hand.x - 8 * U, hand.y - 10 * U, 4 * U, hand.x, hand.y, 40 * U);
  cg.addColorStop(0, '#f0c49c'); cg.addColorStop(1, '#a8714a');
  g.fillStyle = cg; g.beginPath(); g.ellipse(hand.x, hand.y, 40 * U, 34 * U, ang * 0.6, 0, 6.283); g.fill();
  g.fillStyle = 'rgba(120,70,40,.55)';
  for (let i = -1.5; i <= 1.5; i++) { g.beginPath(); g.ellipse(hand.x + i * 15 * U, hand.y - 18 * U, 7 * U, 5 * U, 0, 0, 6.283); g.fill(); }
  g.strokeStyle = 'rgba(90,50,25,.55)'; g.lineWidth = 2 * U;
  for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(hand.x - 26 * U, hand.y + i * 9 * U + 6 * U); g.quadraticCurveTo(hand.x, hand.y + i * 9 * U + 2 * U, hand.x + 26 * U, hand.y + i * 9 * U + 6 * U); g.stroke(); }
  // names at the elbows
  g.font = `700 ${Math.round(14 * U)}px Cinzel, Georgia, serif`; g.textAlign = 'center'; g.fillStyle = 'rgba(240,210,140,.85)';
  g.fillText(hostName, cx, cy - 196 * U); g.fillText('You', cx, cy + 212 * U);
  // the tug, as a rope of light from your candle to theirs
  if (S.flash && performance.now() - S.flash.t < 400) {
    const k = 1 - (performance.now() - S.flash.t) / 400;
    g.font = `800 ${Math.round(26 * U)}px Cinzel, Georgia, serif`;
    g.fillStyle = S.flash.kind === 'miss' ? `rgba(217,138,106,${k})` : `rgba(255,211,106,${k})`;
    g.fillText(S.flash.kind === 'perfect' ? 'Perfect!' : S.flash.kind === 'hit' ? 'Push!' : 'Slip!', hand.x, hand.y - 48 * U - (1 - k) * 20 * U);
  }
}

function arm(g, elbow, hand, U, [skin, shade], sleeve) {
  const dx = hand.x - elbow.x, dy = hand.y - elbow.y, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
  const wE = 42 * U, wH = 26 * U, bulge = 14 * U;
  const at = (k, side, wd) => ({ x: elbow.x + dx * k + nx * wd * side, y: elbow.y + dy * k + ny * wd * side });
  const grad = g.createLinearGradient(elbow.x + nx * wE, elbow.y + ny * wE, elbow.x - nx * wE, elbow.y - ny * wE);
  grad.addColorStop(0, shade); grad.addColorStop(0.35, skin); grad.addColorStop(1, shade);
  g.fillStyle = grad;
  g.beginPath();
  const a0 = at(0, 1, wE), m1 = at(0.35, 1, wE + bulge), a1 = at(1, 1, wH), b1 = at(1, -1, wH), m2 = at(0.4, -1, wE + bulge * 0.6), b0 = at(0, -1, wE);
  g.moveTo(a0.x, a0.y); g.quadraticCurveTo(m1.x, m1.y, a1.x, a1.y); g.lineTo(b1.x, b1.y); g.quadraticCurveTo(m2.x, m2.y, b0.x, b0.y); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(70,35,15,.35)'; g.lineWidth = 1.5 * U;   // a tendon down the forearm
  const t0 = at(0.15, 0.2, wE), t1 = at(0.85, 0.15, wH);
  g.beginPath(); g.moveTo(t0.x, t0.y); g.lineTo(t1.x, t1.y); g.stroke();
  g.fillStyle = sleeve; g.beginPath(); g.ellipse(elbow.x, elbow.y, 54 * U, 30 * U, Math.atan2(dy, dx) + Math.PI / 2, 0, 6.283); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3 * U; g.stroke();
}

function drawBar(g, w, h, S, marker) {
  const bw = Math.min(520, w * 0.6), x0 = (w - bw) / 2, y = h * 0.8, bh = 18;
  g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.roundRect(x0 - 4, y - 4, bw + 8, bh + 8, 8); g.fill();
  const b0 = x0 + (S.band.at - S.band.width / 2) * bw, b1 = b0 + S.band.width * bw;
  const band = g.createLinearGradient(b0, 0, b1, 0);
  band.addColorStop(0, 'rgba(224,181,82,.35)'); band.addColorStop(0.5, 'rgba(255,220,130,.95)'); band.addColorStop(1, 'rgba(224,181,82,.35)');
  g.fillStyle = band; g.fillRect(b0, y, b1 - b0, bh);
  const mx = x0 + marker * bw;
  g.fillStyle = '#fff'; g.shadowColor = '#ffd36a'; g.shadowBlur = 10; g.fillRect(mx - 2, y - 6, 4, bh + 12); g.shadowBlur = 0;
  // the tug meter: where the struggle stands, host on the left, you on the right
  const ty = y + 32, tw = bw;
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x0, ty, tw, 8);
  const mid = x0 + tw / 2, at = mid + S.p * tw / 2;
  g.fillStyle = S.p >= 0 ? '#7fbf6a' : '#c4542f'; g.fillRect(Math.min(mid, at), ty, Math.abs(at - mid), 8);
  g.fillStyle = '#efe4cc'; g.fillRect(mid - 1, ty - 3, 2, 14);
  g.font = '600 11px system-ui'; g.fillStyle = 'rgba(239,228,204,.6)'; g.textAlign = 'left'; g.fillText('theirs', x0, ty + 24); g.textAlign = 'right'; g.fillText('yours', x0 + tw, ty + 24);
  g.textAlign = 'center'; g.fillText(`${Math.max(0, Math.ceil(TIME_LIMIT - S.t))} s`, mid, ty + 24);
}
