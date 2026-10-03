// dnd-hub-forge-state.js — the Hero Forge's scenes as a pure reducer (spec 2026-10-03 hero forge §2).
// Scenes: 'race' → 'class' → ['picks'] → ['shape' × nShape] → 'reveal'. Indexes point into the SRD lists the screen
// holds; `shape` is the guided step on show (its list comes from dnd-hub-forge-shape.js shapeSteps).

// picks: the chosen class has level-1 choices (subclass, fighting style, expertise), asked in the 'picks' scene.
// nShape: how many guided steps follow (abilities, skills, gear, …); 0 for a ready-made hero.
export const initForge = (nRaces, nClasses) =>
  ({ scene: 'race', race: 0, cls: 0, nRaces, nClasses, quick: null, picks: false, shape: 0, nShape: 0 });

const wrap = (i, n) => ((i % n) + n) % n;
const toShapeOr = (s, other) => (s.nShape > 0 ? { ...s, scene: 'shape', shape: 0 } : { ...s, scene: other });
const lastBeforeReveal = s => (s.nShape > 0 ? { ...s, scene: 'shape', shape: s.nShape - 1 }
  : { ...s, scene: s.picks ? 'picks' : 'class' });

export function forgeStep(s, a) {
  const key = s.scene === 'class' ? 'cls' : 'race';
  const n = s.scene === 'class' ? s.nClasses : s.nRaces;
  const browsing = s.scene === 'race' || s.scene === 'class';
  switch (a.type) {
    case 'browse':
      if (!browsing) return s;
      return { ...s, [key]: wrap(s[key] + a.by, n) };
    case 'select':
      if (!browsing || a.index < 0 || a.index >= n) return s;
      return { ...s, [key]: a.index };
    case 'choose':
      if (s.scene === 'race') return { ...s, scene: 'class' };
      if (s.scene === 'class') return s.picks ? { ...s, scene: 'picks', quick: null } : toShapeOr({ ...s, quick: null }, 'reveal');
      if (s.scene === 'picks') return toShapeOr(s, 'reveal');
      if (s.scene === 'shape') return s.shape + 1 < s.nShape ? { ...s, shape: s.shape + 1 } : { ...s, scene: 'reveal' };
      return s;
    case 'finish': // "use the suggestions for the rest"
      return s.scene === 'shape' ? { ...s, scene: 'reveal' } : s;
    case 'back':
      if (s.scene === 'reveal') return s.quick ? { ...s, scene: 'race', quick: null } : lastBeforeReveal(s);
      if (s.scene === 'shape') return s.shape > 0 ? { ...s, shape: s.shape - 1 } : { ...s, scene: s.picks ? 'picks' : 'class' };
      if (s.scene === 'picks') return { ...s, scene: 'class' };
      return { ...s, scene: 'race' };
    case 'quickPick':
      return { ...s, scene: 'reveal', race: a.race, cls: a.cls, quick: a.id, picks: false, nShape: 0, shape: 0 };
    case 'change':
      // A ready-made hero: pick another class. A guided hero: back to its last step, choices kept.
      return s.quick || s.nShape === 0 ? { ...s, scene: 'class', quick: null } : lastBeforeReveal(s);
    default:
      return s;
  }
}
