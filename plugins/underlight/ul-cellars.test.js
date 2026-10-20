import { describe, it, expect } from 'vitest';
import { newGame } from './ul-game.js';
import { CELLARS_01 } from './rooms/cellars-01.js';
import { run, idle } from './tests/kit.js';

describe('the first Cellars room', () => {
  it('builds with its sconces and enemies', () => {
    const S = newGame(CELLARS_01);
    expect(S.sconces).toHaveLength(6);
    expect(S.enemies.map((e) => e.kind).sort()).toEqual(['moth', 'moth', 'moth', 'shade', 'shade', 'shade', 'snuffer', 'snuffer']);
    expect(S.over).toBe(null);
  });
  it('is cleared 0.9 s after the last enemy dies', () => {
    const S = newGame(CELLARS_01);
    for (const e of S.enemies) e.dead = true;
    run(S, 0.8);
    expect(S.over).toBe(null);
    run(S, 0.2);
    expect(S.over).toBe('cleared');
  });
  it('one seed and one set of inputs make one game', () => {
    const play = () => {
      const S = newGame(CELLARS_01, { seed: 7 });
      run(S, 6, (i) => ({ ...idle(), dir: i % 240 < 120 ? 1 : -1, jump: i % 90 === 0, jumpHeld: i % 90 < 30, attack: i % 37 === 0 }));
      return JSON.stringify([S.player.x, S.player.y, S.player.hp, S.player.oil, S.enemies.map((e) => [e.x, e.y, e.hp, e.state])]);
    };
    expect(play()).toBe(play());
  });
  it('a long idle never makes a NaN', () => {
    const S = newGame(CELLARS_01, { seed: 3 });
    run(S, 20);
    for (const b of [S.player, ...S.enemies]) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
  });
});
