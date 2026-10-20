import { describe, it, expect } from 'vitest';
import { newGame, OIL_CACHE } from './ul-game.js';
import { AWAKE } from './ul-enemies.js';
import { run, idle, press } from './tests/kit.js';

const hall = (mid) => ['#'.repeat(40), ...Array(7).fill('#' + ' '.repeat(38) + '#'), `#P${mid.padEnd(37)}#`, '#'.repeat(40)];

describe('the stairs down', () => {
  it('end the level when you reach them, whatever is still alive', () => {
    const S = newGame(hall('   h      X'));
    run(S, 3, press({ dir: 1 }));
    expect(S.over).toBe('exit');
    expect(S.enemies.some((e) => !e.dead)).toBe(true);
  });
  it('mean killing everything no longer ends a level', () => {
    const S = newGame(hall('         h        X'));
    for (const e of S.enemies) e.dead = true;
    run(S, 2);
    expect(S.over).toBe(null);
  });
});

describe('an oil cache', () => {
  it('is a drop of oil waiting on the floor', () => {
    const S = newGame(hall('   o'));
    S.player.oil = 50;
    run(S, 1, press({ dir: 1 }));
    expect(S.player.oil).toBeGreaterThan(50 + OIL_CACHE - 2);
  });
});

describe('sleeping enemies', () => {
  it('do nothing far from you, and wake as you come', () => {
    const wide = ['#'.repeat(80), ...Array(7).fill('#' + ' '.repeat(78) + '#'), '#P' + ' '.repeat(70) + 'h      #', '#'.repeat(80)];
    const S = newGame(wide), e = S.enemies[0], x0 = e.x;
    run(S, 2);
    expect(e.asleep).toBe(true);
    expect(e.x).toBe(x0);
    S.player.x = e.x - AWAKE + 100;
    run(S, 0.5);
    expect(e.asleep).toBe(false);
  });
});

describe('carry', () => {
  it('starts you with what you brought', () => {
    const S = newGame(hall(''), { carry: { hp: 33, oil: 12, flask: 0 } });
    expect([S.player.hp, S.player.oil, S.player.flask]).toEqual([33, 12, 0]);
  });
});

describe('a sleeper holds no attack token', () => {
  it('drops a half-made attack when you get far away', () => {
    const wide = ['#'.repeat(80), ...Array(7).fill('#' + ' '.repeat(78) + '#'), '#P    h' + ' '.repeat(72) + '#', '#'.repeat(80)];
    const S = newGame(wide), e = S.enemies[0];
    e.state = 'windup'; e.t = 5;
    S.player.x = e.x + AWAKE + 200;
    run(S, 0.1);
    expect(e.state).toBe('idle');
  });
});
