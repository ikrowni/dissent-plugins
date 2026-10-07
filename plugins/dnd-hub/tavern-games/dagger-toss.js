// dagger-toss.js — Dagger Toss: three daggers each at a painted board on the tavern wall, the hero against the host.
//
// Aim with the mouse (or arrow keys), hold to build power (or Space), let go to throw. The hand sways less with
// Dexterity. Cheating: loosen the board's pin so the host's daggers wander (Sleight of Hand vs the host's eye).
// Rules: dagger-toss-rules.js.
import { THROWS, RINGS, SWEET, scoreAt, swayAmp, sway, powerAt, heroLanding, hostLanding, winner } from './dagger-toss-rules.js?v=20261015f';
import { guardFrame, useKit, el, btn, banner, coins, sleep, pick } from './kit.js?v=20261015f';
import { whoosh, thunk, chime, buzz } from './tavern-sfx.js?v=20261015f';

const BARKS = {
  start: ['Three daggers. Mind the barmaid.', 'Closest to the heart takes it.', 'Don\'t hit the lantern this time.'],
  heroGood: ['Lucky.', 'Hm. Not bad.', 'That\'ll do.'], heroBad: ['Ha! The wall thanks you.', 'Were you aiming at me?'],
  hostGood: ['Watch and learn.', 'Heart. As always.'], hostBad: ['…the board moved.', 'My elbow slipped.'],
  win: ['Fine throwing. Take your coin.'], lose: ['The board likes me better.'], caught: ['Hands off my board, cheat!'],
  loosened: ['Board looks a little crooked…'],
};

