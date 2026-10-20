// ul-combat.js — damage both ways. Hits on you are decided here, on your machine (spec §11.1): the dodge, block
// and parry checks all run on the one being hit, so a dodge you saw always counts.
import { sfx, text, burst, shake } from './ul-fx.js';

export const ATTACK_STATES = ['windup', 'attack', 'dive', 'breath'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/**
 * kind: 'white' (block or parry it), 'red' (dodge it), 'violet' (puts out your lantern; dodge it).
 * src: the enemy, or null for the room itself (spikes).
 */
export function hurtPlayer(S, src, dmg, kind, fromX, cause) {
  const p = S.player, T = S.T;
  if (p.dead) return 'dead';
  const rollDodge = p.rollT > 0 && p.rollT > T.rollTime - T.iframes;
  if (p.inv > 0 || rollDodge) {
    if (rollDodge && src) { S.stats.dodges++; text(S, p.x + 9, p.y - 6, 'dodged', '#d8e6ff'); sfx(S, 'dodge'); }
    return 'dodged';
  }
  const cx = p.x + p.w / 2, facing = Math.sign(fromX - cx) === p.face || Math.abs(fromX - cx) < 6;
  if (src && kind === 'white' && p.parryT > 0 && facing) {
    S.stats.parries++; p.parryT = 0;
    src.state = 'stagger'; src.t = 1.3; src.exposedT = 1.6; src.vx = p.face * 220;
    S.hitStop = 0.09; sfx(S, 'parry'); shake(S, 3); text(S, cx + p.face * 18, p.y - 8, 'parried!', '#fff6dc');
    burst(S, cx + p.face * 14, p.y + 16, 16, '255,250,230', { glow: true });
    return 'parried';
  }
  let result = 'hit';
  if (kind === 'violet') { p.snuffT = 4; sfx(S, 'snuffed'); text(S, p.x + 9, p.y - 8, 'snuffed!', '#c4a6ff'); }
  else if (src && kind === 'white' && p.blocking && facing) { dmg *= 0.3; result = 'blocked'; sfx(S, 'block'); text(S, p.x + 9, p.y - 8, 'blocked', '#e9e3d6'); }
  p.hp -= dmg; p.inv = 0.6; p.hurtT = 0.25;
  p.vx = (Math.sign(cx - fromX) || 1) * 260; p.vy = Math.min(p.vy, -240);
  p.rollT = 0; p.atkT = 0; p.drinkT = 0; p.hang = null;
  sfx(S, 'hurt'); shake(S, 5);
  if (p.hp <= 0) killPlayer(S, cause || (src ? 'a ' + cap(src.kind) : 'the room'));
  return result;
}

export function killPlayer(S, cause) {
  const p = S.player;
  p.dead = true; p.hp = 0; p.cause = cause; p.deadT = 0;
  sfx(S, 'die'); shake(S, 6);
}

/** A parried enemy is exposed: it takes double damage for a moment. Poise breaks into a stagger. */
export function hurtEnemy(S, e, dmg, poise, kx) {
  const mult = e.exposedT > 0 ? 2 : 1;
  e.hp -= dmg * mult; e.flash = 0.12; S.stats.hits++;
  S.hitStop = Math.max(S.hitStop, S.T.hitstop / 1000); shake(S, 2); sfx(S, 'hit');
  burst(S, e.x + e.w / 2, e.y + e.h / 2, mult > 1 ? 14 : 7, mult > 1 ? '255,240,200' : '255,190,120', { glow: true });
  if (mult > 1) text(S, e.x + e.w / 2, e.y - 6, '×2', '#fff1d0');
  e.poise -= poise;
  if (e.hp <= 0) { killEnemy(S, e); return; }
  if (e.poise <= 0 && e.state !== 'stagger') {
    e.poise = e.maxPoise; e.state = 'stagger'; e.t = 0.55; e.vx = kx; e.vy = e.flies ? -120 : -160;
  } else if (e.flies || e.state === 'stagger') e.vx = kx * 0.6;
}

/** What each kind leaves: [chance, oil]. */
export const DROPS = { shade: [0.5, 12], moth: [0.4, 8], snuffer: [1, 25] };

export function killEnemy(S, e) {
  e.dead = true; e.state = 'dead'; sfx(S, 'die');
  burst(S, e.x + e.w / 2, e.y + e.h / 2, 22, e.kind === 'snuffer' ? '170,120,255' : '20,20,24', { glow: e.kind === 'snuffer', grav: true, spread: 160 });
  const [chance, amt] = DROPS[e.kind] ?? [0, 0];
  if (S.rng() < chance) S.drops.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, vx: (S.rng() - 0.5) * 80, vy: -220, amt, t: 0 });
}
