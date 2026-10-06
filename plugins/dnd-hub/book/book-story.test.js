// plugins/dnd-hub/book/book-story.test.js
import { describe, it, expect } from 'vitest';
import { findStory } from './book-story.js';
import { STORY } from './book-fixtures.js';

// The reader shows the real pages (plan 2026-10-06 page reader): findStory is the book's INDEX, never its text.
describe('findStory', () => {
  const s = findStory(STORY);
  it('splits chapters into sections by heading size; smaller headings stay inside', () => {
    expect(s.map(x => [x.chapter, x.title])).toEqual([
      ['Chapter 1: The Drowned Bell', 'Chapter 1: The Drowned Bell'],
      ['Chapter 1: The Drowned Bell', 'Arriving in Brinemoor'],
      ['Chapter 2: Under the Waves', 'Chapter 2: Under the Waves'],
    ]);
  });
  it('an index line is where a section starts, and nothing of its text', () => {
    for (const x of s) expect(Object.keys(x).sort()).toEqual(['chapter', 'id', 'page', 'title']);
  });
  it('a heading with nothing under it before the next is not an index line', () => {
    const empty = { ...STORY[4], text: 'Empty Room', runs: [{ text: 'Empty Room', font: 'bold' }] };
    const st = findStory([...STORY.slice(0, 4), empty, ...STORY.slice(4)]);
    expect(st.map(x => x.title)).toEqual(s.map(x => x.title));
  });
  it('ids are unique and stable', () => {
    expect(new Set(s.map(x => x.id)).size).toBe(3);
    expect(findStory(STORY)[1].id).toBe(s[1].id);
  });
});
function H2(t) { return { ...STORY[0], text: t, runs: [{ text: t, font: 'bold' }] }; }

describe('keyed areas', () => {
  const L = (text, size) => ({ ...STORY[1], text, size, runs: [{ text, font: size > 11 ? 'bold' : 'body' }] });
  const body = t => L(t, 9.8);
  it('"12.", "23A." and a lettered key ("Q12.", read from a scan as "Ql2.") open a section of their own', () => {
    const st = findStory([L('Chapter 4: Castle', 18), body('Text.'), L('The Keep', 13.9), body('Text.'), L('Notes', 12), body('More.'),
      L('12. Master Suite', 12), body('A bed.'), L('23A. Empty Crypt', 12), body('Dust.'), L('Q12. Dining Hall', 12), body('A table.'),
      L('Ql3. Kitchen', 12), body('Pots.'), L('Chapter 5: Village', 18), body('Text.'), L('Notes', 12), body('More text.')]);
    expect(st.map(x => x.title)).toEqual(['Chapter 4: Castle', 'The Keep', '12. Master Suite', '23A. Empty Crypt', 'Q12. Dining Hall',
      'Ql3. Kitchen', 'Chapter 5: Village']);
  });
});

