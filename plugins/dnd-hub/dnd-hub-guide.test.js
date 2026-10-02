import { describe, it, expect } from 'vitest';
import { setupChecklist, guideMode } from './dnd-hub-guide.js';

describe('setupChecklist', () => {
  it('a brand-new campaign has only the first step done', () => {
    const list = setupChecklist({ members: [] }, null);
    expect(list.map(s => [s.id, s.done])).toEqual([['campaign', true], ['map', false], ['walls', false], ['players', false]]);
  });
  it('ticks each step as the DM does it', () => {
    const list = setupChecklist({ members: ['p1'] }, { fileId: 'f', walls: [{}], doors: {} });
    expect(list.every(s => s.done)).toBe(true);
  });
  it('a door alone counts as walls drawn', () => {
    const list = setupChecklist({ members: [] }, { fileId: 'f', walls: [], doors: { d: {} } });
    expect(list.find(s => s.id === 'walls').done).toBe(true);
  });
});

describe('guideMode', () => {
  it('DM with no map: the full card in the middle', () => {
    expect(guideMode({ isDM: true, list: setupChecklist({ members: [] }, null), dismissed: false })).toBe('center');
  });
  it('DM with a map but steps left: a small corner card, unless dismissed', () => {
    const list = setupChecklist({ members: [] }, { fileId: 'f' });
    expect(guideMode({ isDM: true, list, dismissed: false })).toBe('corner');
    expect(guideMode({ isDM: true, list, dismissed: true })).toBe('none');
  });
  it('DM with everything done: nothing', () => {
    const list = setupChecklist({ members: ['p'] }, { fileId: 'f', walls: [{}] });
    expect(guideMode({ isDM: true, list, dismissed: false })).toBe('none');
  });
  it('player: a waiting card until there is a map', () => {
    expect(guideMode({ isDM: false, list: setupChecklist({ members: [] }, null), dismissed: false })).toBe('waiting');
    expect(guideMode({ isDM: false, list: setupChecklist({ members: [] }, { fileId: 'f' }), dismissed: false })).toBe('none');
  });
});
