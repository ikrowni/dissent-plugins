// ul-lantern.js — the Lamplighter's verb (spec §5.3): throw the lantern ahead; press again to call it back, and
// it hits what it passes on the way. Costs 8 oil to throw.
import { TS } from './ul-const.js';
import { tileAt, solidPt, isSolidTile } from './ul-room.js';
import { handPos } from './ul-light.js';
import { hurtEnemy } from './ul-combat.js';
import { sfx, text } from './ul-fx.js';

export const THROW_COST = 8;

export function throwOrRecall(S) {
  const p = S.player, l = S.lantern;
  if (l.state === 'held') {
    if (p.oil < THROW_COST) { text(S, p.x + 9, p.y - 8, 'not enough oil', '#ffcf86'); return; }
    p.oil -= THROW_COST;
    const h = handPos(p);
    Object.assign(l, { state: 'fly', x: h.x, y: h.y, vx: p.face * 470 + p.vx * 0.4, vy: -380 });
    sfx(S, 'throw');
  } else if (l.state === 'fly' || l.state === 'rest') {
    l.state = 'back'; l.hitSet = new Set(); sfx(S, 'recall');
  }
}

export function stepLantern(S, dt) {
  const l = S.lantern, p = S.player, room = S.room;
  if (l.state === 'fly') {
    l.vy += 1500 * dt;
    const ox = l.x; l.x += l.vx * dt;
    if (solidPt(room, l.x, l.y)) { l.x = ox; l.vx *= -0.3; }
    const oy = l.y; l.y += l.vy * dt;
    const r = Math.floor((l.y + 6) / TS), t = tileAt(room, Math.floor(l.x / TS), r);
    if (isSolidTile(t) || (t === '-' && l.vy > 0 && oy + 6 <= r * TS + 1)) {
      if (l.vy > 0) {
        l.y = r * TS - 6;
        if (Math.abs(l.vy) < 160) { l.state = 'rest'; l.vx = 0; l.vy = 0; } else { l.vy *= -0.3; l.vx *= 0.6; sfx(S, 'land'); }
      } else { l.y = oy; l.vy = 0; }
    }
  } else if (l.state === 'back') {
    const h = handPos(p), dx = h.x - l.x, dy = h.y - l.y, d = Math.hypot(dx, dy);
    if (d < 16) { l.state = 'held'; return; }
    const move = Math.min(d, 760 * dt);
    l.x += (dx / d) * move; l.y += (dy / d) * move;
    for (const e of S.enemies) {
      if (e.dead || l.hitSet.has(e)) continue;
      if (l.x + 8 > e.x && l.x - 8 < e.x + e.w && l.y + 8 > e.y && l.y - 8 < e.y + e.h) { l.hitSet.add(e); hurtEnemy(S, e, 10, 10, Math.sign(dx) * 150, l.x); }
    }
  }
  if (l.state === 'rest' && !p.dead && Math.hypot(l.x - (p.x + p.w / 2), l.y - (p.y + p.h / 2)) < 26) l.state = 'held';
}
