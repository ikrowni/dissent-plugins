// plugins/dnd-hub/book/book-scan.test.js — a scanned book: one font, OCR noise. Invented text, in the shapes a real
// scan produced (2026-10-04): noise between name and size line, junk on names, "+" read as 4, merged columns.
import { describe, it, expect } from 'vitest';
import { isScanned, isScanHeading, scoreRows, scanName, scanSize, textEntry, scanScores, scoresFitHp } from './book-scan.js';
import { findMonsters } from './book-monsters.js';
import { parseBook } from './book-parse.js';
import { findStory } from './book-story.js';

const S = (text, { size = 8.4, x = 30, page = 5 } = {}) => ({ text, size, runs: [{ text, font: 'ocr' }], page, x, y: 0 });
const filler = n => Array.from({ length: n }, (_, i) => S(`the road winds on through the mist and the trees ${i}`));

// A stat block as a scan reads it, with a story sidebar in the other column between traits and actions.
const MARSH = [
  S('MARSH LANTERN-WIGHT ae', { size: 14.5 }),
  S('is wa', { size: 8 }),
  S('“Medium undead, neutral evil'),
  S('_ Armor Class 13 (natural armor)'),
  S('Hit Points 33 (6d8 + 6)'),
  S('sober? 30 ft.'),
  S('_ STR DEX CON INT Wis CHA'),
  S('12 (+1) 14 (42) 12(+1) 9(-1) 10 (40) 15 (+2)'),
  S('Senses darkvision 60 ft., passive Perception 10'),
  S('_ Challenge 2 (450 XP)'),
  S('Lure of the Lamp. A creature that sees the wight’s lantern'),
  S('must succeed on a DC 12 Wisdom saving throw.'),
  S('THE WIGHT’S TALE', { size: 12.4, x: 280 }),
  S('Long ago the wight was a lamplighter who walked', { x: 280 }),
  S('the causeway every night.', { x: 280 }),
  S('ACTIONS', { size: 9.5, x: 280 }),
  S('Multiattack. The wight makes two claw attacks.', { x: 280 }),
  S('Claw. Melee Weapon Attack: +4 to hit, reach 5 ft., one target.', { x: 280 }),
  S('Hit: 5 (1d6 + 2) slashing damage.', { x: 280 }),
  S('THE CAUSEWAY', { size: 13.8 }),
  S('Farewell. When the party leaves the causeway, read the following.'),
];
const BOOK = [...filler(200), ...MARSH, ...filler(5)];