export async function play(root, ctx) {
  useKit();
  const wrap = el('div', 'tk-felt');
  wrap.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none"></canvas>' +
    '<div class="dt-top" style="position:absolute;top:10px;left:0;right:0"></div>' +
    '<div class="dt-bottom" style="position:absolute;bottom:12px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:8px">' +
    '<div class="tk-note dt-status" aria-live="polite"></div><div class="tk-row dt-tricks"></div></div>';
  root.appendChild(wrap);
  const canvas = wrap.querySelector('canvas'), g = canvas.getContext('2d');
  const status = wrap.querySelector('.dt-status'), tricks = wrap.querySelector('.dt-tricks'), top = wrap.querySelector('.dt-top');
  const S = { hero: [], host: [], stuck: [], aim: { x: 0, y: 0 }, reticle: null, power: null, shake: 0, flight: null, loosened: false, cheatUsed: false, floats: [] };
  const amp = swayAmp(ctx.edge);

  let w = 0, h = 0, cx = 0, cy = 0, R = 0, wall = null;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2; cy = h * 0.5; R = Math.min(w * 0.3, h * 0.34);
    wall = paintWall(w, h, dpr);
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  const toBoard = (px, py) => ({ x: (px - cx) / R, y: (py - cy) / R });
  const toPx = p => ({ x: cx + p.x * R, y: cy + p.y * R });

  const scoreboard = () => {
    const row = (who, list) => `<div style="display:flex;gap:6px;align-items:center;justify-content:center"><b style="font:700 12px var(--lk-title);color:var(--lk-gold);min-width:110px;text-align:right">${who}</b>` +
      Array.from({ length: THROWS }, (_, i) => `<span style="min-width:30px;text-align:center;padding:2px 6px;border-radius:5px;background:rgba(0,0,0,.4);font:700 13px var(--lk-title);color:${list[i] == null ? 'var(--lk-dim)' : 'var(--lk-text)'}">${list[i] ?? '·'}</span>`).join('') +
      `<b style="font:800 18px var(--lk-title);min-width:44px">${list.reduce((t, v) => t + v, 0)}</b></div>`;
    top.innerHTML = row('You', S.hero) + '<div style="height:4px"></div>' + row(ctx.host.name, S.host);
  };
  scoreboard();

  // ── drawing ──
  let raf = 0, t0 = performance.now();
  const frame = guardFrame(now => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    g.drawImage(wall, 0, 0, w, h);
    const sh = S.shake > 0 ? (Math.random() - 0.5) * S.shake : 0;
    S.shake *= 0.86;
    drawBoard(g, cx + sh, cy, R);
    for (const d of S.stuck) drawDagger(g, cx + sh + d.x * R, cy + d.y * R, R, d.who, d.tilt, 1);
    if (S.flight) {
      const f = S.flight, k = Math.min(1, (now - f.t) / 380), e = 1 - (1 - k) ** 3;
      const from = { x: cx + (f.who === 'hero' ? 0 : w * 0.25), y: h + 60 }, to = toPx(f.to);
      const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e - Math.sin(k * Math.PI) * h * 0.12;
      drawDagger(g, x, y, R, f.who, f.tilt + (1 - k) * 6, 1 + (1 - e) * 2.2);
    }
    if (S.reticle) {
      const sw = sway(t, S.reticle.amp), p = toPx({ x: S.aim.x + sw.x, y: S.aim.y + sw.y });
      S.reticle.at = { x: S.aim.x + sw.x, y: S.aim.y + sw.y };
      g.strokeStyle = S.reticle.host ? 'rgba(240,120,90,.6)' : 'rgba(255,230,160,.9)'; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, 14, 0, 6.283); g.stroke();
      g.beginPath(); g.moveTo(p.x - 22, p.y); g.lineTo(p.x - 6, p.y); g.moveTo(p.x + 6, p.y); g.lineTo(p.x + 22, p.y);
      g.moveTo(p.x, p.y - 22); g.lineTo(p.x, p.y - 6); g.moveTo(p.x, p.y + 6); g.lineTo(p.x, p.y + 22); g.stroke();
    }
    if (S.power) drawPower(g, cx + R * 1.28, cy, R, powerAt((now - S.power) / 1000));
    for (const f of S.floats) {
      const k = (now - f.t) / 1100;
      if (k > 1) continue;
      const p = toPx(f.at);
      g.globalAlpha = 1 - k; g.font = `800 ${Math.round(R * 0.13)}px Cinzel, Georgia, serif`; g.textAlign = 'center';
      g.fillStyle = f.pts >= 25 ? '#ffd36a' : f.pts ? '#efe4cc' : '#d98a6a';
      g.fillText(f.pts ? `+${f.pts}` : 'Miss', p.x, p.y - 26 - k * 30); g.globalAlpha = 1;
    }
  });
  raf = requestAnimationFrame(frame);

  const land = async (who, at) => {
    S.flight = { who, to: at, t: performance.now(), tilt: (Math.random() - 0.5) * 0.6 };
    whoosh();
    await sleep(380);
    S.flight = null;
    const { pts, name } = scoreAt(at.x, at.y);
    if (pts) { S.stuck.push({ ...at, who, tilt: (Math.random() - 0.5) * 0.6 }); thunk(); S.shake = 10; }
    else buzz();
    S.floats.push({ at, pts, t: performance.now() });
    S[who].push(pts);
    scoreboard();
    if (pts === 50) { const p = toPx(at); coins(wrap, p.x, p.y, 14); banner(wrap, 'The Heart!', who === 'hero' ? 'Straight through.' : `${ctx.host.name} hits it dead centre.`); }
    return { pts, name };
  };

  // ── the hero's throw: move to aim, hold to build power, let go to throw ──
  const heroThrow = () => new Promise(resolve => {
    S.reticle = { amp };
    let pressed = false, done = false;
    status.textContent = 'Aim, then hold to wind up — let go to throw.' + (amp < 0.35 ? ' (Your Dexterity steadies your hand.)' : '');
    const down = e => { if (done || pressed) return; e?.preventDefault?.(); pressed = true; S.power = performance.now(); };
    const up = () => {
      if (done || !pressed) return;
      done = true; cleanup();
      const power = powerAt((performance.now() - S.power) / 1000);
      const at = S.reticle.at || S.aim;
      S.power = null; S.reticle = null;
      resolve(heroLanding({ x: 0, y: 0 }, at, power));
    };
    const move = e => { const r = canvas.getBoundingClientRect(); const p = toBoard(e.clientX - r.left, e.clientY - r.top); S.aim = { x: Math.max(-1.3, Math.min(1.3, p.x)), y: Math.max(-1.3, Math.min(1.3, p.y)) }; };
    const keys = e => {
      if (e.target.closest?.('input,textarea')) return;
      const k = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] }[e.key];
      if (k) { e.preventDefault(); S.aim = { x: S.aim.x + k[0], y: S.aim.y + k[1] }; }
      if (e.code === 'Space' && e.type === 'keydown' && !e.repeat) down(e);
      if (e.code === 'Space' && e.type === 'keyup') up();
    };
    const onAbort = () => { if (done) return; done = true; cleanup(); S.power = null; S.reticle = null; resolve(null); };
    S.cancel = onAbort; // a caught cheat ends the throw
    function cleanup() {
      canvas.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); canvas.removeEventListener('pointermove', move);
      document.removeEventListener('keydown', keys); document.removeEventListener('keyup', keys); ctx.signal.removeEventListener('abort', onAbort);
    }
    canvas.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); canvas.addEventListener('pointermove', move);
    document.addEventListener('keydown', keys); document.addEventListener('keyup', keys); ctx.signal.addEventListener('abort', onAbort);
    S.aim = { x: 0, y: 0 };
  });

  const cheatButton = () => {
    tricks.innerHTML = '';
    if (!ctx.setup.cheating || S.cheatUsed) return;
    tricks.appendChild(btn('🤫 Loosen the board pin', async () => {
      S.cheatUsed = true; tricks.innerHTML = '';
      status.textContent = 'You lean on the wall and work the pin loose…';
      const res = await ctx.tryCheat();
      if (res?.caught) { S.caught = res; S.cancel?.(); return; }
      if (res) { S.loosened = true; status.textContent = `Sleight of Hand ${res.total} — nobody saw. The board hangs crooked for ${ctx.host.name}.`; ctx.say(pick(BARKS.loosened)); }
    }, { title: 'Sleight of Hand against the host\'s eye. Get caught, and you lose your bet.' }));
  };

  const hostThrow = async () => {
    status.textContent = `${ctx.host.name} takes aim…`;
    S.reticle = { amp: 0.25, host: true }; S.aim = { x: 0, y: 0 };
    await sleep(900 + Math.random() * 600);
    S.reticle = null;
    return land('host', hostLanding(ctx.setup.npcSkill, Math.random, S.loosened));
  };

  ctx.say(pick(BARKS.start));
  try {
    for (let i = 0; i < THROWS; i++) {
      await banner(wrap, `Dagger ${i + 1} of ${THROWS}`, '', 800);
      cheatButton();
      const at = await heroThrow();
      tricks.innerHTML = '';
      if (S.caught) { ctx.say(pick(BARKS.caught)); status.textContent = `Sleight of Hand ${S.caught.total} against ${ctx.host.name}'s eye (${S.caught.perception}). Caught!`; await sleep(1400); return { won: false, caught: true }; }
      if (!at || ctx.signal.aborted) return { won: false };
      const r = await land('hero', at);
      ctx.say(pick(r.pts >= 10 ? BARKS.heroGood : BARKS.heroBad));
      status.textContent = r.pts ? `${r.name || 'Ring'}: ${r.pts}.` : 'Off the board!';
      await sleep(700);
      const hr = await hostThrow();
      ctx.say(pick(hr.pts >= 25 ? BARKS.hostGood : hr.pts <= 2 ? BARKS.hostBad : BARKS.heroGood));
      await sleep(800);
    }
    const w = winner(S.hero, S.host);
    ctx.say(pick(w === 'hero' ? BARKS.win : BARKS.lose));
    if (w === 'hero') { chime(); coins(wrap, cx, cy, 24); }
    await sleep(1200);
    return { won: w === 'hero' ? true : w === 'draw' ? 'draw' : false };
  } finally {
    cancelAnimationFrame(raf); ro.disconnect();
  }
}

