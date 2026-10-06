// plugins/lk-book.test.js
import { describe, it, expect } from 'vitest';
import { makeBook, playerPart, mergeContent, BOOK_FORMAT, bookFileName, bookTitleFromFile, toPack, fromPack, packFileName } from './lk-book.js';

const parsed = {
  monsters: [{ id: 'mudling', name: 'Mudling', confidence: 'sure', problems: [], lines: [0, 9], hp: 9 }],
  spells: [{ id: 'ember-dart', name: 'Ember Dart', level: 1, confidence: 'sure', problems: [], lines: [10, 20] },
    { id: 'fire-bolt', name: 'Fire Bolt', level: 0, confidence: 'unsure', problems: ['no range'], lines: [21, 22] }],
  items: [{ id: 'lantern', name: 'Lantern', confidence: 'sure', problems: [], lines: [30, 31] }],
  story: [{ id: 'ch1', title: 'Chapter 1', chapter: 'Chapter 1', html: '<p>x</p>', readAloud: [] }],
};

describe('makeBook', () => {
  const b = makeBook({ title: 'The Drowned Bell', parsed, keep: { spells: ['ember-dart'] } , id: 'b1', now: '2026-10-04' });
  it('keeps only what the DM kept, without the parser\'s working fields', () => {
    expect(b).toMatchObject({ formatVersion: BOOK_FORMAT, id: 'b1', title: 'The Drowned Bell', createdAt: '2026-10-04' });
    expect(b.spells.map(s => s.id)).toEqual(['ember-dart']);
    expect(b.spells[0]).not.toHaveProperty('confidence');
    expect(b.spells[0]).not.toHaveProperty('lines');
    expect(b.spells[0].source).toEqual({ book: 'b1', title: 'The Drowned Bell' });
  });
  it('a kind with no keep list keeps everything', () => {
    expect(b.monsters.map(m => m.id)).toEqual(['mudling']);
    expect(b.story).toHaveLength(1);
  });
});

describe('playerPart', () => {
  it('holds only what players may see at once: spells and items', () => {
    const b = makeBook({ title: 'T', parsed, id: 'b1' });
    const p = playerPart(b);
    expect(Object.keys(p).sort()).toEqual(['formatVersion', 'id', 'items', 'spells', 'title']);
    expect(p).not.toHaveProperty('monsters');
    expect(p).not.toHaveProperty('story');
  });
});

describe('mergeContent', () => {
  const srd = [{ id: 'fire-bolt', name: 'Fire Bolt' }, { id: 'light', name: 'Light' }];
  it('no books: the SRD list itself, unchanged', () => {
    expect(mergeContent(srd, [])).toBe(srd);
  });
  it('adds book entries; on a clash the book wins; broken entries are skipped and counted', () => {
    const books = [{ id: 'b1', title: 'T', spells: [{ id: 'fire-bolt', name: 'Fire Bolt', level: 0, source: { book: 'b1' } },
      { id: 'ember-dart', name: 'Ember Dart' }, { name: 'no id' }, null] }];
    const out = mergeContent(srd, books, 'spells');
    expect(out.map(s => s.id)).toEqual(['fire-bolt', 'light', 'ember-dart']);
    expect(out[0].source).toEqual({ book: 'b1' });
    expect(out.skipped).toBe(2);
  });
});

describe('file names', () => {
  it('a book file is named after the book, and reads back', () => {
    const n = bookFileName({ id: 'b1', title: 'The Drowned Bell: Part 1/2' });
    expect(n).toBe('LanternKeep book - The Drowned Bell Part 1 2 (b1).json');
    expect(bookTitleFromFile(n)).toEqual({ id: 'b1', title: 'The Drowned Bell Part 1 2' });
    expect(bookTitleFromFile('map.png')).toBeNull();
  });
});

describe('.lkpack', () => {
  const book = makeBook({ title: 'The Drowned Bell', parsed, id: 'b1' });
  it('round-trips a book into the review screen\'s shape', () => {
    const back = fromPack(toPack(book));
    expect(back.title).toBe('The Drowned Bell');
    expect(back.parsed.monsters.map(m => m.id)).toEqual(['mudling']);
    expect(back.parsed.story.map(s => s.id)).toEqual(['ch1']);
  });
  it('refuses what is not a book, or from a newer format, in words a person can act on', () => {
    expect(() => fromPack('not json')).toThrow(/could not be read/);
    expect(() => fromPack(JSON.stringify({ kind: 'other' }))).toThrow(/not a LanternKeep book/);
    expect(() => fromPack(JSON.stringify({ kind: 'lanternkeep-book', formatVersion: 99, book: {} }))).toThrow(/newer/);
  });
  it('drops entries without an id and a name', () => {
    const p = fromPack(JSON.stringify({ kind: 'lanternkeep-book', formatVersion: 1, book: { title: 'T', spells: [{ id: 'a', name: 'A' }, { name: 'no id' }, 'x'] } }));
    expect(p.parsed.spells.map(s => s.id)).toEqual(['a']);
  });
  it('names the file after the book', () => expect(packFileName({ title: 'Part 1/2: Fog' })).toBe('Part 1 2 Fog.lkpack'));
});

describe('.lkpack pictures', () => {
  it('inlines the pictures given, and they come back for the review (without the old file ids)', () => {
    const book = { ...makeBook({ title: 'Maps', parsed, id: 'b2' }), images: [
      { id: 'p2-1', fileId: 'f-secret', page: 2, width: 1600, height: 1200, kind: 'map', title: 'Page 2 picture' },
      { id: 'p3-1', fileId: 'f-other', page: 3, width: 900, height: 1200, kind: 'art', title: 'Page 3 picture' }] };
    const text = toPack(book, { 'p2-1': 'QUJD' });
    expect(text).not.toContain('f-secret');
    const back = fromPack(text);
    expect(back.parsed.images).toEqual([{ id: 'p2-1', page: 2, width: 1600, height: 1200, kind: 'map', name: 'Page 2 picture', dataB64: 'QUJD' }]);
  });
});

describe('working data stays out of a saved book', () => {
  it('src (where an entry sat on the page) is not saved', () => {
    const book = makeBook({ title: 'T', id: 'b', parsed: { monsters: [{ id: 'm', name: 'M', src: [{ page: 1 }], lines: [0, 1] }] } });
    expect(book.monsters[0].src).toBeUndefined();
  });
});
