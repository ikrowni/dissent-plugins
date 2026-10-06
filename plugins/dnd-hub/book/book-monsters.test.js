// plugins/dnd-hub/book/book-monsters.test.js
import { describe, it, expect } from 'vitest';
import { findMonsters, withProblems, hpIsDiceAverage } from './book-monsters.js';
import { L, H, MUDLING } from './book-fixtures.js';

describe('findMonsters', () => {
  const [m] = findMonsters(MUDLING);
  it('reads the stat block into the SRD monster shape', () => {
    expect(m).toMatchObject({
      id: 'mudling', name: 'Mudling', size: 'Small', type: 'humanoid', subtype: 'mudfolk', alignment: 'chaotic neutral',
      ac: 12, ac_type: 'leather armor', hp: 9, hp_dice: '2d6+2', speed: { walk: '30 ft.', swim: '20 ft.' },
      str: 10, dex: 14, con: 12, int: 8, wis: 11, cha: 7,
      saving_throws: [{ ability: 'dex', bonus: 4 }], skills: [{ name: 'Stealth', bonus: 4 }, { name: 'Perception', bonus: 2 }],
      damage_resistances: ['poison'], condition_immunities: ['Charmed', 'Frightened'],
      senses: { darkvision: '60 ft.', passive_perception: 12 }, languages: 'Common, Mudling', cr: 0.5, xp: 100,
    });
  });
  it('reads traits, actions (with the attack bonus) and reactions, joining wrapped lines', () => {
    expect(m.special_abilities).toEqual([{ name: 'Amphibious', desc: 'The mudling can breathe air and water.' }]);
    expect(m.actions).toEqual([
      { name: 'Multiattack', desc: 'The mudling makes two attacks.', attack_bonus: null },
      { name: 'Claw', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.', attack_bonus: 4 },
    ]);
    expect(m.reactions).toEqual([{ name: 'Slip Away', desc: 'The mudling sinks into mud.' }]);
  });
  it('is sure of a complete block, and says which lines it used', () => {
    expect(m.confidence).toBe('sure');
    expect(m.lines).toEqual([0, MUDLING.length - 1]);
  });
  it('finds two blocks in a row, and stops at the next heading', () => {
    const two = [...MUDLING, ...MUDLING.map(l => l === MUDLING[0] ? H('Mudling Elder') : l), H('Chapter 3: Treasure', 18), L('Gold.')];
    const ms = findMonsters(two);
    expect(ms.map(x => x.name)).toEqual(['Mudling', 'Mudling Elder']);
    expect(ms[1].lines[1]).toBe(two.length - 3);
  });
  it('a block missing its hit points is kept but marked unsure', () => {
    const ms = findMonsters(MUDLING.filter(l => !l.text.startsWith('Hit Points')));
    expect(ms[0].confidence).toBe('unsure');
    expect(ms[0].problems).toContain('no hit points');
  });
  it('legendary actions keep their intro out of the list', () => {
    const lines = [...MUDLING, H('Legendary Actions', 10.8), L('The mudling can take 3 legendary actions. It regains'),
      L('spent legendary actions at the start of its turn.'), L('The mudling moves.', { name: 'Move.' }),
      L('The mudling bites.', { name: 'Bite (Costs 2 Actions).' })];
    expect(findMonsters(lines)[0].legendary_actions.map(a => a.name)).toEqual(['Move', 'Bite (Costs 2 Actions)']);
  });
  it('ignores text that only looks like a size line', () => {
    expect(findMonsters([H('Notes'), L('Large crowds, as a rule, are noisy')])).toEqual([]);
  });
});

describe('British spelling', () => {
  it('"Armour Class" starts a stat block too (Heliana\'s Guide: every monster was missed)', () => {
    const uk = MUDLING.map(l => l.runs[0]?.text === 'Armor Class'
      ? { ...l, text: l.text.replace('Armor Class', 'Armour Class'), runs: l.runs.map(r => r.text === 'Armor Class' ? { ...r, text: 'Armour Class' } : r) } : l);
    const [m] = findMonsters(uk);
    expect(m?.name).toBe('Mudling');
    expect(m.ac).toBe(12);
  });
});

// Heliana (owner report 2026-10-06): "Challenge 2o (25,000 XP)" (the book's typo), "Challenge 6 (2,300 xp) or 8 (3,900 XP)
// if paired …", and a warlock's summon with "Challenge —" were all left unticked as "no challenge rating".
describe('the challenge line', () => {
  const withChallenge = text => MUDLING.map(l => (l.runs[0]?.text === 'Challenge' ? L(text, { lab: 'Challenge' }) : l));
  it('lower-case xp, and a second rating for a variant: the first is the CR', () => {
    const [m] = findMonsters(withChallenge('6 (2,300 xp) or 8 (3,900 XP) if paired with a handler.'));
    expect(m).toMatchObject({ cr: 6, xp: 2300, confidence: 'sure' });
  });
  it('a CR the book misprinted is read from its XP', () => {
    const [m] = findMonsters(withChallenge('2o (25,000 XP) Proficiency Bonus +6'));
    expect(m).toMatchObject({ cr: 20, xp: 25000, confidence: 'sure' });
  });
  it('"—" is a creature with no challenge rating (a summon), not a problem', () => {
    const [m] = findMonsters(withChallenge('— Proficiency Bonus +2'));
    expect(m.cr).toBe(null);
    expect(m.problems).not.toContain('no challenge rating');
  });
  it('a missing challenge line is still a problem', () => {
    const [m] = findMonsters(MUDLING.filter(l => l.runs[0]?.text !== 'Challenge'));
    expect(m.problems).toContain('no challenge rating');
  });
});

// A scanned block is ticked when it checks itself (owner, 2026-10-06: Ravenloft came out 0/36 ticked).
describe('a scanned stat block that checks itself', () => {
  const base = { scan: true, size: 'Huge', ac: 16, hp: 92, hp_dice: '8d12+40', str: 18, dex: 8, con: 20, int: 14, wis: 14, cha: 18,
    cr: 7, actions: [{ name: 'Vine' }] };
  it('hit points are the average of the hit dice', () => {
    expect(hpIsDiceAverage(92, '8d12 + 40')).toBe(true);
    expect(hpIsDiceAverage(7, '2d8 - 2')).toBe(true);
    expect(hpIsDiceAverage(9, '2d8')).toBe(true);
    expect(hpIsDiceAverage(93, '8d12+40')).toBe(false);
    expect(hpIsDiceAverage(92, null)).toBe(false);
  });
  it('everything read and both checks pass: ticked, still noted as a scan', () => {
    const m = withProblems(base);
    expect(m.confidence).toBe('sure');
    expect(m.problems).toEqual(['read from a scan']);
  });
  it('a misread number (HP not the dice average, or CON not the dice bonus) stays unticked', () => {
    expect(withProblems({ ...base, hp: 82 }).confidence).toBe('unsure');
    expect(withProblems({ ...base, con: 12 }).confidence).toBe('unsure');
  });
  it('anything else missing stays unticked', () => {
    expect(withProblems({ ...base, size: null }).confidence).toBe('unsure');
    expect(withProblems({ ...base, actions: [] }).confidence).toBe('unsure');
  });
});

