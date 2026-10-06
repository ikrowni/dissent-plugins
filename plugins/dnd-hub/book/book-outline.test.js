// plugins/dnd-hub/book/book-outline.test.js — the PDF's own bookmarks as the book's index. Hand-written lines only.
import { describe, it, expect } from 'vitest';
import { findStory } from './book-story.js';
import { outlineMarks, flatOutline } from './book-outline.js';
import { L, H } from './book-fixtures.js';

const at = (line, page) => ({ ...line, page });
const LINES = [
  at(H('Monster Hunting', 24), 1),
  at(L('Hunters track their quarry for days.'), 1),
  at(H('L FIGURE STANDS SILHOUETTED AGAINST THE', 20), 1), // big text that is not a heading (art caption, a scan)
  at(L('The tracks lead north.'), 1),
  at(H('Tracking', 14), 2),
  at(L('Roll Survival to follow tracks.'), 2),
  at(H('Harvesting', 14), 3),
  at(L('Parts can be sold.'), 3),
];
const OUTLINE = [
  { title: 'Monster Hunting', page: 1, depth: 0 },
  { title: 'Tracking', page: 2, depth: 1 },
  { title: 'Harvesting', page: 3, depth: 1 },
  { title: 'Goblin', page: 3, depth: 1 },   // a stat block took these lines: they match nothing in the story
  { title: 'Owlbear', page: 3, depth: 1 },
];

describe('the PDF bookmarks are the index', () => {
  it('sections come from the bookmarks; other big text stays inside its section', () => {
    const s = findStory(LINES, { outline: OUTLINE });
    expect(s.map(x => [x.chapter, x.title])).toEqual([
      ['Monster Hunting', 'Monster Hunting'],
      ['Monster Hunting', 'Tracking'],
      ['Monster Hunting', 'Harvesting'],
    ]);
  });

  it('a bookmark matches its heading loosely (numbering, case, punctuation)', () => {
    const marks = outlineMarks([at(H('POLYHEDROOZE', 20), 7), at(L('text'), 7)], [{ title: '1 — Polyhedrooze', page: 7, depth: 0 }]);
    expect([...marks.entries()]).toEqual([[0, { title: '1 — Polyhedrooze', level: 'chapter' }]]);
  });

  it('a bookmark whose heading is not in the story (a stat block took it) opens nothing', () => {
    const marks = outlineMarks(LINES, OUTLINE);
    expect([...marks.values()].map(m => m.title)).toEqual(['Monster Hunting', 'Tracking', 'Harvesting']);
  });

  it('without bookmarks (or when none match) the headings are found by size, as before', () => {
    const plain = findStory(LINES);
    expect(findStory(LINES, { outline: [{ title: 'Nothing like it', page: 9, depth: 0 }] })).toEqual(plain);
  });
});

describe('flatOutline', () => {
  it('flattens nested bookmarks with their depth, in page order', () => {
    const tree = [
      { title: 'Bestiary', page: 500, items: [{ title: 'Owlbear', page: 501, items: [] }] },
      { title: 'Introduction', page: 4, items: [{ title: 'Tracking', page: 5, items: [] }] },
    ];
    expect(flatOutline(tree)).toEqual([
      { title: 'Introduction', page: 4, depth: 0 }, { title: 'Tracking', page: 5, depth: 1 },
      { title: 'Bestiary', page: 500, depth: 0 }, { title: 'Owlbear', page: 501, depth: 1 },
    ]);
  });
});

