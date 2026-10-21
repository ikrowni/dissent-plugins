import { describe, it, expect } from 'vitest';
import { newGame, REST_OIL } from './ul-game.js';
import { CAMP } from './biomes/camp.js';
import { parseRoom } from './ul-room.js';
import { solve } from './ul-solver.js';
import { targetsOf } from './ul-level.js';
import { DEFAULT_TUNE } from './ul-const.js';
import { run, press } from './tests/kit.js';

describe('the camp', () => {
  it('can be crossed: the fire, the sconces and the stairs in reach', () => {
    const room = parseRoom(CAMP), res = solve(room, DEFAULT_TUNE, room.spawns.find((s) => s.ch === 'P'),
      { ...targetsOf(room), sconces: room.spawns.filter((s) => s.ch === 'S' || s.ch === 'F').map((s) => ({ x: s.x, y: s.y })) });
    expect(res.exitOk).toBe(true); expect(res.missing).toEqual([]); expect(res.trapped).toEqual([]);
  });
  it('rests you once at the fire: half your lost body, a full flask, oil, and a rest event', () => {
    const S = newGame(CAMP, { carry: { hp: 40, oil: 30, flask: 0 }, litSconces: true });
    run(S, 3, press({ dir: 1 })); // nothing takes the fx here, so every event of the 3 s is still in S.fx
    expect(S.fx.filter((e) => e.k === 'rest')).toHaveLength(1);
    expect(S.player.hp).toBeCloseTo(70, 0);
    expect(S.player.flask).toBe(1);
    expect(S.player.oil).toBeGreaterThan(30 + REST_OIL - 5);
  });
  it('lets you leave by the stairs', () => {
    const S = newGame(CAMP, { litSconces: true });
    run(S, 6, press({ dir: 1 }));
    expect(S.over).toBe('exit');
  });
});
