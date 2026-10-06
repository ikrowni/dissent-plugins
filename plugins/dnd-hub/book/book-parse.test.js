// plugins/dnd-hub/book/book-parse.test.js
import { describe, it, expect } from 'vitest';
import { parseBook } from './book-parse.js';
import { MUDLING, SPELLS, ITEMS, STORY } from './book-fixtures.js';

describe('parseBook', () => {
  const lines = [...STORY, ...MUDLING, ...SPELLS, ...ITEMS];
  const b = parseBook(lines);
  it('finds each kind once, and leaves the story what nobody claimed', () => {
    expect(b.counts).toMatchObject({ monsters: 1, spells: 2, items: 2, unsure: 0 });
    const storyText = b.story.map(s => s.html).join(' ');
    expect(storyText).not.toContain('Armor Class');
    expect(storyText).not.toContain('Casting Time');
    expect(storyText).toContain('Brinemoor');
  });
  it('makes ids unique within a book', () => {
    const twice = parseBook([...MUDLING, ...MUDLING]);
    expect(twice.monsters.map(m => m.id)).toEqual(['mudling', 'mudling-2']);
  });
});


describe('where each find came from', () => {
  it('monsters, spells and items carry the page regions of their lines (src)', () => {
    const b = parseBook([...STORY, ...MUDLING, ...SPELLS, ...ITEMS]);
    for (const e of [...b.monsters, ...b.spells, ...b.items]) {
      expect(e.src?.length).toBeGreaterThan(0);
      expect(e.src[0]).toMatchObject({ page: 1 });
    }
  });
});
