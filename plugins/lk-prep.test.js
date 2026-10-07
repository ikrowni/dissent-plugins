import { describe, it, expect } from 'vitest';
import { PREP_STEPS, cleanPrep, addLine, toggleLine, removeLine, clearDone, prepCounts } from './lk-prep.js';

describe('the prep board', () => {
  it('has the eight steps, the heroes first', () => {
    expect(PREP_STEPS.map(s => s.id)).toEqual(['heroes', 'start', 'scenes', 'clues', 'places', 'npcs', 'monsters', 'treasure']);
  });
  it('starts empty and keeps only real lines', () => {
    expect(cleanPrep(null)).toEqual({ start: '', lists: { scenes: [], clues: [], places: [], npcs: [], monsters: [], treasure: [] } });
    const p = cleanPrep({ start: ' Bandits at the gate ', lists: { clues: [{ id: 'a', text: 'The mayor lies', done: 1 }, { id: '', text: 'x' }, { id: 'b', text: '' }], bogus: [{ id: 'z', text: 'q' }] } });
    expect(p.start).toBe('Bandits at the gate');
    expect(p.lists.clues).toEqual([{ id: 'a', text: 'The mayor lies', done: true, ref: null }]);
    expect(p.lists.bogus).toBeUndefined();
  });
  it('adds, ticks and removes lines; an NPC or item line can point at the real thing', () => {
    let p = addLine(null, 'clues', 'The well is poisoned');
    p = addLine(p, 'npcs', 'One-Eyed Marta', 'actor:abc');
    const id = p.lists.clues[0].id;
    expect(p.lists.npcs[0]).toMatchObject({ text: 'One-Eyed Marta', ref: 'actor:abc', done: false });
    p = toggleLine(p, 'clues', id);
    expect(p.lists.clues[0].done).toBe(true);
    expect(removeLine(p, 'clues', id).lists.clues).toEqual([]);
    expect(addLine(p, 'clues', '   ').lists.clues).toHaveLength(1);   // nothing to add
    expect(addLine(p, 'nope', 'x')).toEqual(p);                        // no such list
  });
  it('clearing what is done keeps unfound clues and unplayed scenes for next time, and empties the strong start', () => {
    let p = cleanPrep({ start: 'Ambush', lists: {
      clues: [{ id: 'a', text: 'found', done: true }, { id: 'b', text: 'still hidden' }],
      scenes: [{ id: 'c', text: 'played', done: true }, { id: 'd', text: 'not yet' }],
      npcs: [{ id: 'e', text: 'Marta', done: true }] } });
    p = clearDone(p);
    expect(p.start).toBe('');
    expect(p.lists.clues.map(l => l.text)).toEqual(['still hidden']);
    expect(p.lists.scenes.map(l => l.text)).toEqual(['not yet']);
    expect(p.lists.npcs.map(l => [l.text, l.done])).toEqual([['Marta', false]]);  // the rest stay, unticked
  });
  it('counts clues found', () => {
    const p = cleanPrep({ lists: { clues: [{ id: 'a', text: 'x', done: true }, { id: 'b', text: 'y' }] } });
    expect(prepCounts(p)).toEqual({ clues: 2, found: 1 });
  });
});
