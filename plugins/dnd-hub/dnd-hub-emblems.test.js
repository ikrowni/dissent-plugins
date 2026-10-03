// plugins/dnd-hub/dnd-hub-emblems.test.js
import { describe, it, expect } from 'vitest';
import { emblem, EMBLEM_IDS } from './dnd-hub-emblems.js';
import { RACE_INFO, CLASS_INFO } from './lk-hero-data.js';

describe('emblems', () => {
  it('draws one for every race and class', () => {
    const want = [...Object.keys(RACE_INFO).map(id => `race-${id}`), ...Object.keys(CLASS_INFO).map(id => `class-${id}`)];
    expect([...EMBLEM_IDS].sort()).toEqual(want.sort());
    for (const id of want) {
      const svg = emblem(id, 96);
      expect(svg).toMatch(/^<svg [^>]*width="96"/);
      expect(svg).toContain('stroke="currentColor"');
    }
  });
  it('draws nothing for an unknown id', () => {
    expect(emblem('race-nobody')).toBe('');
  });
});
