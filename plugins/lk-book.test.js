// plugins/lk-book.test.js
import { describe, it, expect } from 'vitest';
import { makeBook, playerPart, mergeContent, BOOK_FORMAT, bookFileName, bookTitleFromFile, toPack, fromPack, packFileName, bookDocs, indexEntry, bookFileIds, campaignItemFromBook } from './lk-book.js';

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

// Format 2 (plan 2026-10-06 page reader): the story is an INDEX into the real pages, page pictures live per PDF in
// `docs`, and a picture may be a box the DM cut from a page.
describe('format 2: the story is an index', () => {
  it('a story entry keeps only its title, chapter and where it is', () => {
    const b = makeBook({ title: 'T', id: 'b', parsed: { story: [
      { id: 's1', title: 'The Docks', chapter: 'Chapter 1', html: '<p>long text</p>', readAloud: ['x'], page: 12, doc: 1 },
      { id: 's2', title: 'Intro', chapter: '', page: 3 }] } });
    expect(BOOK_FORMAT).toBe(2);
    expect(b.story).toEqual([
      { id: 's1', title: 'The Docks', chapter: 'Chapter 1', doc: 1, page: 12 },
      { id: 's2', title: 'Intro', chapter: '', doc: 0, page: 3 }]);
  });
  it('indexEntry drops a page that is not a whole positive number', () => {
    expect(indexEntry({ id: 'a', title: 'A', page: 'x' })).toEqual({ id: 'a', title: 'A', chapter: '', doc: 0 });
    expect(indexEntry({ id: 'a', title: 'A', page: 0, doc: -1 })).toEqual({ id: 'a', title: 'A', chapter: '', doc: 0 });
  });
  it('players still get only spells and items: no index, no pictures', () => {
    const p = playerPart({ ...makeBook({ title: 'T', parsed, id: 'b1' }), images: [{ id: 'c1' }], docs: [{ count: 1 }] });
    expect(Object.keys(p).sort()).toEqual(['formatVersion', 'id', 'items', 'spells', 'title']);
  });
});

describe('bookDocs: where a book\'s page pictures are', () => {
  const packs = [{ fileId: 'f1', from: 1, to: 40 }];
  it('format 2: its docs, leaving out broken ones', () => {
    const docs = [{ name: 'Part 1', count: 40, fingerprint: 'abc', packs }, { name: 'bad' }, null];
    expect(bookDocs({ docs })).toEqual([{ name: 'Part 1', count: 40, fingerprint: 'abc', packs }]);
  });
  it('an old book with page pictures reads as one doc', () => {
    expect(bookDocs({ pages: { count: 40, packs } })).toEqual([{ name: '', count: 40, fingerprint: null, packs }]);
  });
  it('a book without page pictures has none', () => {
    expect(bookDocs({})).toEqual([]);
    expect(bookDocs(null)).toEqual([]);
  });
});

describe('.lkpack cuts', () => {
  const cut = { id: 'cut-1', fileId: 'f9', doc: 1, page: 7, rect: [0.1, 0.2, 0.5, 0.4], source: 'cut', width: 2048, height: 1200, kind: 'map', title: 'The docks' };
  it('a cut keeps its page, doc and box through a copy', () => {
    const back = fromPack(toPack({ ...makeBook({ title: 'T', parsed, id: 'b' }), images: [cut] }, { 'cut-1': 'QUJD' }));
    expect(back.parsed.images).toEqual([{ id: 'cut-1', page: 7, width: 2048, height: 1200, kind: 'map', name: 'The docks',
      dataB64: 'QUJD', doc: 1, rect: [0.1, 0.2, 0.5, 0.4], source: 'cut' }]);
  });
  it('a box that is not inside the page is dropped, with its picture', () => {
    for (const rect of [[0.6, 0, 0.5, 0.5], [0, 0, 0, 0.5], [-0.1, 0, 0.5, 0.5], [0, 0, 'x', 1], [0, 0, 1]]) {
      const back = fromPack(toPack({ title: 'T', id: 'b', images: [{ ...cut, rect }] }, { 'cut-1': 'QUJD' }));
      expect(back.parsed.images, JSON.stringify(rect)).toEqual([]);
    }
  });
  it('a format-1 copy still opens', () => {
    const p = fromPack(JSON.stringify({ kind: 'lanternkeep-book', formatVersion: 1, book: { title: 'Old',
      story: [{ id: 's', title: 'S', html: '<p>x</p>' }] } }));
    expect(p.parsed.story.map(s => s.id)).toEqual(['s']);
  });
});

describe('bookFileIds: every file a book owns (what deleting it removes)', () => {
  it('its pictures and every PDF\'s page packs, each once', () => {
    const book = { images: [{ fileId: 'a' }, { fileId: 'pk', packed: true }, { fileId: 'pk', packed: true }, {}],
      docs: [{ count: 9, packs: [{ fileId: 'p1', from: 1, to: 9 }] }, { count: 3, packs: [{ fileId: 'p2', from: 1, to: 3 }] }] };
    expect(bookFileIds(book)).toEqual(['a', 'pk', 'p1', 'p2']);
  });
  it('an old book\'s page packs too', () => {
    expect(bookFileIds({ pages: { count: 2, packs: [{ fileId: 'old', from: 1, to: 2 }] } })).toEqual(['old']);
  });
});

describe('campaignItemFromBook: a book\'s magic item as one of the campaign\'s items (DM sidebar → Loot → Items)', () => {
  const entry = { id: 'lantern-of-small-hours', name: 'Lantern of Small Hours', category: 'Wondrous Item', rarity: 'Rare',
    desc: 'It shows the way home.', source: { book: 'b1', title: 'The Drowned Bell' }, requires_attunement: true };
  it('keeps the name, text, rarity and where it came from', () => {
    expect(campaignItemFromBook(entry)).toEqual({ id: 'lantern-of-small-hours', name: 'Lantern of Small Hours', type: 'magic',
      description: 'It shows the way home.', rarity: 'Rare', effects: [], effectsText: '', source: { book: 'b1', title: 'The Drowned Bell' } });
  });
  it('a weapon, armour or potion keeps its kind', () => {
    expect(campaignItemFromBook({ ...entry, category: 'Weapon' }).type).toBe('weapon');
    expect(campaignItemFromBook({ ...entry, category: 'Armor' }).type).toBe('armor');
    expect(campaignItemFromBook({ ...entry, category: 'Armour' }).type).toBe('armor');
    expect(campaignItemFromBook({ ...entry, category: 'Potion' }).type).toBe('consumable');
  });
  it('nothing without an id and a name', () => {
    expect(campaignItemFromBook({ name: 'x' })).toBe(null);
    expect(campaignItemFromBook(null)).toBe(null);
  });
});