// ── painting ──

function paintWall(w, h, dpr) {
  const c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#2a1a0d'); bg.addColorStop(1, '#140c06');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  let seed = 9; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < w; x += 46) {
    g.fillStyle = `rgba(${40 + r() * 20},${24 + r() * 12},${12 + r() * 8},.55)`; g.fillRect(x, 0, 44, h);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x + 44, 0, 2, h);
    for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`; g.fillRect(x + r() * 40, r() * h, 1, 30 + r() * 80); }
  }
  const lamp = g.createRadialGradient(w / 2, h * 0.2, 0, w / 2, h * 0.45, Math.max(w, h) * 0.7);
  lamp.addColorStop(0, 'rgba(255,170,80,.22)'); lamp.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = lamp; g.fillRect(0, 0, w, h);
  return c;
}

function drawBoard(g, cx, cy, R) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 30; g.shadowOffsetY = 12;
  g.fillStyle = '#3b240f'; g.beginPath(); g.arc(cx, cy, R * 1.12, 0, 6.283); g.fill();
  g.restore();
  // rim with brass studs
  const rim = g.createRadialGradient(cx, cy - R * 0.3, R * 0.9, cx, cy, R * 1.12);
  rim.addColorStop(0, '#5a3818'); rim.addColorStop(1, '#2a180a');
  g.fillStyle = rim; g.beginPath(); g.arc(cx, cy, R * 1.1, 0, 6.283); g.fill();
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * 6.283;
    g.fillStyle = '#c9a050'; g.beginPath(); g.arc(cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05, R * 0.018, 0, 6.283); g.fill();
  }
  // rings, outside in, each in segments of two colours
  const colours = [['#e9dcc0', '#2c1b10'], ['#b2301f', '#e9dcc0'], ['#e9dcc0', '#1d130c'], ['#2f6a3a', '#e9dcc0']];
  const radii = [1, 0.7, 0.42, 0.18];
  radii.forEach((rad, ri) => {
    for (let s = 0; s < 20; s++) {
      g.fillStyle = colours[ri][s % 2];
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * rad, s / 20 * 6.283 - 0.157, (s + 1) / 20 * 6.283 - 0.157); g.closePath(); g.fill();
    }
    g.strokeStyle = '#b8913f'; g.lineWidth = Math.max(1.2, R * 0.008); g.beginPath(); g.arc(cx, cy, R * rad, 0, 6.283); g.stroke();
  });
  const heart = g.createRadialGradient(cx - R * 0.02, cy - R * 0.02, 0, cx, cy, R * RINGS[0][0]);
  heart.addColorStop(0, '#ff6b4a'); heart.addColorStop(1, '#8a140c');
  g.fillStyle = heart; g.beginPath(); g.arc(cx, cy, R * RINGS[0][0], 0, 6.283); g.fill();
  g.strokeStyle = '#ffd36a'; g.lineWidth = 2; g.stroke();
  // worn wood grain over the paint
  g.globalAlpha = 0.08; g.strokeStyle = '#000';
  for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(cx - R, cy + i * R * 0.15); g.bezierCurveTo(cx - R * 0.3, cy + i * R * 0.15 + 6, cx + R * 0.3, cy + i * R * 0.15 - 6, cx + R, cy + i * R * 0.15); g.stroke(); }
  g.globalAlpha = 1;
  // each ring's value, on a small plate at twelve o'clock in the ring itself
  g.font = `700 ${Math.round(R * 0.06)}px Cinzel, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  [[0.125, 25], [0.3, 10], [0.56, 5], [0.85, 2]].forEach(([d, v]) => {
    const x = cx, y = cy - R * d;
    g.fillStyle = 'rgba(20,12,6,.82)'; g.beginPath(); g.roundRect(x - R * 0.055, y - R * 0.038, R * 0.11, R * 0.076, 4); g.fill();
    g.fillStyle = '#f0d184'; g.fillText(String(v), x, y + 1);
  });
  g.textBaseline = 'alphabetic';
}

