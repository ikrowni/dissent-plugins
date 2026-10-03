import { describe, it, expect } from 'vitest';
import { SECTIONS, TAB_LABELS, sectionOf, ALL_TABS } from './dnd-master-sections.js';

describe('DM sections', () => {
  it('puts every tool except Setup in exactly one section', () => {
    const placed = SECTIONS.flatMap(s => s.tabs);
    const expected = ALL_TABS.filter(t => t !== 'settings');
    expect([...placed].sort()).toEqual([...expected].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });
  it('has five sections with icons and labels', () => {
    expect(SECTIONS.map(s => s.id)).toEqual(['run', 'foes', 'world', 'loot', 'sound']);
    for (const s of SECTIONS) { expect(s.label).toBeTruthy(); expect(s.icon).toBeTruthy(); }
  });
  it('labels every tab and maps it back to its section', () => {
    for (const s of SECTIONS) for (const t of s.tabs) {
      expect(TAB_LABELS[t]).toBeTruthy();
      expect(sectionOf(t)).toBe(s.id);
    }
    expect(sectionOf('settings')).toBe(null);
  });
  it('has the Homebrew tab in World (subclasses and feats the DM types in)', () => {
    expect(sectionOf('homebrew')).toBe('world');
    expect(TAB_LABELS.homebrew).toBe('Homebrew');
  });
});
