// ul-pickups.js — sconces you light by touching or by landing the thrown lantern beside them (permanent light, +15 oil
// once), and oil dropped by enemies.
import { TS } from './ul-const.js';
import { tileAt, isSolidTile } from './ul-room.js';
import { sfx, text, burst } from './ul-fx.js';
import { onSconceLit } from './ul-ratking.js';

export const SCONCE_OIL = 15, SCONCE_REACH = 48, DROP_REACH = 30;

/** Light a sconce, by touch or by the thrown lantern landing beside it: light for good, a little oil, and in the
 *  Rat King's dark phase a stagger if it is near. */
export function lightSconce(S, s) {
  const p = S.player;
  s.lit = true; p.oil = Math.min(100, p.oil + SCONCE_OIL);
  sfx(S, 'sconce'); text(S, s.x, s.y - 18, `+${SCONCE_OIL} oil`, '#ffcf86'); burst(S, s.x, s.y, 14, '255,190,110', { glow: true });
  onSconceLit(S, s);
}

export function stepPickups(S, dt) {
  const p = S.player;
  if (p.dead) return;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  for (const s of S.sconces) if (!s.lit && Math.hypot(s.x - cx, s.y - cy) < SCONCE_REACH) lightSconce(S, s);
  for (const d of S.drops) {
    d.t += dt; d.vy += 1200 * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.vx *= 0.98;
    const r = Math.floor((d.y + 4) / TS), t = tileAt(S.room, Math.floor(d.x / TS), r);
    if ((isSolidTile(t) || t === '-') && d.vy > 0) { d.y = r * TS - 4; d.vy = 0; d.vx = 0; }
    if (d.t > 0.3 && Math.hypot(d.x - cx, d.y - cy) < DROP_REACH) {
      d.taken = true; p.oil = Math.min(100, p.oil + d.amt); sfx(S, 'oil'); text(S, d.x, d.y - 10, `+${d.amt} oil`, '#ffcf86');
    }
  }
  S.drops = S.drops.filter((d) => !d.taken);
}
