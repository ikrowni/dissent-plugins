import { describe, it, expect, vi } from 'vitest';

vi.mock('./dnd-hub-state.js?v=20261015v', () => ({ MAP: {} }));
const { createHistory, fogCells, describe: words, PARTS } = await import('./dnd-hub-undo.js');

const map = () => ({ walls: [], doors: {}, lights: [], pins: [], audioZones: [], triggers: [], tokens: { a: { x: 1 } } });

describe('createHistory', () => {
  it('a save that changed walls is one step; undo gives the walls back as they were', () => {
    const h = createHistory(), md = map();
    h.reset(md);
    md.walls.push({ id: 'w1' });
    expect(h.record(md)).toEqual(['walls']);
    const back = h.undo(md);
    expect(back).toEqual({ walls: [] });
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });
  it('redo gives the change back, and a new edit clears redo', () => {
    const h = createHistory(), md = map();
    h.reset(md);
    md.pins.push({ id: 'p' }); h.record(md);
    md.pins = h.undo(md).pins;
    expect(h.redo(md)).toEqual({ pins: [{ id: 'p' }] });
    md.pins = [{ id: 'p' }];
    h.undo(md); md.pins = [];
    md.lights.push({ r: 3 }); h.record(md);
    expect(h.canRedo).toBe(false);
  });
  it('tokens and anything else outside the map tools are never a step', () => {
    const h = createHistory(), md = map();
    h.reset(md);
    md.tokens.a.x = 9; md.hp = 3;
    expect(h.record(md)).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(PARTS).not.toContain('tokens');
  });
  it('a change from elsewhere (rebase) is not a step, and the next own edit holds only its own change', () => {
    const h = createHistory(), md = map();
    h.reset(md);
    md.walls.push({ id: 'theirs' }); h.rebase(md);
    expect(h.canUndo).toBe(false);
    md.walls.push({ id: 'mine' }); h.record(md);
    expect(h.undo(md)).toEqual({ walls: [{ id: 'theirs' }] });
  });
  it('one save that changed several parts (a VTT import) is one step', () => {
    const h = createHistory(), md = map();
    h.reset(md);
    md.walls.push({ id: 'w' }); md.doors.d = { state: 'closed' }; md.lights.push({});
    expect(h.record(md).sort()).toEqual(['doors', 'lights', 'walls']);
    expect(Object.keys(h.undo(md)).sort()).toEqual(['doors', 'lights', 'walls']);
  });
  it('the steps it holds are copies: later edits do not reach into them', () => {
    const h = createHistory(), md = map();
    h.reset(md);
    md.walls.push({ id: 'w1' }); h.record(md);
    md.walls[0].id = 'changed'; md.walls.push({ id: 'w2' }); h.record(md);
    expect(h.undo(md)).toEqual({ walls: [{ id: 'w1' }] });
  });
  it('keeps at most `limit` steps', () => {
    const h = createHistory(3), md = map();
    h.reset(md);
    for (let i = 0; i < 5; i++) { md.pins.push({ i }); h.record(md); }
    let n = 0; while (h.undo(md)) n++;
    expect(n).toBe(3);
  });
  it('a step pushed by hand (the fog brush) undoes like any other', () => {
    const h = createHistory(), md = { ...map(), fogState: { '1,1': 'visible' } };
    h.reset(md);
    h.push({ fogState: {} });
    expect(h.undo(md)).toEqual({ fogState: {} });
    expect(h.redo(md)).toEqual({ fogState: { '1,1': 'visible' } });
  });
  it('nothing to undo is null, not a throw', () => {
    const h = createHistory();
    expect(h.undo(map())).toBe(null);
    expect(h.record(map())).toEqual([]); // the first record only starts the history
  });
});

describe('fogCells', () => {
  it('sends every square that changes; one the old fog lacked goes back to unexplored', () => {
    expect(fogCells({ '1,1': 'visible' }, { '1,1': 'visible', '2,2': 'visible' }).sort())
      .toEqual([['1,1', 'visible'], ['2,2', 'unexplored']]);
    expect(fogCells({}, { '3,3': 'explored' })).toEqual([['3,3', 'unexplored']]);
  });
});

describe('describe', () => {
  it('names the parts in words', () => expect(words(['audioZones', 'triggers', 'fogState'])).toBe('sound zones, traps, fog'));
});
