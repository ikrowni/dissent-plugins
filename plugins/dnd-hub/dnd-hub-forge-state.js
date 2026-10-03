// dnd-hub-forge-state.js — the Hero Forge's three scenes as a pure reducer (spec 2026-10-03 hero forge §2).
// Scenes: 'race' → 'class' → 'reveal'. Indexes point into the SRD lists the screen holds.

// picks: the chosen class has level-1 choices (subclass, fighting style, expertise), asked in the 'picks' scene.
export const initForge = (nRaces, nClasses) => ({ scene: 'race', race: 0, cls: 0, nRaces, nClasses, quick: null, picks: false });

const wrap = (i, n) => ((i % n) + n) % n;

export function forgeStep(s, a) {
  const key = s.scene === 'class' ? 'cls' : 'race';
  const n = s.scene === 'class' ? s.nClasses : s.nRaces;
  switch (a.type) {
    case 'browse':
      if (s.scene === 'reveal' || s.scene === 'picks') return s;
      return { ...s, [key]: wrap(s[key] + a.by, n) };
    case 'select':
      if (s.scene === 'reveal' || s.scene === 'picks' || a.index < 0 || a.index >= n) return s;
      return { ...s, [key]: a.index };
    case 'choose':
      if (s.scene === 'race') return { ...s, scene: 'class' };
      if (s.scene === 'class') return { ...s, scene: s.picks ? 'picks' : 'reveal', quick: null };
      if (s.scene === 'picks') return { ...s, scene: 'reveal' };
      return s;
    case 'back':
      if (s.scene === 'reveal') return s.quick ? { ...s, scene: 'race', quick: null } : { ...s, scene: s.picks ? 'picks' : 'class' };
      if (s.scene === 'picks') return { ...s, scene: 'class' };
      return { ...s, scene: 'race' };
    case 'quickPick':
      return { ...s, scene: 'reveal', race: a.race, cls: a.cls, quick: a.id, picks: false };
    case 'change':
      return { ...s, scene: 'class', quick: null };
    default:
      return s;
  }
}
