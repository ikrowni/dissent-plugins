import { describe, it, expect } from 'vitest';
import { makeEnemy } from './ul-enemies.js';
import { stepBottler, SHOVE_REACH } from './ul-bottler.js';
import { stepLidbearer, LID_REACH } from './ul-lidbearer.js';
import { stepShade, CLAW_REACH } from './ul-shade.js';
import { settled, flatRoom, run } from './tests/kit.js';

// A hit lands only as far as the attack is drawn (owner's playtest, 2026-10-21: "I get hit but the attack doesn't
// show hitting me"). The shoves hit 30-40 past the body with nothing drawn there; now the arm or the lid reaches as
// far as the hit, and the figures draw it from the same numbers.
function facingYou(ch, gap, state, t) {
  const S = settled(flatRoom(60, 10));
  S.enemies.push(...makeEnemy(S, ch, 600, 8 * 24 + 12));
  run(S, 0.3); S.fx = [];
  const e = S.enemies[0], p = S.player;
  e.face = -1; e.vx = 0; Object.assign(e, { state, t, hitDone: false, lidDownT: 0 });
  p.x = e.x - gap - p.w; p.vx = 0; p.inv = 0;
  return { S, e, p };
}
const pc = (p) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });

describe('a hit lands where it is drawn', () => {
  for (const [name, ch, step, reach, state, t] of [
    ['the Bottler\'s shove', 'b', stepBottler, SHOVE_REACH, 'attack', 0.16],
    ['the Lid-bearer\'s shove', 'l', stepLidbearer, LID_REACH, 'attack', 0.18],
    ['the Shade\'s claw', 'h', stepShade, CLAW_REACH, 'attack', 0.2],
  ]) {
    it(`${name} reaches you just inside its reach, and not past it`, () => {
      const near = facingYou(ch, reach - 2, state, t);
      step(near.S, near.e, 0.0005, [], pc(near.p));
      expect(near.p.hp).toBeLessThan(100);
      const far = facingYou(ch, reach + 2, state, t);
      step(far.S, far.e, 0.0005, [], pc(far.p));
      expect(far.p.hp).toBe(100);
    });
  }
  it('the Bottler only winds up a shove when it can reach you', () => {
    const { S, e, p } = facingYou('b', SHOVE_REACH + 6, 'keep', 0);
    e.cd = 0;
    step1(S, e, p);
    expect(e.state).not.toBe('windup');
  });
});
function step1(S, e, p) { stepBottler(S, e, 1 / 120, [], pc(p)); }

describe('being hit', () => {
  it('marks where the blow landed', () => {
    const { S, e, p } = facingYou('b', 4, 'attack', 0.16);
    stepBottler(S, e, 0.0005, [], pc(p));
    expect(S.fx.some((f) => f.k === 'burst' && f.x > p.x + p.w - 1)).toBe(true); // on your side facing him
  });
});