describe('scanned books', () => {
  it('is recognised by having no styles at all; a digital book is not', () => {
    expect(isScanned(BOOK)).toBe(true);
    expect(isScanned(BOOK.map((l, i) => (i % 7 ? l : { ...l, runs: [{ text: 'A.', font: 'bold' }, { text: l.text, font: 'ocr' }] })))).toBe(false);
    expect(parseBook(BOOK).scanned).toBe(true);
  });
  it('tidies names, keeps book-style commas, cuts at a merged column, refuses body text', () => {
    expect(scanName('GUARDIAN PorTRAIT et')).toBe('Guardian Portrait');
    expect(scanName('BLIGHT, TREE')).toBe('Blight, Tree');
    expect(scanName('ELDA D"AVENIR | Be ~ ACTIONS')).toBe('Elda D’Avenir');
    expect(scanName("STRAHD'S GOALS")).toBe("Strahd's Goals");
    expect(scanName('is wa')).toBeNull();
    expect(scanName('APPENDIX D')).toBeNull();
    expect(scanName('Armor Class 15')).toBeNull();
  });
  it('reads a size line with junk around it', () => {
    expect(scanSize('“Medium humanoid (elf), lawful evil as * i')).toEqual({ size: 'Medium', type: 'humanoid', subtype: 'elf', alignment: 'lawful evil' });
  });
  it('finds "Name. text" entries without bold, but not sentences or attack lines', () => {
    expect(textEntry('Mask of the Wild. It hides.')).toEqual({ name: 'Mask of the Wild', rest: 'It hides.' });
    expect(textEntry('Bite (Bat Form Only). Melee Weapon Attack')?.name).toBe('Bite (Bat Form Only)');
    expect(textEntry('The hut is incapacitated. So it waits.')).toBeNull();
    expect(textEntry('Hit: 5 (1d6 + 2) slashing damage.')).toBeNull();
  });
  it('takes scores only when six plausible ones are there, and checks them against the hit dice', () => {
    expect(scanScores(['14 (+2) 22 (+6) 17(43) 15 (+2) 16 (+3) 18 (+4)'])).toEqual([14, 22, 17, 15, 16, 18]);
    expect(scanScores(['P2648) 72). 205). 1 (<5): &34)'])).toBeNull();
    expect(scoresFitHp(17, '18d8+54')).toBe(true);
    expect(scoresFitHp(16, '5d8')).toBe(false); // a neighbour's row: CON 16 would make it 5d8 + 15
  });
  it('reads the block: name past the noise, actions across the sidebar, and stops at the next heading', () => {
    const [m, ...rest] = findMonsters(BOOK);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ name: 'Marsh Lantern-Wight', size: 'Medium', type: 'undead', alignment: 'neutral evil',
      ac: 13, hp: 33, hp_dice: '6d8+6', cr: 2, str: 12, dex: 14, con: 12, int: 9, wis: 10, cha: 15 });
    expect(m.special_abilities.map(a => a.name)).toEqual(['Lure of the Lamp']);
    expect(m.special_abilities[0].desc).not.toMatch(/lamplighter/); // the sidebar is not the trait's text
    expect(m.actions.map(a => a.name)).toEqual(['Multiattack', 'Claw']);
    expect(m.actions[1].attack_bonus).toBe(4);
    expect(m.confidence).toBe('sure'); // every number checks itself (HP = dice average, CON = dice bonus): ticked since 2026-10-06
    expect(m.problems).toEqual(['read from a scan']);
  });
  it('a second creature’s numbers end a block instead of replacing its own', () => {
    // Two columns run together: the neighbour's Armor Class is not a block start (no Hit Points under it).
    const two = [...filler(200), ...MARSH.slice(0, 10), S('Armor Class 18 (plate)'), S('Speed 40 ft.'), S('Senses —'),
      S('Hit Points 99 (11d10 + 33)')];
    const [m] = findMonsters(two);
    expect([m.ac, m.hp]).toEqual([13, 33]);
  });
  it('scores that do not fit the hit dice are left unread (a neighbour’s row), not shown wrong', () => {
    const off = [...filler(200), ...MARSH.map(l => (/^Hit Points/.test(l.text) ? S('Hit Points 27 (6d8)') : l))];
    const [m] = findMonsters(off);
    expect([m.str, m.con, m.cha]).toEqual([null, null, null]);
    expect(m.problems).toContain('ability scores not read');
  });
  it('splits a scan’s story at headings known by their look, not by an exact font size', () => {
    const lines = [S('CHAPTER 2: THE', { size: 18.1 }), S('A low country.', { x: 80 }), S('MARSH', { size: 17.6, x: 280 }), S('The marsh is cold.'), S('THE CAUSEWAY', { size: 14.2 }),
      S('Stones lead across.'), S('OLD MILL', { size: 13.4 }), S('A wheel turns.'), S('WHEEL ROOM', { size: 11.9 }), S('Dust.')];
    const st = findStory(lines, { scanned: true });
    expect(st.map(x => [x.chapter, x.title])).toEqual([['Chapter 2: the Marsh', 'Chapter 2: the Marsh'],
      ['Chapter 2: the Marsh', 'The Causeway'], ['Chapter 2: the Marsh', 'Old Mill']]);
    const v = findStory([S('CHAPTER 3: THE VILLAGE', { size: 17.2 }), S('Smoke rises.'), S('OF BAROVIA', { size: 17.4 }), S('Doors are shut.')], { scanned: true });
    expect(v.map(x => x.title)).toEqual(['Chapter 3: the Village of Barovia']);
  });
});

