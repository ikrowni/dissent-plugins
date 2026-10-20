// ul-hazards.js — things in the air and on the floor that aren't enemies: the Bottler's bottles (thrown in an arc;
// RED, so dodge them) and the broken glass a bottle leaves where it lands: spikes for a few seconds that reshape
// the floor mid-fight. Glass only lies on solid floor, and only where a bottle broke. And the Rat King's shockwave.
import { TS } from './ul-const.js';
import { tileAt, solidPt, isSolidTile } from './ul-room.js';
import { hurtPlayer } from './ul-combat.js';
import { sfx, burst } from './ul-fx.js';

export const BOTTLE_G = 1100, BOTTLE_DMG = 15, GLASS_DMG = 10, GLASS_TIME = 5, GLASS_TILES = 3;

/** A bottle from (x, y) that lands on (tx, ty) after `flight` seconds. */
export function throwBottle(S, src, x, y, tx, ty, flight) {
  S.shots.push({ kind: 'bottle', src, x, y, vx: (tx - x) / flight, vy: (ty - y - 0.5 * BOTTLE_G * flight * flight) / flight, spin: 0 });
}

export function stepShots(S, dt) {
  const p = S.player;
  for (const b of S.shots) {
    b.vy += BOTTLE_G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.spin += dt * 14;
    if (!p.dead && b.x > p.x - 4 && b.x < p.x + p.w + 4 && b.y > p.y && b.y < p.y + p.h) {
      b.gone = true; hurtPlayer(S, b.src, BOTTLE_DMG, 'red', b.x, 'a Bottler'); shatter(S, b.x, b.y, false);
    } else if (solidPt(S.room, b.x, b.y) || b.y > S.room.h) { b.gone = true; shatter(S, b.x, b.y, true); }
  }
  S.shots = S.shots.filter((b) => !b.gone);
}

/** A bottle breaks. On the floor it leaves glass across the solid tiles around where it fell. */
export function shatter(S, x, y, onFloor) {
  sfx(S, 'glass'); burst(S, x, y - 4, 12, '200,230,240', { glow: true, spread: 140 });
  if (!onFloor) return;
  const r = Math.floor(y / TS), c0 = Math.floor(x / TS) - 1;
  for (let c = c0; c < c0 + GLASS_TILES; c++) {
    // the floor tile the glass lies on, and air above it
    if (isSolidTile(tileAt(S.room, c, r)) && !isSolidTile(tileAt(S.room, c, r - 1))) S.hazards.push({ kind: 'glass', x: c * TS, y: r * TS - 6, w: TS, h: 6, t: GLASS_TIME });
  }
}

export function stepHazards(S, dt) {
  const p = S.player;
  for (const h of S.hazards) {
    h.t -= dt;
    if (h.kind === 'wave') { // a slam's shockwave runs along the floor until it hits stone; RED: jump it or roll
      h.x += h.vx * dt;
      if (solidPt(S.room, h.vx > 0 ? h.x + h.w : h.x, h.y + h.h / 2)) h.t = 0;
      if (!h.hitDone && !p.dead && p.x < h.x + h.w && p.x + p.w > h.x && p.y < h.y + h.h && p.y + p.h > h.y) {
        if (hurtPlayer(S, null, h.dmg, 'red', h.x + h.w / 2, 'the Rat King') !== 'dodged') h.hitDone = true;
      }
      continue;
    }
    const feet = p.y + p.h;
    if (!p.dead && p.onGround && p.x < h.x + h.w && p.x + p.w > h.x && Math.abs(feet - (h.y + h.h)) < 2) {
      if (hurtPlayer(S, null, GLASS_DMG, 'red', p.x + p.w / 2, 'broken glass') === 'hit' && !p.dead) p.vy = -420;
    }
  }
  S.hazards = S.hazards.filter((h) => h.t > 0);
}
