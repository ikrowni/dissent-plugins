import { describe, it, expect, vi } from 'vitest';
import { newRun, openStep, closeStep, stepLabel, hashSeed, STEPS } from './ul-run.js';
import { CELLARS, LAMP_POST } from './biomes/cellars.js';
import { RAT_KING_ARENA } from './biomes/cellars-arena.js';
import { CAMP } from './biomes/camp.js';
import { run as play, idle } from './tests/kit.js';

vi.setConfig({ testTimeout: 30000 }); // each level runs the solver

describe('a run through the Cellars', () => {
  it('is three levels with a lamp post between each, then the Rat King, then the camp', () => {
    expect(STEPS).toEqual(['level', 'lamp', 'level', 'lamp', 'level', 'boss', 'camp']);
    const run = newRun(1), labels = [];
    for (let i = 0; i < STEPS.length; i++) { labels.push(stepLabel(run, CELLARS)); run.step++; }
    expect(labels).toEqual(['Cellars · level 1 of 3', 'Lamp post', 'Cellars · level 2 of 3', 'Lamp post', 'Cellars · level 3 of 3', 'The Rat King', 'The camp']);
  });
  it('gives the same levels for the same base, and new ones for a new run', () => {
    const a = openStep(newRun(77), CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP), b = openStep(newRun(77), CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP), c = openStep(newRun(78), CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP);
    expect(a.room.tiles).toEqual(b.room.tiles);
    expect(a.room.tiles).not.toEqual(c.room.tiles);
  });
  it('carries your body, oil and flask to the next step, and ends after the camp', () => {
    const run = newRun(5);
    let S = openStep(run, CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP);
    S.player.hp = 61; S.player.oil = 40; S.player.flask = 0;
    expect(closeStep(run, S)).toBe('next');
    S = openStep(run, CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP);
    expect([S.player.hp, S.player.oil, S.player.flask]).toEqual([61, 40, 0]);
    expect(S.exit).not.toBe(null); // the lamp post has its own stairs
    expect(closeStep(run, S)).toBe('next');
    for (let i = 0; i < 3; i++) closeStep(run, openStep(run, CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP)); // level 2, lamp post, level 3
    S = openStep(run, CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP);
    expect(S.boss).not.toBe(null);
    expect(S.sconces.every((s) => s.lit)).toBe(true); // the arena is lit when you arrive
    expect(closeStep(run, S)).toBe('next');
    S = openStep(run, CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP);
    expect(S.fire).toMatchObject({ rested: false });
    expect(closeStep(run, S)).toBe('act-done');
  });
  it('a run continued at the camp has rested already', () => {
    const S = openStep({ base: 9, step: STEPS.indexOf('camp'), carry: { hp: 50, oil: 50, flask: 1 }, resumed: true }, CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP);
    expect(S.fire.rested).toBe(true);
    expect(S.player.hp).toBe(50);
  });
  it('makes a level you can stand in: nothing steps into a NaN in 10 s', () => {
    const S = openStep(newRun(3), CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP);
    play(S, 10, idle());
    expect(Number.isFinite(S.player.x) && Number.isFinite(S.player.y)).toBe(true);
  });
});

describe('hashSeed', () => {
  it('spreads near strings apart and never gives 0', () => {
    expect(hashSeed('a:0')).not.toBe(hashSeed('a:1'));
    expect(hashSeed('')).toBeGreaterThan(0);
  });
});
