import { describe, it, expect } from 'vitest';
import { hurtEnemy, killEnemy } from './ul-combat.js';
import { settled, flatRoom } from './tests/kit.js';
import { makeSnuffer } from './ul-snuffer.js';
import { makeShade } from './ul-shade.js';

describe('hurtEnemy', () => {
  it('takes double damage while exposed by a parry', () => {
    const S = settled(flatRoom());
    const e = makeShade(S, 200, 100);
    hurtEnemy(S, e, 12, 0, 0);
    expect(e.hp).toBe(28);
    e.exposedT = 1;
    hurtEnemy(S, e, 12, 0, 0);
    expect(e.hp).toBe(4);
  });
  it('breaks poise into a stagger, and refills it', () => {
    const S = settled(flatRoom());
    const e = makeSnuffer(S, 200, 100);
    hurtEnemy(S, e, 1, 22, 100);
    expect(e.state).not.toBe('stagger');
    hurtEnemy(S, e, 1, 22, 100);
    expect(e.state).not.toBe('stagger');
    hurtEnemy(S, e, 1, 22, 100);
    expect([e.state, e.poise]).toEqual(['stagger', 45]);
  });
  it('freezes the game for the hit-stop', () => {
    const S = settled(flatRoom());
    hurtEnemy(S, makeShade(S, 200, 100), 1, 0, 0);
    expect(S.hitStop).toBeCloseTo(0.055);
  });
});

describe('killEnemy', () => {
  it('a Snuffer always leaves 25 oil', () => {
    const S = settled(flatRoom());
    const e = makeSnuffer(S, 200, 100);
    killEnemy(S, e);
    expect(e.dead).toBe(true);
    expect(S.drops).toHaveLength(1);
    expect(S.drops[0].amt).toBe(25);
  });
});
