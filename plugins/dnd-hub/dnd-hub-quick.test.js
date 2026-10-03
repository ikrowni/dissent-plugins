import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickBuild, previewStats, READY_HEROES, STARTING_KITS, RECOMMENDED_SPELLS } from './dnd-hub-quick.js';
import { validateDraft, classSkillChoice } from './dnd-hub-draft-rules.js';
import { armorClass, isCaster } from './lk-rules5e.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(readFileSync(join(here, 'dnd-srd', f), 'utf8'));
const SRD = { races: load('races.json'), classes: load('classes.json'), backgrounds: load('backgrounds.json'),
  spells: load('spells.json'), equipment: load('equipment.json') };
const fixedRng = () => 0;

describe('quickBuild: every race with every class', () => {
  for (const r of SRD.races) for (const c of SRD.classes) {
    it(`${r.id} ${c.id} is a valid hero`, () => {
      const d = quickBuild(SRD, r.id, c.id, fixedRng);
      expect(validateDraft(d, SRD)).toEqual([]);
      const { choose } = classSkillChoice(SRD.classes, c.id);
      expect(d.proficiencyChoices).toHaveLength(choose);
      expect(d.proficiencyChoices).not.toContain('Insight');   // never wastes a pick on the background's skills
      expect(d.proficiencyChoices).not.toContain('Religion');
      expect(d.equipment.length).toBeGreaterThan(0);
      if (!isCaster(c.id)) expect(d.spells.length + d.cantrips.length).toBe(0);
    });
  }
});

describe('data', () => {
  const equip = new Set(SRD.equipment.map(e => e.id));
  it('every kit item exists in the SRD', () => {
    for (const [cls, kit] of Object.entries(STARTING_KITS)) for (const id of kit) expect(equip.has(id), `${cls}: ${id}`).toBe(true);
  });
  it('every recommended spell exists and belongs to its class', () => {
    for (const [cls, { cantrips, spells }] of Object.entries(RECOMMENDED_SPELLS)) {
      const name = SRD.classes.find(c => c.id === cls).name;
      for (const id of [...cantrips, ...spells]) {
        const sp = SRD.spells.find(s => s.id === id);
        expect(sp && sp.classes.includes(name), `${cls}: ${id}`).toBe(true);
      }
    }
  });
  it('six ready-made heroes, each valid, each named', () => {
    expect(READY_HEROES).toHaveLength(6);
    for (const h of READY_HEROES) {
      const d = quickBuild(SRD, h.race, h.class, fixedRng, h.name);
      expect(validateDraft(d, SRD)).toEqual([]);
      expect(d.name).toBe(h.name);
    }
  });
});

describe('previewStats', () => {
  it('a dwarf fighter wears chain mail and a shield', () => {
    const d = quickBuild(SRD, 'dwarf', 'fighter', fixedRng);
    const p = previewStats(SRD, d);
    // Fighter priority: STR 15, CON 14, DEX 13 … Dwarf +2 CON → 16 (+3); Hill Dwarf +1 WIS.
    expect(p.ac).toBe(armorClass({ class: 'fighter', dex: 13 }, ['chain-mail', 'shield']));
    expect(p.ac).toBe(18);                 // heavy armour ignores DEX: 16 + shield 2
    expect(p.hp).toBe(10 + 3 + 1);         // d10 + CON +3 + Dwarven Toughness
    expect(p.attack).toMatchObject({ name: 'Longsword', toHit: 4 }); // STR +2, proficiency +2
  });
  it('a monk uses Unarmored Defense', () => {
    const p = previewStats(SRD, quickBuild(SRD, 'human', 'monk', fixedRng));
    expect(p.ac).toBe(10 + 3 + 2); // DEX 15+1 → +3, WIS 14+1 → +2
  });
});