function drawDagger(g, x, y, R, who, tilt, scale) {
  g.save(); g.translate(x, y); g.rotate(-0.5 + tilt); g.scale(scale, scale);
  const L = R * 0.26;
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 6; g.shadowOffsetY = 4;
  g.fillStyle = '#d8dde2'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-L * 0.06, -L * 0.18); g.lineTo(L * 0.06, -L * 0.18); g.closePath(); g.fill(); // blade stub
  g.fillStyle = '#9a7a3a'; g.fillRect(-L * 0.2, -L * 0.24, L * 0.4, L * 0.06);                                                                // guard
  g.fillStyle = who === 'hero' ? '#7a4a1a' : '#2e2420'; g.fillRect(-L * 0.055, -L * 0.62, L * 0.11, L * 0.38);                                 // grip
  g.strokeStyle = who === 'hero' ? '#e0b552' : '#8a6a5a'; g.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-L * 0.055, -L * (0.28 + i * 0.07)); g.lineTo(L * 0.055, -L * (0.31 + i * 0.07)); g.stroke(); }
  g.fillStyle = who === 'hero' ? '#e0b552' : '#9a8a7a'; g.beginPath(); g.arc(0, -L * 0.66, L * 0.07, 0, 6.283); g.fill();                   // pommel
  g.restore();
}

function drawPower(g, x, cy, R, p) {
  const H = R * 1.5, W = Math.max(12, R * 0.06), top = cy - H / 2;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x - W / 2 - 3, top - 3, W + 6, H + 6);
  g.fillStyle = 'rgba(127,191,106,.35)'; g.fillRect(x - W / 2, top + H * (1 - SWEET - 0.06), W, H * 0.12);
  const fill = g.createLinearGradient(0, top + H, 0, top); fill.addColorStop(0, '#6aa3d9'); fill.addColorStop(0.7, '#e0b552'); fill.addColorStop(1, '#c4542f');
  g.fillStyle = fill; g.fillRect(x - W / 2, top + H * (1 - p), W, H * p);
  g.fillStyle = '#efe4cc'; g.font = `700 ${Math.round(R * 0.06)}px Cinzel, Georgia, serif`; g.textAlign = 'center'; g.fillText('POWER', x, top - 10);
}
