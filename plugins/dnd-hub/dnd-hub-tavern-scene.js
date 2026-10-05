// dnd-hub-tavern-scene.js — the drawn tavern: a timbered hall, a roaring hearth, a bar of bottles, two lanterns
// and the tavern's sign. Shown when the DM opens a tavern without a picture/video of its own.
//
// Like the shop scene: one 2D canvas over the map, drawn at 60 % and scaled up by CSS, the still parts painted once
// per resize into an offscreen canvas, ~30 fps for the moving light. No allocation per frame beyond gradients.

let _raf = 0, _canvas = null, _ro = null;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** The parts that never move: walls, beams, hearth stones, the bar and its bottles, the floor. */
function paintStill(ctx, w, h) {
  const r = rng(11);
  // planked back wall
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#1a110a'); wall.addColorStop(0.7, '#120b06'); wall.addColorStop(1, '#0a0604');
  ctx.fillStyle = wall; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += w * 0.045) {
    ctx.fillStyle = `rgba(0,0,0,${0.18 + r() * 0.15})`; ctx.fillRect(x, 0, 1.5, h * 0.78);
    ctx.fillStyle = `rgba(255,190,120,${0.015 + r() * 0.02})`; ctx.fillRect(x + 2, 0, w * 0.04, h * 0.78);
  }
  // beams
  for (const [y, t] of [[0.06, 0.05], [0.4, 0.035]]) {
    ctx.fillStyle = '#24170c'; ctx.fillRect(0, h * y, w, h * t);
    ctx.fillStyle = 'rgba(255,190,120,.07)'; ctx.fillRect(0, h * y, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, h * (y + t), w, 3);
  }
  // hearth: a stone arch on the left
  const hx = w * 0.06, hw = w * 0.26, hy = h * 0.42, hh = h * 0.36;
  for (let y = hy; y < hy + hh; y += h * 0.035) {
    for (let x = hx + ((y / (h * 0.035)) % 2) * w * 0.012; x < hx + hw; x += w * 0.028) {
      const g = 38 + r() * 22;
      ctx.fillStyle = `rgb(${g + 6},${g},${g - 6})`;
      ctx.beginPath(); ctx.roundRect(x, y, w * 0.026, h * 0.032, 3); ctx.fill();
    }
  }
  ctx.fillStyle = '#060302';  // the fire mouth
  ctx.beginPath(); ctx.moveTo(hx + hw * 0.18, hy + hh);
  ctx.lineTo(hx + hw * 0.18, hy + hh * 0.38);
  ctx.quadraticCurveTo(hx + hw * 0.5, hy + hh * 0.05, hx + hw * 0.82, hy + hh * 0.38);
  ctx.lineTo(hx + hw * 0.82, hy + hh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a1b0e'; ctx.fillRect(hx - w * 0.01, hy - h * 0.02, hw + w * 0.02, h * 0.025);  // mantel
  // the bar on the right: shelves of bottles behind a counter
  const bx = w * 0.56, bw = w * 0.4;
  for (const y of [0.26, 0.36].map(f => f * h)) {
    ctx.fillStyle = '#2a1c10'; ctx.fillRect(bx, y, bw, h * 0.014);
    let x = bx + w * 0.01;
    while (x < bx + bw - w * 0.02) {
      const bwid = w * (0.009 + r() * 0.012), bh = h * (0.04 + r() * 0.045);
      const hue = r();
      ctx.fillStyle = hue < 0.33 ? '#1d2a17' : hue < 0.66 ? '#2d1810' : '#1a1a26';
      ctx.fillRect(x, y - bh, bwid, bh);
      ctx.fillRect(x + bwid * 0.3, y - bh * 1.35, bwid * 0.4, bh * 0.35);
      ctx.fillStyle = 'rgba(255,200,130,.16)'; ctx.fillRect(x + bwid * 0.2, y - bh * 0.85, 1.5, bh * 0.55);
      x += bwid * (1.4 + r());
    }
  }
  // barrels at the bar's end
  for (let i = 0; i < 3; i++) {
    const cx = bx + bw * (0.1 + i * 0.13), cy = h * 0.64, rx = w * 0.035, ry = h * 0.07;
    ctx.fillStyle = '#2b1a0c'; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#141008'; ctx.lineWidth = 3;
    for (const k of [-0.55, 0.55]) { ctx.beginPath(); ctx.ellipse(cx, cy + ry * k, rx * 0.93, ry * 0.12, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  // floorboards and the counter's front
  const fy = h * 0.78;
  const floor = ctx.createLinearGradient(0, fy, 0, h);
  floor.addColorStop(0, '#20140a'); floor.addColorStop(1, '#0c0703');
  ctx.fillStyle = floor; ctx.fillRect(0, fy, w, h - fy);
  for (let i = 0; i < 9; i++) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, fy + (h - fy) * (i / 9) ** 1.6, w, 1.5); }
  ctx.fillStyle = '#1f140a'; ctx.fillRect(bx - w * 0.02, h * 0.5, bw + w * 0.04, h * 0.28);
  ctx.fillStyle = 'rgba(255,190,110,.12)'; ctx.fillRect(bx - w * 0.02, h * 0.5, bw + w * 0.04, 3);
}

export function startTavernScene(wrap, name = '') {
  stopTavernScene();
  const canvas = document.createElement('canvas');
  canvas.id = 'lk-tavern-scene';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:45;pointer-events:none';
  wrap.appendChild(canvas);
  _canvas = canvas;
  const ctx = canvas.getContext('2d');
  const SCALE = 0.6;
  let w = 0, h = 0, still = null;
  const resize = () => {
    w = canvas.width = Math.round((wrap.clientWidth || 800) * SCALE);
    h = canvas.height = Math.round((wrap.clientHeight || 500) * SCALE);
    still = document.createElement('canvas'); still.width = w; still.height = h;
    paintStill(still.getContext('2d'), w, h);
  };
  resize();
  _ro = new ResizeObserver(resize); _ro.observe(wrap);

  const flames = Array.from({ length: 70 }, (_, i) => { const r = rng(300 + i); return { x: r(), life: r(), sp: 0.6 + r() * 0.8, s: 0.5 + r() }; });
  const embers = Array.from({ length: 26 }, (_, i) => { const r = rng(500 + i); return { x: r(), y: r(), v: 0.3 + r() * 0.7, p: r() * 6.28 }; });
  const haze = Array.from({ length: 5 }, (_, i) => { const r = rng(700 + i); return { x: r(), y: 0.15 + r() * 0.5, r: 0.18 + r() * 0.2, v: 0.004 + r() * 0.006 }; });

  let last = 0;
  const frame = (t) => {
    _raf = requestAnimationFrame(frame);
    if (t - last < 33) return;
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const time = t / 1000;
    const flick = 0.84 + 0.08 * Math.sin(time * 7.3) + 0.05 * Math.sin(time * 13.1 + 1) + 0.03 * Math.sin(time * 23.7);
    ctx.drawImage(still, 0, 0);

    // the fire's light over the whole room
    const fx = w * 0.19, fy = h * 0.72;
    let g = ctx.createRadialGradient(fx, fy, 0, fx, fy, Math.max(w, h) * 0.75 * flick);
    g.addColorStop(0, `rgba(255,140,50,${0.34 * flick})`); g.addColorStop(0.35, `rgba(200,80,20,${0.12 * flick})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // flames: additive blobs that rise, shrink and redden
    for (const f of flames) {
      f.life += dt * f.sp; if (f.life > 1) { f.life = 0; f.x = Math.random(); }
      const L = f.life, px = fx + (f.x - 0.5) * w * 0.1 * (1 - L) + Math.sin(time * 6 + f.x * 20) * w * 0.006 * L;
      const py = fy - L * h * 0.2, rad = h * 0.045 * f.s * (1 - L * 0.8);
      const fg = ctx.createRadialGradient(px, py, 0, px, py, rad);
      fg.addColorStop(0, `rgba(255,${200 - L * 120},${90 - L * 80},${0.5 * (1 - L)})`); fg.addColorStop(1, 'rgba(120,30,0,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(px, py, rad, 0, 6.283); ctx.fill();
    }
    // embers drifting up out of the chimney mouth
    for (const e of embers) {
      e.y -= e.v * dt * 0.25; if (e.y < 0) { e.y = 1; e.x = Math.random(); }
      const ex = fx + (e.x - 0.5) * w * 0.16 + Math.sin(time * 1.7 + e.p) * w * 0.01, ey = fy - (1 - e.y) * h * 0.5;
      ctx.fillStyle = `rgba(255,${150 + 60 * Math.sin(time * 5 + e.p)},60,${0.8 * e.y})`;
      ctx.fillRect(ex, ey, 1.6, 1.6);
    }
    // two lanterns over the bar
    for (const [lx, ph] of [[0.66, 0], [0.86, 2.1]]) {
      const x = w * lx, y = h * 0.16 + Math.sin(time * 0.9 + ph) * h * 0.004;
      const lf = 0.88 + 0.08 * Math.sin(time * 4.1 + ph) + 0.04 * Math.sin(time * 9.7 + ph);
      g = ctx.createRadialGradient(x, y, 0, x, y, h * 0.3 * lf);
      g.addColorStop(0, `rgba(255,200,120,${0.5 * lf})`); g.addColorStop(0.2, `rgba(255,150,60,${0.16 * lf})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - h * 0.3, y - h * 0.3, h * 0.6, h * 0.6);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const [lx, ph] of [[0.66, 0], [0.86, 2.1]]) {
      const x = w * lx, y = h * 0.16 + Math.sin(time * 0.9 + ph) * h * 0.004;
      ctx.strokeStyle = '#2d2013'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, h * 0.11); ctx.lineTo(x, y - h * 0.03); ctx.stroke();
      ctx.fillStyle = '#ffd38a'; ctx.fillRect(x - h * 0.012, y - h * 0.022, h * 0.024, h * 0.04);
      ctx.strokeStyle = '#3d2a14'; ctx.lineWidth = 2; ctx.strokeRect(x - h * 0.014, y - h * 0.026, h * 0.028, h * 0.048);
    }
    // pipe smoke and hearth haze
    for (const z of haze) {
      z.x += z.v * dt; if (z.x > 1.3) z.x = -0.3;
      g = ctx.createRadialGradient(z.x * w, z.y * h, 0, z.x * w, z.y * h, z.r * w);
      g.addColorStop(0, 'rgba(120,90,70,.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(z.x * w - z.r * w, z.y * h - z.r * w, z.r * w * 2, z.r * w * 2);
    }
    // the sign, swinging a little on its chains
    if (name) {
      const sx = w * 0.5, sy = h * 0.2, sw = Math.min(w * 0.36, h * 0.09 * name.length * 0.62 + h * 0.12), sh = h * 0.1;
      ctx.save(); ctx.translate(sx, h * 0.085); ctx.rotate(Math.sin(time * 0.7) * 0.012); ctx.translate(-sx, -h * 0.085);
      ctx.strokeStyle = '#4a3a22'; ctx.lineWidth = 1.5;
      for (const k of [-0.4, 0.4]) { ctx.beginPath(); ctx.moveTo(sx + sw * k, h * 0.085); ctx.lineTo(sx + sw * k, sy - sh / 2); ctx.stroke(); }
      ctx.fillStyle = '#3a2614'; ctx.beginPath(); ctx.roundRect(sx - sw / 2, sy - sh / 2, sw, sh, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(224,181,82,.55)'; ctx.lineWidth = 2; ctx.strokeRect(sx - sw / 2 + 4, sy - sh / 2 + 4, sw - 8, sh - 8);
      ctx.font = `700 ${Math.round(sh * 0.42)}px Cinzel, Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(240,200,110,${0.86 + 0.08 * flick})`; ctx.fillText(name, sx, sy + 1, sw - 16);
      ctx.restore();
    }
    // vignette
    g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  };
  _raf = requestAnimationFrame(frame);
}

/** The tavern's own picture or video, over the map (the DM chose one). */
export function startTavernMedia(wrap, url, mime = '') {
  stopTavernScene();
  const isVideo = /^video\//.test(mime) || /\.(mp4|webm|mov)(\?|$)/i.test(url);
  const el = document.createElement(isVideo ? 'video' : 'img');
  el.id = 'lk-tavern-scene';
  el.src = url;
  if (isVideo) Object.assign(el, { autoplay: true, loop: true, muted: true, playsInline: true });
  el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#070504;z-index:45;pointer-events:none';
  wrap.appendChild(el);
  _canvas = el;
}

export function stopTavernScene() {
  cancelAnimationFrame(_raf); _raf = 0;
  _ro?.disconnect(); _ro = null;
  _canvas?.remove(); _canvas = null;
}
