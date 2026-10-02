// dnd-hub-shop-scene.js — the default shop backdrop: a lantern-lit counter, drawn in code and looping.
//
// Replaces the 17 MB ShopKeeper.mp4 placeholder (never referenced, too big to mirror). Shown when the DM
// opens a shop that has no video of its own. A 2D canvas over the map rather than a Pixi layer, so it
// always fills the view whatever the zoom/pan. Light on CPU: one canvas, ~50 motes, no allocation per frame.

let _raf = 0, _canvas = null, _ro = null;

// Deterministic "random" so the shelves are the same for everyone and every time.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function drawShelves(ctx, w, h) {
  const r = rng(7);
  const shelfY = [0.31, 0.46, 0.61].map(f => f * h);
  ctx.save();
  for (const y of shelfY) {
    ctx.fillStyle = '#2a1c10'; ctx.fillRect(w * 0.08, y, w * 0.84, h * 0.018);
    ctx.fillStyle = 'rgba(255,200,120,.08)'; ctx.fillRect(w * 0.08, y, w * 0.84, 2);
    // jars, bottles and books in silhouette, sitting on the shelf
    let x = w * 0.1;
    while (x < w * 0.88) {
      const kind = r();
      const bw = w * (0.018 + r() * 0.03), bh = h * (0.05 + r() * 0.07);
      ctx.fillStyle = `rgba(${18 + r() * 14},${12 + r() * 8},${8 + r() * 6},1)`;
      if (kind < 0.4) {                       // bottle: body + neck
        ctx.fillRect(x, y - bh, bw, bh);
        ctx.fillRect(x + bw * 0.35, y - bh - bh * 0.35, bw * 0.3, bh * 0.35);
      } else if (kind < 0.7) {                // jar: rounded
        ctx.beginPath(); ctx.roundRect(x, y - bh * 0.75, bw * 1.2, bh * 0.75, bw * 0.3); ctx.fill();
      } else {                                // books
        for (let i = 0; i < 3; i++) ctx.fillRect(x + i * bw * 0.4, y - bh * (0.8 + r() * 0.3), bw * 0.35, bh * (0.8 + r() * 0.3));
      }
      // a glint of glass catching the lantern
      if (r() < 0.35) { ctx.fillStyle = 'rgba(255,190,110,.10)'; ctx.fillRect(x + bw * 0.15, y - bh * 0.9, 2, bh * 0.6); }
      x += bw * (1.3 + r() * 0.9);
    }
  }
  ctx.restore();
}

export function startShopScene(wrap, name = '') {
  stopShopScene();
  const canvas = document.createElement('canvas');
  canvas.id = 'lk-shop-scene';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:45;pointer-events:none';
  wrap.appendChild(canvas);
  _canvas = canvas;
  const ctx = canvas.getContext('2d');

  // Drawn at 60 % resolution and up-scaled by CSS: it is all soft light, and full-canvas
  // gradients every frame are the cost on a machine without much GPU.
  const SCALE = 0.6;
  let w = 0, h = 0, shelves = null;
  const resize = () => {
    w = canvas.width = Math.round((wrap.clientWidth || 800) * SCALE);
    h = canvas.height = Math.round((wrap.clientHeight || 500) * SCALE);
    shelves = document.createElement('canvas');
    shelves.width = w; shelves.height = h;
    drawShelves(shelves.getContext('2d'), w, h);
  };
  resize();
  _ro = new ResizeObserver(resize); _ro.observe(wrap);

  const motes = Array.from({ length: 50 }, (_, i) => {
    const r = rng(100 + i);
    return { x: r(), y: r(), s: 0.5 + r() * 1.6, v: 0.004 + r() * 0.01, p: r() * Math.PI * 2 };
  });

  let last = 0;
  const frame = (t) => {
    _raf = requestAnimationFrame(frame);
    if (t - last < 33) return; // ~30 fps is plenty for a flicker
    last = t;
    const time = t / 1000;
    // flicker: two slow waves plus a little jitter, kept between ~0.75 and 1
    const flick = 0.86 + 0.07 * Math.sin(time * 2.1) + 0.04 * Math.sin(time * 5.3 + 1.7) + 0.03 * Math.sin(time * 11.9);
    const lx = w * 0.5, ly = h * 0.17;

    // back wall
    const wall = ctx.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, '#120c07'); wall.addColorStop(1, '#070504');
    ctx.fillStyle = wall; ctx.fillRect(0, 0, w, h);
    // the lantern's pool of light on the wall
    const pool = ctx.createRadialGradient(lx, ly + h * 0.12, 0, lx, ly + h * 0.12, Math.max(w, h) * 0.62 * flick);
    pool.addColorStop(0, `rgba(255,170,80,${0.30 * flick})`);
    pool.addColorStop(0.45, `rgba(170,90,35,${0.12 * flick})`);
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pool; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(shelves, 0, 0);

    // counter
    const cy = h * 0.72;
    ctx.fillStyle = '#1d130b'; ctx.fillRect(0, cy, w, h - cy);
    ctx.fillStyle = `rgba(255,190,110,${0.18 * flick})`; ctx.fillRect(0, cy, w, 3);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    for (let x = w * 0.04; x < w; x += w * 0.16) ctx.fillRect(x, cy + 8, 2, h - cy - 8);  // panel seams

    // chain and lantern
    ctx.strokeStyle = '#3a2a16'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, ly - h * 0.05); ctx.stroke();
    const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, h * 0.16 * flick);
    glow.addColorStop(0, `rgba(255,220,140,${0.95 * flick})`);
    glow.addColorStop(0.25, `rgba(255,160,60,${0.55 * flick})`);
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(lx, ly, h * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b1d0e';
    ctx.fillRect(lx - h * 0.03, ly - h * 0.055, h * 0.06, h * 0.012);                // cap
    ctx.fillRect(lx - h * 0.025, ly + h * 0.04, h * 0.05, h * 0.01);                  // base
    ctx.strokeStyle = '#4a3420'; ctx.lineWidth = Math.max(1.5, h * 0.004);
    ctx.strokeRect(lx - h * 0.022, ly - h * 0.043, h * 0.044, h * 0.083);             // frame

    // dust in the light
    for (const m of motes) {
      m.y -= m.v * 0.02; if (m.y < 0) { m.y = 1; }
      const mx = (m.x + Math.sin(time * 0.3 + m.p) * 0.01) * w, my = m.y * h;
      const near = Math.max(0, 1 - Math.hypot(mx - lx, my - ly) / (h * 0.7));
      ctx.fillStyle = `rgba(255,210,150,${(0.15 + 0.5 * near) * (0.6 + 0.4 * Math.sin(time * 2 + m.p))})`;
      ctx.fillRect(mx, my, m.s, m.s);
    }

    // vignette
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.7)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);

    if (name) {
      ctx.font = `600 ${Math.round(h * 0.045)}px Cinzel, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(224,181,82,${0.85 + 0.1 * flick})`;
      ctx.fillText(name, w / 2, cy + h * 0.13);
    }
  };
  _raf = requestAnimationFrame(frame);
}

export function stopShopScene() {
  cancelAnimationFrame(_raf); _raf = 0;
  _ro?.disconnect(); _ro = null;
  _canvas?.remove(); _canvas = null;
}
