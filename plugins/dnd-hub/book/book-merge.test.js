// plugins/dnd-hub/book/book-merge.test.js
import { describe, it, expect } from 'vitest';
import { mergeReadings } from './book-merge.js';
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
});
