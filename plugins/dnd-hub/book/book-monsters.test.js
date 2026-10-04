// plugins/dnd-hub/book/book-monsters.test.js
import { describe, it, expect } from 'vitest';
import { findMonsters } from './book-monsters.js';
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
