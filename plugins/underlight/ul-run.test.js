import { describe, it, expect, vi } from 'vitest';
import { newRun, openStep, closeStep, stepLabel, hashSeed, STEPS } from './ul-run.js';
import { CELLARS, LAMP_POST } from './biomes/cellars.js';
import { run as play, idle } from './tests/kit.js';

vi.setConfig({ testTimeout: 30000 }); // each level runs the solver

describe('a run through the Cellars', () => {
  it('is three levels with a lamp post between each', () => {
    expect(STEPS).toEqual(['level', 'lamp', 'level', 'lamp', 'level']);
    const run = newRun(1), labels = [];
    for (let i = 0; i < STEPS.length; i++) { labels.push(stepLabel(run, CELLARS)); run.step++; }
    expect(labels).toEqual(['Cellars · level 1 of 3', 'Lamp post', 'Cellars · level 2 of 3', 'Lamp post', 'Cellars · level 3 of 3']);
  });
  it('gives the same levels for the same base, and new ones for a new run', () => {
    const a = openStep(newRun(77), CELLARS, LAMP_POST), b = openStep(newRun(77), CELLARS, LAMP_POST), c = openStep(newRun(78), CELLARS, LAMP_POST);
    expect(a.room.tiles).toEqual(b.room.tiles);
    expect(a.room.tiles).not.toEqual(c.room.tiles);
  });
  it('carries your body, oil and flask to the next step, and ends after the third level', () => {
    const run = newRun(5);
    let S = openStep(run, CELLARS, LAMP_POST);
    S.player.hp = 61; S.player.oil = 40; S.player.flask = 0;
    expect(closeStep(run, S)).toBe('next');
    S = openStep(run, CELLARS, LAMP_POST);
    expect([S.player.hp, S.player.oil, S.player.flask]).toEqual([61, 40, 0]);
    expect(S.exit).not.toBe(null); // the lamp post has its own stairs
    expect(closeStep(run, S)).toBe('next');
    closeStep(run, openStep(run, CELLARS, LAMP_POST));
    closeStep(run, openStep(run, CELLARS, LAMP_POST));
    expect(closeStep(run, openStep(run, CELLARS, LAMP_POST))).toBe('act-done');
  });
  it('makes a level you can stand in: nothing steps into a NaN in 10 s', () => {
    const S = openStep(newRun(3), CELLARS, LAMP_POST);
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
