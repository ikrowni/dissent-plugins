// ul-render.js — one frame: the backdrop, a darkness mask with every light's lit area cut out of it (walls cast
// shadows), the room and the silhouettes, then what shows through the dark (lantern cores, eyes, every attack's
// tell). Plain 2D canvas: the mock showed it is enough (spec §13.1).
import { VIEW_H, SWING, TELL } from './ul-const.js';
import { makeLights, visPoly, lightLevel, handPos, LANTERN_RGB } from './ul-light.js';
import { buildBackdrop, drawBackdrop } from './ul-backdrop.js';
import { drawTiles } from './ul-tiles.js';
import { drawLamplighter, drawLanternCage, ENEMY_SHAPES, TELL_OF, EYES } from './ul-figures.js';
import { ATTACK_STATES } from './ul-combat.js';
import { Particles } from './ul-particles.js';
import { rng } from './ul-rng.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.g = canvas.getContext('2d');
    this.mask = document.createElement('canvas'); this.m = this.mask.getContext('2d');
    this.v = { W: 0, H: 0, S: 1, VW: 0, camL: 0, camT: 0, dpr: 1 };
    this.cam = null; this.fx = new Particles(); this.reduced = false; this.B = null;
  }

  /** A new room: a fresh backdrop and camera. */
  setRoom(S) { this.B = buildBackdrop(S.room, rng(99)); this.cam = null; this.fx = new Particles(); }

  resize() {
    const r = this.canvas.getBoundingClientRect(), v = this.v;
    v.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * v.dpr)), h = Math.max(1, Math.round(r.height * v.dpr));
    if (w !== v.W || h !== v.H) { v.W = this.canvas.width = this.mask.width = w; v.H = this.canvas.height = this.mask.height = h; }
    v.S = v.H / VIEW_H; v.VW = v.W / v.S;
  }

  frame(S, dt, events) {
    const g = this.g, v = this.v, p = S.player, room = S.room;
    this.resize();
    this.fx.take(events, this.reduced); this.fx.step(dt);
    const pc = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    // camera: follow with a little look-ahead, clamped to the room
    const tx = pc.x + p.face * 50, ty = pc.y - 30;
    if (!this.cam) this.cam = { x: tx, y: ty };
    const k = 1 - Math.exp(-dt * 6);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    v.camL = v.VW > room.w ? -(v.VW - room.w) / 2 : clamp(this.cam.x - v.VW / 2, 0, room.w - v.VW);
    v.camT = clamp(this.cam.y - VIEW_H / 2, 0, Math.max(0, room.h - VIEW_H));
    const sh = this.fx.shake, sx = sh ? (Math.random() * 2 - 1) * sh : 0, sy = sh ? (Math.random() * 2 - 1) * sh : 0;

    drawBackdrop(g, this.B, room, v, S.t, VIEW_H);
    const L = makeLights(S), amt = this.reduced ? 0.006 : 0.02;
    for (const l of L) l.r *= 1 + Math.sin(S.t * 13 + l.x * 0.07) * amt + Math.sin(S.t * 31 + l.y) * amt * 0.6;
    const vis = L.filter((l) => l.x > v.camL - l.r && l.x < v.camL + v.VW + l.r && l.y > v.camT - l.r && l.y < v.camT + VIEW_H + l.r);
    for (const l of vis) l.poly = visPoly(S.segs, l.x, l.y, l.r);
    const world = (c) => c.setTransform(v.S, 0, 0, v.S, (-v.camL + sx) * v.S, (-v.camT + sy) * v.S);

    // the darkness mask: black, with each light's lit area (its shadowed polygon) cut out
    const m = this.m;
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'source-over'; m.fillStyle = '#000'; m.fillRect(0, 0, v.W, v.H);
    m.globalCompositeOperation = 'destination-out'; world(m);
    for (const l of vis) {
      const gr = m.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.92)'); gr.addColorStop(0.8, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = gr; polyPath(m, l.poly); m.fill();
    }
    const dark = p.oil <= 0 ? Math.min(0.99, S.T.dark + 0.07) : S.T.dark;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = dark * 0.62; g.drawImage(this.mask, 0, 0); g.globalAlpha = 1;
    world(g);
    // warmth inside each light, on the backdrop only, so the figures in front stay black
    g.globalCompositeOperation = 'lighter';
    for (const l of vis) {
      if (l.kind === 'ember') continue;
      const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.9);
      gr.addColorStop(0, `rgba(${l.rgb[0]},${l.rgb[1]},${l.rgb[2]},0.22)`); gr.addColorStop(0.35, `rgba(${l.rgb[0]},${l.rgb[1]},${l.rgb[2]},0.1)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; polyPath(g, l.poly); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    drawTiles(g, room, vis, v);
    if (S.exit) drawStairs(g, S.exit);
    for (const s of S.sconces) { // brackets
      g.fillStyle = '#050505'; g.fillRect(s.x - 6, s.y + 4, 12, 3); g.fillRect(s.x - 1.5, s.y + 4, 3, 10);
      g.beginPath(); g.moveTo(s.x - 5, s.y + 4); g.lineTo(s.x - 3, s.y - 4); g.lineTo(s.x + 3, s.y - 4); g.lineTo(s.x + 5, s.y + 4); g.fill();
    }
    for (const e of S.enemies) { // a Shade outside the light is only its eyes
      if (e.dead || !this.onScreen(e)) continue;
      e.vis = e.kind === 'shade' ? clamp(lightLevel(room, vis, e.x + e.w / 2, e.y + e.h / 2).v * 3, 0, 1) : 1;
      g.globalAlpha = e.vis;
      rimAndFill(g, vis, e.x + e.w / 2, e.y + e.h / 2, () => ENEMY_SHAPES[e.kind](g, e, S.T), e.flash > 0 ? '#3a2f2a' : '#030304');
      g.globalAlpha = 1;
    }
    if (!p.dead || p.deadT < 1) {
      const st = { air: !p.onGround && !p.hang, hang: Boolean(p.hang), roll: p.rollT > 0 ? 1 - p.rollT / S.T.rollTime : 0, block: p.blocking,
        atk: p.atkT > 0 ? { prog: 1 - p.atkT / SWING, n: p.atkN } : null };
      g.globalAlpha = p.inv > 0 && Math.floor(S.t * 20) % 2 ? 0.55 : 1;
      if (p.dead) { g.save(); g.translate(pc.x, p.y + p.h); g.rotate(-p.face * Math.min(1.5, p.deadT * 4)); g.translate(-pc.x, -(p.y + p.h)); }
      rimAndFill(g, vis, pc.x, pc.y, () => drawLamplighter(g, pc.x, p.y + p.h, p.face, p.phase, clamp(Math.abs(p.vx) / S.T.run, 0, 1), st, S.t), '#030304');
      if (p.dead) g.restore();
      g.globalAlpha = 1;
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = dark * 0.8; g.drawImage(this.mask, 0, 0); g.globalAlpha = 1;
    world(g);
    this.afterDark(S, vis, pc);
    this.edgeMarks(S);
    if (p.oil <= 0 || p.hurtT > 0) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      const vg = g.createRadialGradient(v.W / 2, v.H / 2, v.H * 0.2, v.W / 2, v.H / 2, v.H * 0.75);
      const a = p.hurtT > 0 ? 0.35 : 0.3 + Math.sin(S.t * 6) * 0.08;
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, p.hurtT > 0 ? `rgba(120,10,10,${a})` : `rgba(0,0,0,${a + 0.4})`);
      g.fillStyle = vg; g.fillRect(0, 0, v.W, v.H);
    }
  }

  onScreen(e) { const v = this.v; return e.x + e.w > v.camL - 60 && e.x < v.camL + v.VW + 60 && e.y + e.h > v.camT - 60 && e.y < v.camT + VIEW_H + 60; }

  /** Drawn over the darkness: flames, oil, the lantern, every attack's tell glow, eyes, the blade's arc, motes, sparks. */
  afterDark(S, L, pc) {
    const g = this.g, p = S.player, v = this.v;
    for (const s of S.sconces) {
      if (s.lit) {
        const fl = 1 + (this.reduced ? 0 : Math.sin(S.t * 17 + s.x) * 0.15);
        g.save(); g.shadowColor = '#ffb060'; g.shadowBlur = 18; g.fillStyle = '#ffd59a';
        g.beginPath(); g.ellipse(s.x, s.y - 6, 3 * fl, 6 * fl, 0, 0, Math.PI * 2); g.fill(); g.restore();
      } else { g.fillStyle = `rgba(255,120,50,${0.45 + Math.sin(S.t * 3 + s.x) * 0.2})`; g.beginPath(); g.arc(s.x, s.y - 3, 1.6, 0, Math.PI * 2); g.fill(); }
    }
    if (S.exit) { // a faint glow from below, so the stairs can be found in the dark
      const a = 0.25 + (this.reduced ? 0 : Math.sin(S.t * 2) * 0.08), gr = g.createRadialGradient(S.exit.x, S.exit.y + 6, 2, S.exit.x, S.exit.y + 6, 26);
      gr.addColorStop(0, `rgba(255,170,90,${a})`); gr.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = gr; g.fillRect(S.exit.x - 26, S.exit.y - 20, 52, 52);
    }
    for (const d of S.drops) {
      g.save(); g.shadowColor = '#ffb060'; g.shadowBlur = 10; g.fillStyle = '#ffcf86';
      g.beginPath(); g.moveTo(d.x, d.y - 6); g.quadraticCurveTo(d.x + 4, d.y, d.x, d.y + 3); g.quadraticCurveTo(d.x - 4, d.y, d.x, d.y - 6); g.fill(); g.restore();
    }
    const lit = p.snuffT <= 0 && p.oil > 0;
    if (!p.dead) {
      if (S.lantern.state === 'held') { const h = handPos(p); drawLanternCage(g, h.x, h.y - 2, Math.sin(S.t * 5) * 0.15 - p.vx * 0.0012, lit, LANTERN_RGB); }
      else drawLanternCage(g, S.lantern.x, S.lantern.y - 2, S.lantern.state === 'rest' ? 0 : S.t * 9, lit, LANTERN_RGB);
    }
    for (const e of S.enemies) {
      if (e.dead || !this.onScreen(e)) continue;
      if (ATTACK_STATES.includes(e.state)) { // tells show through the dark: nothing attacks unwarned (spec §7.2)
        const col = TELL[TELL_OF[e.kind]], pulse = e.state === 'windup' ? 0.55 + 0.45 * Math.sin(S.t * 30) : 0.9;
        g.save(); g.shadowColor = col; g.shadowBlur = 16; g.globalAlpha = pulse; g.fillStyle = g.strokeStyle = col; ENEMY_SHAPES[e.kind](g, e, S.T);
        g.shadowBlur = 0; g.fillStyle = g.strokeStyle = '#030304';
        if (e.vis > 0.3 || e.kind !== 'shade') { g.globalAlpha = Math.max(0.65, e.vis); ENEMY_SHAPES[e.kind](g, e, S.T); }
        g.restore();
      }
      if (e.exposedT > 0) { g.strokeStyle = `rgba(255,240,200,${0.4 + Math.sin(S.t * 20) * 0.3})`; g.lineWidth = 1.2; g.beginPath(); g.arc(e.x + e.w / 2, e.y - 8, 4, 0, Math.PI * 2); g.stroke(); }
      const ex = e.x + e.w / 2 + e.face * (e.kind === 'snuffer' ? 8 : e.kind === 'moth' ? 2 : 3), ey = e.y + (e.kind === 'snuffer' ? 8 : 6);
      g.save(); g.shadowColor = EYES[e.kind]; g.shadowBlur = 6; g.fillStyle = EYES[e.kind];
      g.beginPath(); g.arc(ex, ey, 1.4, 0, Math.PI * 2); g.arc(ex - e.face * 4, ey + 0.5, 1.2, 0, Math.PI * 2); g.fill(); g.restore();
      if (e.hp < e.maxHp) {
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(e.x + e.w / 2 - 12, e.y - 6, 24, 2.5);
        g.fillStyle = 'rgba(230,120,100,0.9)'; g.fillRect(e.x + e.w / 2 - 12, e.y - 6, (24 * Math.max(0, e.hp)) / e.maxHp, 2.5);
      }
    }
    if (p.atkT > 0) {
      const k = 1 - p.atkT / SWING;
      if (k > 0.2 && k < 0.65) {
        g.save(); g.translate(pc.x, p.y + 10); g.scale(p.face, 1);
        g.strokeStyle = `rgba(255,236,210,${0.5 * (1 - Math.abs(k - 0.42) * 4)})`; g.lineWidth = p.atkN === 3 ? 3 : 2;
        g.beginPath(); if (p.atkN === 2) g.arc(6, 14, 34, -1.9, 0.9); else g.arc(6, 10, 34, -1.2, 1.3); g.stroke(); g.restore();
      }
    }
    if ((p.blocking || p.parryT > 0 || p.blockFlash > 0) && !p.dead) {
      const a = Math.max(p.blocking ? 0.22 : 0, (p.parryT / S.T.parry) * 0.8, (p.blockFlash / 0.18) * 0.9);
      g.save(); g.strokeStyle = `rgba(255,236,200,${a})`; g.shadowColor = '#ffd59a'; g.shadowBlur = p.blockFlash > 0 ? 12 : 4;
      g.lineWidth = p.blockFlash > 0 ? 2.4 : 1.5;
      g.beginPath(); g.arc(pc.x + p.face * 6, p.y + 20, 22, p.face > 0 ? -1.25 : 1.9, p.face > 0 ? 1.25 : 4.4); g.stroke(); g.restore();
    }
    for (const mo of this.B.motes) {
      const mx = mo.x + Math.sin(S.t * 0.4 * mo.s + mo.a) * 20, my = mo.y + Math.cos(S.t * 0.3 * mo.s + mo.a) * 14;
      if (mx < v.camL || mx > v.camL + v.VW || my < v.camT || my > v.camT + VIEW_H) continue;
      let k = 0;
      for (const l of L) { if (l.kind === 'ember') continue; const d = Math.hypot(mx - l.x, my - l.y); if (d < l.r) k = Math.max(k, 1 - d / l.r); }
      if (k > 0.05) { g.fillStyle = `rgba(255,230,190,${k * 0.7})`; g.fillRect(mx, my, mo.s * 1.3, mo.s * 1.3); }
    }
    this.fx.draw(g);
  }

  /** Nothing hits from off-screen unwarned (spec §7.2): an attacker you can't see shows at the edge in its colour. */
  edgeMarks(S) {
    const g = this.g, v = this.v;
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    const vw = v.W / v.dpr, vh = v.H / v.dpr;
    for (const e of S.enemies) {
      if (e.dead || !ATTACK_STATES.includes(e.state)) continue;
      const sx = ((e.x + e.w / 2 - v.camL) * v.S) / v.dpr, sy = ((e.y + e.h / 2 - v.camT) * v.S) / v.dpr;
      if (sx > 0 && sx < vw && sy > 0 && sy < vh) continue;
      const x = clamp(sx, 14, vw - 14), y = clamp(sy, 14, vh - 14);
      g.save(); g.translate(x, y); g.rotate(Math.atan2(sy - y, sx - x));
      g.fillStyle = TELL[TELL_OF[e.kind]]; g.shadowColor = g.fillStyle; g.shadowBlur = 10;
      g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -7); g.lineTo(-6, 7); g.fill(); g.restore();
    }
  }
}

/** The stairs down (X): an arch with steps sinking into it. */
function drawStairs(g, e) {
  const x = e.x, y = e.y + 12; // the floor under the stairs' tile
  g.fillStyle = '#020203';
  g.beginPath(); g.moveTo(x - 16, y); g.lineTo(x - 16, y - 30); g.quadraticCurveTo(x, y - 46, x + 16, y - 30); g.lineTo(x + 16, y); g.fill();
  g.fillStyle = '#0c0d10';
  for (let i = 0; i < 4; i++) g.fillRect(x - 13 + i * 2, y - 6 - i * 6, 26 - i * 4, 2.5);
}

function polyPath(g, p) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); }

/** The rim: the shape in the nearest light's colour, nudged toward it; then the black body over it. */
function rimAndFill(g, L, cx, cy, draw, body) {
  let best = null, bv = 0;
  for (const l of L) { const d = Math.hypot(cx - l.x, cy - l.y); if (d < l.r && d > 4) { const k = 1 - d / l.r; if (k > bv) { bv = k; best = l; } } }
  if (best && bv > 0.05) {
    const d = Math.hypot(cx - best.x, cy - best.y);
    g.save(); g.translate(((best.x - cx) / d) * 1.6, ((best.y - cy) / d) * 1.6);
    g.fillStyle = g.strokeStyle = `rgba(${best.rgb[0]},${best.rgb[1]},${best.rgb[2]},${Math.min(1, bv * 1.6)})`; draw(); g.restore();
  }
  g.fillStyle = g.strokeStyle = body; draw();
}
