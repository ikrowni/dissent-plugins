// plugins/lk-guides.test.js
import { describe, it, expect } from 'vitest';
import { TIPS, tipFor, markSeen, guidesDefault } from './lk-guides.js';

describe('guides', () => {
  const on = guidesDefault();
  it('starts on, with nothing seen', () => expect(on).toEqual({ on: true, seen: [] }));
  it('a trigger shows its tip once', () => {
    const t = tipFor('player:table', on);
    expect(t.id).toBe('player:table');
    expect(t.title).toBeTruthy();
    const after = markSeen(on, t.id);
    expect(tipFor('player:table', after)).toBeNull();
    expect(after).toEqual({ on: true, seen: ['player:table'] }); // a new object
    expect(on.seen).toEqual([]);
  });
  it('nothing when guides are off, or for an unknown trigger', () => {
    expect(tipFor('player:table', { on: false, seen: [] })).toBeNull();
    expect(tipFor('nonsense', on)).toBeNull();
  });
  it('a stored value from an older shape is read safely', () => {
    expect(tipFor('player:table', null)?.id).toBe('player:table');
    expect(tipFor('player:table', { seen: 'x' })?.id).toBe('player:table');
  });
  it('every tip is short, has a title, and names where it points (or nowhere)', () => {
    for (const t of Object.values(TIPS)) {
      expect(t.title.length).toBeLessThanOrEqual(40);
      expect(t.text.length).toBeLessThanOrEqual(260);
      expect(['hub', 'sheet']).toContain(t.surface);
    }
    // No trademark in user-facing text.
    expect(JSON.stringify(TIPS)).not.toMatch(/D&D|Dungeons/);
  });
});