describe('a keyed area on a scan', () => {
  it('"Q12. DINING HALL" (read as "Ql2.") is a heading; a stat line with numbers is not', () => {
    const big = text => ({ text, size: 13, runs: [], page: 1, x: 0, y: 0 });
    expect(isScanHeading(big('Ql2. DINING HALL'))).toBe(true);
    expect(isScanHeading(big('K20. BELFRY'))).toBe(true);
    expect(isScanHeading(big('STR 18 (+4) DEX 12'))).toBe(false);
  });
});

// Van Richten's Guide to Ravenloft (owner's Internet Archive scan, 2026-10-06): every one of its 36 creatures came out
// "size not read", 22 "ability scores not read".
describe('a 2021-style scan', () => {
  it('a size line with no alignment ("Huge Plant") is read', () => {
    expect(scanSize('Huge Plant')).toEqual({ size: 'Huge', type: 'Plant', subtype: null, alignment: '' });
    expect(scanSize('Medium Undead, Typically Chaotic Evil')).toMatchObject({ size: 'Medium', type: 'Undead', alignment: 'Chaotic Evil' });
  });
  it('a score row with OCR marks between the scores is read', () => {
    expect(scanScores(['18 (+4) 8 (-1) 20 (+5) 14 (+2) =14. (+2) ~—-18 (+4)'])).toEqual([18, 8, 20, 14, 14, 18]);
  });
  it('🔴 one score that does not fit its modifier spoils the row — a wrong number is worse than none', () => {
    // Rahadin, a copy whose text layer read "22 (+6)" as "2 (+6)": the old "four of six agree" rule took DEX 2.
    expect(scanScores(['14 (+2) 2 (+6) 17 (+3) 15 (+2) 16 (+3) 18 (+4)'])).toBe(null);
    // A printed slip (one modifier off by one: Iron Route's "11 (+1)") is not a misread; two are.
    expect(scanScores(['14 (+2) 10 (+0) 12 (+1) 11 (+1) 13 (+1) 16 (+3)'])).toEqual([14, 10, 12, 11, 13, 16]);
    expect(scanScores(['14 (+2) 10 (+1) 12 (+1) 11 (+1) 13 (+1) 16 (+3)'])).toBe(null);
    // The sign is not trusted (OCR reads "−1" as "+1"), and "43" is "+3".
    expect(scanScores(['8 (+1) 13 (+1) 12 (+1) 11 (+0) 12 (+1) 9 (+1)'])).toEqual([8, 13, 12, 11, 12, 9]);
    expect(scanScores(['14 (+2) 22 (+6) 17(43) 15 (+2) 16 (+3) 18 (+4)'])).toEqual([14, 22, 17, 15, 16, 18]);
  });
  it('six numbers whose modifiers mostly disagree are not scores', () => {
    expect(scanScores(['18 (+0) 8 (+3) 20 (-2) 14 (+5) 14 (-1) 18 (+1)'])).toBe(null);
  });
});

describe('a score row whose "(" and "+" the OCR read as 4', () => {
  it('"8(-1) 10440) 9(-1)" / "1341) 1140) 12(41)" is 8 10 9 13 11 12 (each modifier agrees)', () => {
    expect(scanScores(['8(-1) 10440) 9(-1)', '1341) 1140) 12(41)'])).toEqual([8, 10, 9, 13, 11, 12]);
  });
  it('garbage stays unread', () => {
    expect(scanScores(['16(43)a. 14 G2yrent5 2). 41.5) 10-0) cers)'])).toBe(null);
  });
});

describe('a score header split over two lines', () => {
  it('"CHA" alone under "STR DEX CON INT WIS" is skipped: the next two lines are the scores', () => {
    const rows = scoreRows(['CHA', '8(-1) 10440) 9(-1)', '1341) 1140) 12(41)', 'Senses passive Perception 10']);
    expect(rows).toEqual(['8(-1) 10440) 9(-1)', '1341) 1140) 12(41)']);
    expect(scanScores(rows)).toEqual([8, 10, 9, 13, 11, 12]);
  });
});
