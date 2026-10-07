// plugins/dnd-hub/book/book-merge.test.js
import { describe, it, expect } from 'vitest';
import { mergeReadings, mergeCopies, mergeItemCopies } from './book-merge.js';
import { withProblems } from './book-monsters.js';

const M = (o) => withProblems({ id: 'x', name: 'X', size: null, type: null, subtype: null, alignment: '', ac: null, ac_type: null,
  hp: null, hp_dice: null, speed: {}, str: null, dex: null, con: null, int: null, wis: null, cha: null, saving_throws: [],
  skills: [], damage_resistances: [], damage_immunities: [], damage_vulnerabilities: [], condition_immunities: [], senses: {},
  languages: '', cr: null, xp: null, special_abilities: [], actions: [], reactions: [], legendary_actions: [], page: 5,
  lines: [0, 1], scan: true, unnamed: false, farName: false, ...o });
const SC = { str: 14, dex: 22, con: 17, int: 15, wis: 16, cha: 18 };

describe('two readings of a scan', () => {
  it('keeps the OCR reading and fills its gaps from the scan’s own text', () => {
    const ocr = [M({ name: 'Rahadin', size: 'Medium', type: 'humanoid', ac: 18, hp: 135, cr: 10, actions: [{ name: 'Scimitar', desc: '' }] })];
    const own = [M({ name: 'Rahadln', ac: 18, hp: 135, cr: 10, ...SC, special_abilities: [{ name: 'Deathly Choir', desc: '' }] })];
    const [m, ...rest] = mergeReadings(ocr, own);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ name: 'Rahadin', size: 'Medium', ...SC, actions: [{ name: 'Scimitar', desc: '' }] });
    expect(m.special_abilities.map(a => a.name)).toEqual(['Deathly Choir']);
    expect(m.problems).toEqual(['read from a scan']);
  });
  it('matches a reading that lost its hit points, and takes a name only where OCR had none', () => {
    const ocr = [M({ name: 'Unnamed (page 5)', unnamed: true, ac: 14, hp: 10, cr: 0.25 })];
    const own = [M({ name: 'Pidlwick II', ac: 14, hp: null, cr: 0.25, page: 6 })];
    const out = mergeReadings(ocr, own);
    expect(out.map(m => [m.name, m.id, m.hp])).toEqual([['Pidlwick II', 'pidlwick-ii', 10]]);
    expect(out[0].problems).not.toContain('name not read');
  });
  it('keeps a creature only the scan’s own text found, and does not merge different ones', () => {
    const out = mergeReadings([M({ name: 'Broom', ac: 15, hp: 17 })], [M({ name: 'Hut', ac: 16, hp: 263 })]);
    expect(out.map(m => [m.name, m.lines])).toEqual([['Broom', [0, 1]], ['Hut', null]]);
  });
  it('keeps a place to read the score row from while the scores are still unread, from either reading', () => {
    const at = { page: 9, x0: 1, x1: 2, top: 3, bottom: 4, fromTop: true };
    const unread = { str: null, dex: null, con: null, int: null, wis: null, cha: null };
    const [m] = mergeReadings([M({ ...unread })], [M({ ...unread, scoreSrc: at })]);
    expect(m.scoreSrc).toBe(at);
    const [n] = mergeReadings([M({ ...unread, scoreSrc: at })], [M({ ...SC })]);
    expect(n.scoreSrc).toBeUndefined(); // the scan's own text had the scores
  });
});

// The owner imported "smaller" and "larger" copies of one scanned Curse of Strahd: every creature twice, each copy
// reading different parts (Broom: CR in one, scores in the other).
describe('the same book in two PDFs', () => {
  const unread = { str: null, dex: null, con: null, int: null, wis: null, cha: null };
  it('one creature, the better reading filled from the other, the nicer name', () => {
    const a = M({ name: 'BROOM OF ANIMATED ATTACK', ac: 15, hp: 17, page: 226, doc: 0, ...SC, actions: [{ name: 'Broom' }] });
    const b = M({ name: 'Broom of Animated Attack', ac: 15, hp: 17, cr: 0.25, xp: 50, page: 226, doc: 1, ...unread, actions: [{ name: 'Broom' }] });
    const [m, ...rest] = mergeCopies([a, b]);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ name: 'Broom of Animated Attack', cr: 0.25, str: 14, doc: 0 });
    expect(m.problems).not.toContain('no challenge rating');
  });

  it('never merges two creatures of one PDF, nor different creatures', () => {
    const a = M({ name: 'Wolf', ac: 13, hp: 11, page: 9, doc: 0 }), b = M({ name: 'Wolf', ac: 13, hp: 11, page: 9, doc: 0 });
    expect(mergeCopies([a, b])).toHaveLength(2);
    expect(mergeCopies([M({ name: 'Wolf', ac: 13, hp: 11, page: 9, doc: 0 }), M({ name: 'Dire Wolf', ac: 14, hp: 37, page: 9, doc: 1 })])).toHaveLength(2);
  });

  it('a third copy merges too, and a region from the other PDF is never kept', () => {
    const at = { page: 9, x0: 1, x1: 2, top: 3, bottom: 4, fromTop: true };
    const one = mergeCopies([M({ name: 'Wolf', ac: 13, hp: 11, page: 9, doc: 0, ...unread }), M({ name: 'Wolf', ac: 13, hp: 11, page: 9, doc: 1, ...unread, scoreSrc: at }),
      M({ name: 'Wolf', ac: 13, hp: 11, page: 9, doc: 2, ...unread })]);
    expect(one).toHaveLength(1);
    expect(one[0].scoreSrc).toBeUndefined();
  });

  it('magic items spelled differently by the OCR are one item, the sure one kept', () => {
    const items = mergeItemCopies([
      { id: 'a', name: '!CON OF RAVENLOFT', page: 222, doc: 0, confidence: 'sure', problems: [] },
      { id: 'b', name: 'IcoN OF RAVENLOFT', page: 222, doc: 1, confidence: 'unsure', problems: ['read from a scan'] },
      { id: 'c', name: 'Sunsword', page: 223, doc: 1, confidence: 'sure', problems: [] },
    ]);
    expect(items.map(e => e.id)).toEqual(['a', 'c']);
  });
});
