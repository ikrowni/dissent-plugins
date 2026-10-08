// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-conditions.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-conditions.js' directly would make the plugin unmirrorable.

// lk-conditions.js — what each condition does, and Exhaustion, under the table's rules (Table rules → Rules: 2014 =
// SRD 5.1 appendix A, 2024 = SRD 5.2.1 rules glossary; both CC-BY-4.0). Short summaries for tooltips and the sheet,
// plus the two effects LanternKeep applies itself: the 2024 Exhaustion penalty on d20 rolls, and speed (map movement).
// Pure.

const BOTH = {
  Blinded: 'Can\'t see; fails any check that needs sight. Attacks against you have advantage; yours have disadvantage.',
  Charmed: 'Can\'t attack or target the charmer with harmful effects. The charmer has advantage on social checks with you.',
  Deafened: 'Can\'t hear; fails any check that needs hearing.',
  Frightened: 'Disadvantage on ability checks and attacks while the source of fear is in sight. Can\'t move closer to it.',
  Poisoned: 'Disadvantage on attack rolls and ability checks.',
  Prone: 'Can only crawl, or spend half your speed to stand. Disadvantage on your attacks. Attacks against you have advantage within 5 ft, disadvantage from farther away.',
  Restrained: 'Speed 0. Attacks against you have advantage; yours have disadvantage. Disadvantage on Dexterity saves.',
};

export const CONDITION_TEXT = {
  '2014': {
    ...BOTH,
    Grappled: 'Speed 0. Ends if the grappler is incapacitated or you are moved out of its reach.',
    Incapacitated: 'Can\'t take actions or reactions.',
    Invisible: 'Can\'t be seen without magic or a special sense. Attacks against you have disadvantage; yours have advantage.',
    Paralyzed: 'Incapacitated; can\'t move or speak. Fails Strength and Dexterity saves. Attacks against you have advantage, and a hit from within 5 ft is a critical hit.',
    Petrified: 'Turned to stone: incapacitated, can\'t move or speak, unaware. Fails Strength and Dexterity saves; attacks against you have advantage. Resistance to all damage; immune to poison and disease.',
    Stunned: 'Incapacitated; can\'t move; speaks only falteringly. Fails Strength and Dexterity saves. Attacks against you have advantage.',
    Unconscious: 'Incapacitated, can\'t move or speak, unaware; drops what it holds and falls prone. Fails Strength and Dexterity saves. Attacks against you have advantage, and a hit from within 5 ft is a critical hit.',
    Exhaustion: 'Six levels, each adding to the last: 1 disadvantage on ability checks · 2 speed halved · 3 disadvantage on attacks and saves · 4 hit point maximum halved · 5 speed 0 · 6 death. A long rest removes one level.',
  },
  '2024': {
    ...BOTH,
    Grappled: 'Speed 0. Disadvantage on attacks against anyone but the grappler, who can drag you along.',
    Incapacitated: 'No actions, bonus actions or reactions. Concentration breaks; can\'t speak. Disadvantage on initiative.',
    Invisible: 'Advantage on initiative. Effects that need to see you don\'t work. Attacks against you have disadvantage; yours have advantage.',
    Paralyzed: 'Incapacitated; speed 0. Fails Strength and Dexterity saves. Attacks against you have advantage, and a hit from within 5 ft is a critical hit.',
    Petrified: 'Turned to stone: incapacitated, speed 0. Fails Strength and Dexterity saves; attacks against you have advantage. Resistance to all damage; immune to Poisoned.',
    Stunned: 'Incapacitated. Fails Strength and Dexterity saves. Attacks against you have advantage.',
    Unconscious: 'Incapacitated and prone, drops what it holds, unaware; speed 0. Fails Strength and Dexterity saves. Attacks against you have advantage, and a hit from within 5 ft is a critical hit.',
    Exhaustion: 'Each level: −2 to every d20 roll (checks, attacks, saves) and −5 ft of speed. Level 6 is death. A long rest removes one level.',
  },
};

const ed = edition => (edition === '2024' ? '2024' : '2014');

/** What condition `id` does under `edition`'s rules ('' for one not listed). */
export const conditionText = (id, edition) => CONDITION_TEXT[ed(edition)][id] || '';

/** Conditions that hold a creature in place. 2024's Stunned is only Incapacitated, which no longer stops movement. */
const STOPPED = {
  '2014': ['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'],
  '2024': ['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Unconscious'],
};
export const holdsInPlace = (conditions, edition) => (conditions || []).some(c => STOPPED[ed(edition)].includes(c));

const lvl = n => Math.max(0, Math.min(6, Math.floor(Number(n) || 0)));

/** What an Exhaustion `level` does under `edition`, for the sheet: '' at 0. */
export function exhaustionNow(level, edition) {
  const n = lvl(level);
  if (!n) return '';
  if (n >= 6) return 'Dead (Exhaustion 6).';
  if (ed(edition) === '2024') return `−${2 * n} to d20 rolls · −${5 * n} ft speed`;
  return ['Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attacks and saves', 'Hit point maximum halved',
    'Speed 0'].slice(0, n).join(' · ');
}

/** The 2024 penalty on every d20 roll (checks, attacks, saves): −2 per level. 2014 has none (its levels give disadvantage). */
export const exhaustionD20 = (level, edition) => (ed(edition) === '2024' && lvl(level) ? -2 * lvl(level) : 0);

/** `feet` of speed after Exhaustion `level`. 2024: −5 ft a level. 2014: halved from level 2, 0 from level 5. */
export function exhaustedSpeed(feet, level, edition) {
  const n = lvl(level), f = Math.max(0, Number(feet) || 0);
  if (!n) return f;
  if (n >= 6) return 0;
  if (ed(edition) === '2024') return Math.max(0, f - 5 * n);
  return n >= 5 ? 0 : n >= 2 ? Math.floor(f / 2 / 5) * 5 : f;
}
