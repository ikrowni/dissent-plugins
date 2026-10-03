// plugins/dnd-hub/dnd-hub-forge-state.test.js
import { describe, it, expect } from 'vitest';
import { initForge, forgeStep } from './dnd-hub-forge-state.js';

const s0 = () => initForge(9, 12);

describe('forgeStep', () => {
  it('starts on the races, first of each', () => {
    expect(s0()).toEqual({ scene: 'race', race: 0, cls: 0, nRaces: 9, nClasses: 12, quick: null, picks: false });
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
  it('ignores unknown actions', () => {
    const s = s0();
    expect(forgeStep(s, { type: 'nonsense' })).toBe(s);
  });
});
