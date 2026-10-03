// plugins/dnd-hub/dnd-hub-forge-state.test.js
import { describe, it, expect } from 'vitest';
import { initForge, forgeStep } from './dnd-hub-forge-state.js';

const s0 = () => initForge(9, 12);

describe('forgeStep', () => {
  it('starts on the races, first of each', () => {
    expect(s0()).toEqual({ scene: 'race', race: 0, cls: 0, nRaces: 9, nClasses: 12, quick: null, picks: false, shape: 0, nShape: 0 });
  });
  it('browses the current scene and wraps both ways', () => {
    expect(forgeStep(s0(), { type: 'browse', by: -1 }).race).toBe(8);
    expect(forgeStep({ ...s0(), race: 8 }, { type: 'browse', by: 1 }).race).toBe(0);
    const c = { ...s0(), scene: 'class' };
    expect(forgeStep(c, { type: 'browse', by: 1 }).cls).toBe(1);
    expect(forgeStep(c, { type: 'browse', by: 1 }).race).toBe(0);
  });
  it('selects by index within range only', () => {
    expect(forgeStep(s0(), { type: 'select', index: 4 }).race).toBe(4);
    expect(forgeStep(s0(), { type: 'select', index: 40 }).race).toBe(0);
  });
  it('choose moves race → class → reveal, and stays on reveal', () => {
    let s = forgeStep(s0(), { type: 'choose' });
    expect(s.scene).toBe('class');
    s = forgeStep(s, { type: 'choose' });
    expect(s.scene).toBe('reveal');
    expect(forgeStep(s, { type: 'choose' }).scene).toBe('reveal');
  });
  it('back keeps the selection', () => {
    const s = { ...s0(), scene: 'class', race: 5, cls: 3 };
    expect(forgeStep(s, { type: 'back' })).toMatchObject({ scene: 'race', race: 5, cls: 3 });
    expect(forgeStep({ ...s, scene: 'reveal' }, { type: 'back' }).scene).toBe('class');
    expect(forgeStep(s0(), { type: 'back' }).scene).toBe('race');
  });
  it('a quick pick jumps to the reveal with its race and class selected; back from it returns to the races', () => {
    const s = forgeStep(s0(), { type: 'quickPick', id: 'human-cleric', race: 3, cls: 2 });
    expect(s).toMatchObject({ scene: 'reveal', race: 3, cls: 2, quick: 'human-cleric' });
    expect(forgeStep(s, { type: 'back' })).toMatchObject({ scene: 'race', quick: null });
  });
  it('change goes to the class scene and forgets the quick pick', () => {
    const s = forgeStep(s0(), { type: 'quickPick', id: 'human-cleric', race: 3, cls: 2 });
    expect(forgeStep(s, { type: 'change' })).toMatchObject({ scene: 'class', race: 3, cls: 2, quick: null });
  });
  it('choose on the class scene goes to the picks scene when the class has level-1 picks', () => {
    const s = { ...initForge(9, 12), scene: 'class', picks: true };
    expect(forgeStep(s, { type: 'choose' }).scene).toBe('picks');
    expect(forgeStep({ ...s, scene: 'picks' }, { type: 'choose' }).scene).toBe('reveal');
    expect(forgeStep({ ...s, scene: 'picks' }, { type: 'back' }).scene).toBe('class');
    expect(forgeStep({ ...s, scene: 'reveal' }, { type: 'back' }).scene).toBe('picks');
  });
  it('after the class (and its picks) come the guided steps, one by one, then the reveal', () => {
    const c = { ...s0(), scene: 'class', nShape: 3 };
    let s = forgeStep(c, { type: 'choose' });
    expect(s).toMatchObject({ scene: 'shape', shape: 0 });
    s = forgeStep(s, { type: 'choose' });
    expect(s.shape).toBe(1);
    s = forgeStep(forgeStep(s, { type: 'choose' }), { type: 'choose' });
    expect(s.scene).toBe('reveal');
    expect(forgeStep(s, { type: 'back' })).toMatchObject({ scene: 'shape', shape: 2 });
    const p = forgeStep({ ...c, picks: true }, { type: 'choose' });
    expect(p.scene).toBe('picks');
    expect(forgeStep(p, { type: 'choose' })).toMatchObject({ scene: 'shape', shape: 0 });
  });
  it('back from the first guided step returns to the picks, or the class', () => {
    const s = { ...s0(), scene: 'shape', shape: 0, nShape: 4 };
    expect(forgeStep(s, { type: 'back' }).scene).toBe('class');
    expect(forgeStep({ ...s, picks: true }, { type: 'back' }).scene).toBe('picks');
    expect(forgeStep({ ...s, shape: 2 }, { type: 'back' })).toMatchObject({ scene: 'shape', shape: 1 });
  });
  it('"use the suggestions" jumps from any guided step to the reveal; elsewhere it does nothing', () => {
    expect(forgeStep({ ...s0(), scene: 'shape', shape: 1, nShape: 5 }, { type: 'finish' }).scene).toBe('reveal');
    const r = s0();
    expect(forgeStep(r, { type: 'finish' })).toBe(r);
  });
  it('browsing does nothing on a guided step', () => {
    const s = { ...s0(), scene: 'shape', nShape: 3 };
    expect(forgeStep(s, { type: 'browse', by: 1 })).toEqual(s);
  });
  it('change on a guided hero returns to its last step with the choices kept', () => {
    const s = { ...s0(), scene: 'reveal', nShape: 5, shape: 2 };
    expect(forgeStep(s, { type: 'change' })).toMatchObject({ scene: 'shape', shape: 4 });
  });
  it('a quick pick has no guided steps', () => {
    const s = forgeStep({ ...s0(), nShape: 5 }, { type: 'quickPick', id: 'x', race: 1, cls: 1 });
    expect(s.nShape).toBe(0);
  });
  it('ignores unknown actions', () => {
    const s = s0();
    expect(forgeStep(s, { type: 'nonsense' })).toBe(s);
  });
});
