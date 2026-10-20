import { describe, it, expect } from 'vitest';
import { step, advance } from './ul-game.js';
import { Input } from './ul-input.js';
import { DT } from './ul-const.js';
import { flatRoom, settled, run, idle } from './tests/kit.js';

describe('advance', () => {
  it('keeps a press through the hit-stop until a step uses it', () => {
    const S = settled(flatRoom());
    const input = new Input();
    S.hitStop = 0.05;
    input.down(' '); input.up(' ');
    advance(S, input, 0.1);
    expect(S.player.vy).toBeLessThan(0);
  });
  it('gives up banked time after too many steps (a stalled tab)', () => {
    const S = settled(flatRoom());
    expect(advance(S, new Input(), 5)).toBe(0);
    expect(advance(S, new Input(), DT * 1.5)).toBeCloseTo(DT * 0.5);
  });
});

describe('the end of a room', () => {
  it('never clears a room that had no enemies to begin with', () => {
    const S = settled(flatRoom());
    run(S, 2);
    expect(S.over).toBe(null);
  });
  it('is lost 1.3 s after you die, and nothing steps after', () => {
    const S = settled(flatRoom());
    S.player.hp = 1; S.player.oil = 0;
    run(S, 1.8);
    expect(S.player.dead).toBe(true);
    run(S, 1.4);
    expect(S.over).toBe('dead');
    const t = S.t;
    step(S, idle(), DT);
    expect(S.t).toBe(t);
  });
});
