// ul-particles.js — sparks, ash and floating words, made from the game's fx events. Drawing only: nothing here
// changes the game, so it may use Math.random freely.
export class Particles {
  constructor() { this.parts = []; this.texts = []; this.shake = 0; }
  take(events, reduced) {
    for (const ev of events) {
      if (ev.k === 'text') this.texts.push({ x: ev.x, y: ev.y, s: ev.s, col: ev.col, life: 0.9 });
      else if (ev.k === 'shake') { if (!reduced) this.shake = Math.max(this.shake, ev.a); }
      else if (ev.k === 'burst') {
        const sp = ev.spread ?? 240;
        for (let i = 0; i < ev.n; i++) {
          const vx = ev.dir ? ev.dir * (200 + Math.random() * 120) : (Math.random() * 2 - 1) * sp;
          this.parts.push({ x: ev.x, y: ev.y, vx, vy: (Math.random() * 2 - 1) * sp * 0.6 - (ev.grav ? 120 : 40), life: 0.2 + Math.random() * 0.6,
            max: 0.8, col: ev.col, size: 1.2 + Math.random() * (ev.grav ? 2.5 : 1.4), glow: Boolean(ev.glow), grav: Boolean(ev.grav) });
        }
      }
    }
  }
  step(dt) {
    for (const q of this.parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; if (q.grav) q.vy += 900 * dt; q.vx *= 0.97; }
    this.parts = this.parts.filter((q) => q.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y -= 26 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
    this.shake = Math.max(0, this.shake - dt * 30);
  }
  draw(g) {
    for (const q of this.parts) {
      const a = Math.max(0, Math.min(1, q.life / q.max));
      g.fillStyle = `rgba(${q.col},${q.glow ? a : a * 0.8})`;
      if (q.glow) g.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
      else { g.beginPath(); g.arc(q.x, q.y, q.size, 0, Math.PI * 2); g.fill(); }
    }
    g.font = 'italic 11px Georgia, serif'; g.textAlign = 'center';
    for (const t of this.texts) {
      g.globalAlpha = Math.max(0, Math.min(1, t.life * 1.6));
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(t.s, t.x + 0.8, t.y + 0.8);
      g.fillStyle = t.col; g.fillText(t.s, t.x, t.y);
    }
    g.globalAlpha = 1;
  }
}