describe('real outlines are untidy', () => {
  it('the same bookmark repeated on one page is listed once', () => {
    const tree = [{ title: 'Hunt Summary', page: 8, items: [{ title: 'Hunt Summary', page: 8, items: [] }, { title: 'hunt summary', page: 8, items: [] }] }];
    expect(flatOutline(tree)).toEqual([{ title: 'Hunt Summary', page: 8, depth: 0 }]);
  });

  it('a run of top-level bookmarks with nothing under them are sections, not chapters (spells bookmarked flat)', () => {
    const leaf = (title, page) => ({ title, page, items: [] });
    const tree = [{ title: 'Part One', page: 1, items: [leaf('Tracking', 2)] }, leaf('Acid Rain', 50), leaf('Bone Cage', 51), leaf('Eelskin', 52)];
    expect(flatOutline(tree).map(e => [e.title, e.depth])).toEqual([['Part One', 0], ['Tracking', 1], ['Acid Rain', 1], ['Bone Cage', 1], ['Eelskin', 1]]);
  });

  it('a chapter-sized heading that is not bookmarked still opens a chapter', () => {
    const lines = [...LINES, at(H('Appendix B — Spells', 24), 4), at(L('Spells of the hunt.'), 4), at(H('Acid Rain', 14), 5), at(L('A green rain falls.'), 5)];
    const s = findStory(lines, { outline: [...OUTLINE, { title: 'Acid Rain', page: 5, depth: 1 }] });
    expect(s.slice(-2).map(x => [x.chapter, x.title])).toEqual([['Appendix B — Spells', 'Appendix B — Spells'], ['Appendix B — Spells', 'Acid Rain']]);
  });

  it('a section before any chapter is its own chapter, not a blank one', () => {
    const s = findStory([at(H('Introduction', 14), 1), at(L('Welcome.'), 1), ...LINES.map(l => ({ ...l, page: l.page + 1 }))],
      { outline: [{ title: 'Introduction', page: 1, depth: 1 }, ...OUTLINE.map(e => ({ ...e, page: e.page + 1 }))] });
    expect(s[0].chapter).toBe('Introduction');
  });
});

describe('chapters by name', () => {
  it('an "Appendix …" or "Chapter …" bookmark is a chapter wherever the outline nests it', () => {
    const marks = outlineMarks([at(H('Appendix B — Spells', 24), 4), at(L('x'), 4)], [{ title: 'Appendix B — Spells', page: 4, depth: 1 }]);
    expect(marks.get(0).level).toBe('chapter');
  });
});

describe('how deep the index goes', () => {
  const lines = [at(H('Part II: Creating a Character', 24), 1), at(L('x'), 1), at(H('Chapter 1. Classes', 20), 2), at(L('x'), 2),
    at(H('Adept', 16), 3), at(L('x'), 3), at(H('Class Features', 14), 3), at(L('x'), 3), at(H('Hit Points', 12), 3), at(L('x'), 3)];
  const outline = [{ title: 'Part II: Creating a Character', page: 1, depth: 0 }, { title: 'Chapter 1. Classes', page: 2, depth: 1 },
    { title: 'Adept', page: 3, depth: 2 }, { title: 'Class Features', page: 3, depth: 3 }, { title: 'Hit Points', page: 3, depth: 4 }];

  it('one level under its chapter is a section; deeper bookmarks are headings inside it', () => {
    const s = findStory(lines, { outline });
    expect(s.map(x => [x.chapter, x.title])).toEqual([
      ['Part II: Creating a Character', 'Part II: Creating a Character'], ['Chapter 1. Classes', 'Chapter 1. Classes'], ['Chapter 1. Classes', 'Adept']]);
  });

  it('an outline that starts below the top is read from its own top', () => {
    expect(flatOutline([{ title: 'A', page: 1, items: [] }].map(e => ({ ...e, items: [{ title: 'B', page: 2, items: [] }] })))
      .map(e => e.depth)).toEqual([0, 1]);
    const marks = outlineMarks([at(H('Classes', 20), 1), at(L('x'), 1)], [{ title: 'Classes', page: 1, depth: 1 }]);
    expect(marks.get(0).level).toBe('chapter'); // nothing above it in this outline
  });

  it('a book with only a bookmark or two keeps finding headings by size', () => {
    const one = [{ title: 'Part II: Creating a Character', page: 1, depth: 0 }];
    expect(findStory(lines, { outline: one })).toEqual(findStory(lines));
  });
});
