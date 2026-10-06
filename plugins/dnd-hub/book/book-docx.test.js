// plugins/dnd-hub/book/book-docx.test.js — hand-written Word XML, never text from a real file.
import { describe, it, expect } from 'vitest';
import { docxLines, docxRels, headingName, xmlText } from './book-docx.js';
import { findMonsters } from './book-monsters.js';

const P = (runs, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs.map(([t, f = '']) =>
  `<w:r>${f ? `<w:rPr>${f.includes('b') ? '<w:b/>' : ''}${f.includes('i') ? '<w:i/>' : ''}</w:rPr>` : ''}${t === '\n' ? '<w:br/>' : `<w:t xml:space="preserve">${t}</w:t>`}</w:r>`).join('')}</w:p>`;
const TBL = rows => `<w:tbl>${rows.map(r => `<w:tr>${r.map(c => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
const DOC = parts => `<w:document><w:body>${parts.join('')}</w:body></w:document>`;

describe('a Word stat block (Arcane Ascension style)', () => {
  const xml = DOC([
    P([['⚔️Empire Guard (Sword &amp; Shield) Automaton (CR 3)']], 'Heading2'),
    P([['Medium construct, lawful neutral', 'i']]),
    P([['Armor Class:', 'b'], [' 17 (natural armor, shield)'], ['\n'], ['Hit Points:', 'b'], [' 52 (7d8 + 21)'], ['\n'], ['Speed:', 'b'], [' 30 ft.']]),
    TBL([['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'], ['16 (+3)', '12 (+1)', '16 (+3)', '5 (-3)', '10 (+0)', '7 (-2)']]),
    P([['Senses:', 'b'], [' passive Perception 10'], ['\n'], ['Languages:', 'b'], [' understands Common'], ['\n'], ['Challenge:', 'b'], [' 3 (700 XP)']]),
    P([['Actions', 'b']]),
    P([['Multiattack', 'b'], ['.', 'b'], [' The automaton makes two attacks.']]),
    P([['Shortsword', 'b'], ['.', 'b'], [' '], ['Melee Weapon Attack:', 'i'], [' +5 to hit, reach 5 ft., one target. '], ['Hit:', 'i'], [' 8 (1d8 + 3) piercing damage.']]),
  ]);
  const { lines } = docxLines(xml);
  it('a heading is the name, without its emoji or its "(CR 3)"', () => {
    expect(lines[0]).toMatchObject({ text: 'Empire Guard (Sword & Shield) Automaton', size: 14, cr: '3' });
  });
  it('labels lose their colon; line breaks split lines; a table row is one line', () => {
    expect(lines.map(l => l.text)).toContain('Armor Class 17 (natural armor, shield)');
    expect(lines.map(l => l.text)).toContain('STR DEX CON INT WIS CHA');
    expect(lines.map(l => l.text)).toContain('16 (+3) 12 (+1) 16 (+3) 5 (-3) 10 (+0) 7 (-2)');
  });
  it('the 5e reader finds the whole creature', () => {
    const [m] = findMonsters(lines);
    expect(m).toMatchObject({ name: 'Empire Guard (Sword & Shield) Automaton', size: 'Medium', ac: 17, hp: 52, cr: 3, str: 16, cha: 7, confidence: 'sure' });
    expect(m.actions.map(a => a.name)).toEqual(['Multiattack', 'Shortsword']);
  });
  it('an attack\'s "Hit: …" after a line break stays part of it, not a new action', () => {
    const x = DOC([P([['Wolf']], 'Heading2'), P([['Medium beast, unaligned', 'i']]), P([['Armor Class 13']]), P([['Hit Points 11 (2d8 + 2)']]),
      P([['Speed 40 ft.']]), TBL([['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'], ['12 (+1)', '15 (+2)', '12 (+1)', '3 (-4)', '12 (+1)', '6 (-2)']]),
      P([['Challenge 1/4 (50 XP)']]), P([['Actions', 'b']]),
      P([['Bite', 'b'], ['.', 'b'], [' Melee Weapon Attack: +4 to hit, reach 5 ft., one target.'], ['\n'], ['Hit:', 'i'], [' 7 (2d4 + 2) piercing damage.']]),
      P([['Howl', 'b'], ['.', 'b'], [' The wolf howls.']])]);
    const [w] = findMonsters(docxLines(x).lines);
    expect(w.actions.map(a => a.name)).toEqual(['Bite', 'Howl']);
  });
});

describe('a Word stat block in the other style (one score a line, a name alone above its text)', () => {
  const xml = DOC([
    P([['Jaguar']], 'Heading2'),
    P([['Medium Beast, Unaligned', 'i']]),
    P([['Armor Class 14 (natural agility)', 'b']]), P([['Hit Points 45 (6d8 + 18)', 'b']]), P([['Speed 50 ft., climb 30 ft.', 'b']]),
    ...['STR 16 (+3)', 'DEX 18 (+4)', 'CON 16 (+3)', 'INT 2 (-4)', 'WIS 14 (+2)', 'CHA 7 (-2)'].map(t => P([[t, 'b']])),
    P([['Challenge: 2 (450 XP)', 'b']]),
    P([['Actions', 'b']]),
    P([['Bite.', 'b']]), P([['Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) piercing damage.', 'b']]),
    P([['Pounce.', 'b']]), P([['If the jaguar moves at least 20 feet straight toward a creature, it can bite.', 'b']]),
  ]);
  const { lines } = docxLines(xml);
  it('six score lines become the header and the row', () => {
    expect(lines.map(l => l.text)).toContain('STR DEX CON INT WIS CHA');
    expect(lines.map(l => l.text)).toContain('16 (+3) 18 (+4) 16 (+3) 2 (-4) 14 (+2) 7 (-2)');
  });
  it('a name alone joins the text under it', () => {
    expect(lines.find(l => l.text.startsWith('Bite.'))?.runs[0]).toEqual({ text: 'Bite.', font: 'bi' });
  });
  it('the reader finds it, actions and all', () => {
    const [m] = findMonsters(lines);
    expect(m).toMatchObject({ name: 'Jaguar', ac: 14, hp: 45, cr: 2, str: 16, dex: 18, cha: 7, confidence: 'sure' });
    expect(m.actions.map(a => a.name)).toEqual(['Bite', 'Pounce']);
  });
});

describe('Word pictures and text', () => {
  it('each drawing is named after the heading above it, and its file is found', () => {
    const xml = DOC([P([['Jaguar']], 'Heading2'), '<w:p><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>']);
    expect(docxLines(xml).pictures).toEqual([{ rid: 'rId9', name: 'Jaguar' }]);
    expect(docxRels('<Relationships><Relationship Id="rId9" Target="media/image3.png"/><Relationship Id="rId2" Target="https://x" TargetMode="External"/></Relationships>'))
      .toEqual({ rId9: 'word/media/image3.png' });
  });
  it('entities and names', () => {
    expect(xmlText('Sword &amp; Shield &#8212; &#x2019;')).toBe('Sword & Shield — ’');
    expect(headingName('🐆 Jaguar')).toEqual({ name: 'Jaguar', cr: null });
  });
});

describe('a name and its text in one bold run', () => {
  it('"Bite. Melee Weapon Attack…" splits at the name; prose does not', () => {
    const x = DOC([P([['Bite. Melee Weapon Attack: +7 to hit.', 'b']]), P([['The kuo-toa makes two attacks. It hisses.', 'b']]),
      P([['Hellrend (Greatsword). Melee Weapon Attack: +9 to hit.', 'b']])]);
    const { lines } = docxLines(x);
    expect(lines[0].runs).toEqual([{ text: 'Bite.', font: 'bi' }, { text: 'Melee Weapon Attack: +7 to hit.', font: 'body' }]);
    expect(lines[1].runs.length).toBe(1);
    const plain = docxLines(DOC([P([['Actions (2 attacks)']]), P([['Bite. Melee Weapon Attack: +7 to hit.']])])).lines;
    expect(plain[0].text).toBe('Actions');
    expect(plain[1].runs[0]).toEqual({ text: 'Bite.', font: 'bi' });
    expect(lines[2].runs[0]).toEqual({ text: 'Hellrend (Greatsword).', font: 'bi' });
  });
});

