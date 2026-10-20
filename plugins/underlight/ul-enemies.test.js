import { describe, it, expect } from 'vitest';
import { makeEnemy } from './ul-enemies.js';
import { mothTarget } from './ul-moth.js';
import { breathCone } from './ul-snuffer.js';
import { canAttack } from './ul-enemy.js';
import { makeLights } from './ul-light.js';
import { settled, flatRoom, run, idle } from './tests/kit.js';

/** A wide flat room with the player at the left and enemies added by hand. */
function arena(add) {
  const S = settled(flatRoom(60, 10));
  for (const [ch, x] of add) S.enemies.push(makeEnemy(S, ch, x, 8 * 24 + 12));
  run(S, 0.3);
  S.fx = [];
  return S;
}

describe('the Shade', () => {
  it('will not come near you while your light is full', () => {
    const S = arena([['h', 400]]);
    run(S, 4);
    const e = S.enemies[0];
    expect(e.x - S.player.x).toBeGreaterThan(100);
    expect(e.state).not.toBe('windup');
  });
  it('comes, warns and lunges when your lantern is snuffed', () => {
    const S = arena([['h', 200]]);
    S.player.snuffT = 30;
    const states = new Set();
    run(S, 4, () => { states.add(S.enemies[0].state); return idle(); });
    expect(states.has('windup')).toBe(true);
    expect(states.has('attack')).toBe(true);
    expect(S.player.hp).toBeLessThan(100);
  });
});

describe('attack tokens', () => {
  it('lets only T.tokens enemies attack at once', () => {
    const S = arena([['h', 150], ['h', 160], ['h', 170]]);
    S.player.snuffT = 30; S.T.tokens = 1;
    let most = 0;
    run(S, 4, () => { most = Math.max(most, S.enemies.filter((e) => ['windup', 'attack'].includes(e.state)).length); return idle(); });
    expect(most).toBe(1);
  });
  it('lets none attack a dead player', () => {
    const S = arena([]);
    S.player.dead = true;
    expect(canAttack(S)).toBe(false);
  });
});

describe('the Moth', () => {
  it('wants your lantern, and a thrown lantern more when it is nearer', () => {
    const S = arena([['m', 300]]);
    const e = S.enemies[0];
    expect(mothTarget(S, e, makeLights(S)).kind).toBe('player');
    S.lantern = { state: 'rest', x: e.x + 40, y: e.y + 10 };
    expect(mothTarget(S, e, makeLights(S)).kind).toBe('lantern');
  });
  it('dives at you with a red tell and hurts', () => {
    const S = arena([['m', 150]]);
    const states = new Set();
    run(S, 5, () => { states.add(S.enemies[0].state); return idle(); });
    expect(states.has('windup') && states.has('dive')).toBe(true);
    expect(S.player.hp).toBeLessThan(100);
  });
  it('circles a decoy and never dives at it', () => {
    const S = arena([['m', 600]]);
    S.player.x = 30; S.lantern = { state: 'rest', x: 620, y: 8 * 24 };
    const states = new Set();
    run(S, 4, () => { states.add(S.enemies[0].state); return idle(); });
    expect(states.has('windup')).toBe(false);
  });
});

describe('the Snuffer', () => {
  it('breathes a cone in front of it', () => {
    expect(breathCone({ x: 100, y: 50, w: 34, h: 30, face: 1 })).toEqual({ x: 134, y: 36, w: 124, h: 44 });
    expect(breathCone({ x: 100, y: 50, w: 34, h: 30, face: -1 }).x).toBe(-24);
  });
  it('snuffs your lantern if you stand in it', () => {
    const S = arena([['n', 160]]);
    let snuffed = false;
    run(S, 4, () => { if (S.player.snuffT > 0) snuffed = true; return idle(); });
    expect(snuffed).toBe(true);
  });
});
