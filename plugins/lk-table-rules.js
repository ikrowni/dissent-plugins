// lk-table-rules.js — the DM's Table rules: three presets and what each switch means.
//
// ⚠️ SOURCE; vendored into dnd-hub, dnd-master and dnd-player (scripts/vendor-shared.mjs).
// Spec: docs/superpowers/specs/2026-10-03-lanternkeep-flow-design.md §4 (projects repo).
//
// Turn lock is not a switch: during a fight a player's token moves only on its turn and only up to its speed,
// always (fog safety, owner 2026-10-03; dnd-hub-movement.js). Old settings may still hold `turnLock`; it is ignored.
//
// 🔴 Every automation asks rule(settings, key), never settings[key]: a campaign made before a switch existed has
// no value for it, and rule() gives it the Guided one.

export const PRESET_ORDER = ['guided', 'classic', 'raw'];

export const PRESETS = {
  guided:  { autoHit: true,  autoDamage: true,  playersRollInitiative: false, deathSaves: true,  concentrationAutoRoll: true,  trapSavesAuto: true,  hints: true  },
  classic: { autoHit: true,  autoDamage: false, playersRollInitiative: true,  deathSaves: true,  concentrationAutoRoll: false, trapSavesAuto: false, hints: false },
  raw:     { autoHit: false, autoDamage: false, playersRollInitiative: true,  deathSaves: false, concentrationAutoRoll: false, trapSavesAuto: false, hints: false },
};

export const RULE_KEYS = Object.keys(PRESETS.guided);

export const PRESET_INFO = {
  guided:  { label: 'Guided',  blurb: 'The table does the maths. Best for new players.' },
  classic: { label: 'Classic', blurb: 'Players roll their own saves and initiative. The DM applies damage.' },
  raw:     { label: 'Raw',     blurb: 'Dice only. The DM rules on everything.' },
};

export const RULE_INFO = {
  autoHit:               { group: 'Combat', label: 'Hit or miss',            desc: 'Compare attack rolls with the target\'s AC and say hit or miss' },
  autoDamage:            { group: 'Combat', label: 'Apply damage',           desc: 'After a hit, the damage roll comes off the target\'s HP' },
  playersRollInitiative: { group: 'Combat', label: 'Players roll initiative', desc: 'Each player rolls their own; the tracker waits for them' },
  deathSaves:            { group: 'Danger', label: 'Death save reminders',   desc: 'A hero at 0 HP is asked to roll a death save when their turn starts' },
  concentrationAutoRoll: { group: 'Danger', label: 'Roll concentration saves', desc: 'When a concentrating caster takes damage, roll the CON save for them' },
  trapSavesAuto:         { group: 'Danger', label: 'Roll trap saves',        desc: 'When a trap springs, roll the hero\'s saving throw for them' },
  hints:                 { group: 'Help',   label: 'Show DCs',               desc: 'Prompts name the save and its DC ("Roll a DEX save, DC 13")' },
};

/** The value of one switch; a missing or malformed one gets the Guided value. */
export function rule(settings, key) {
  const v = settings?.[key];
  return typeof v === 'boolean' ? v : PRESETS.guided[key];
}

/** 'guided' | 'classic' | 'raw' when every switch matches that preset, otherwise 'custom'. */
export function presetOf(settings) {
  return PRESET_ORDER.find(p => RULE_KEYS.every(k => rule(settings, k) === PRESETS[p][k])) || 'custom';
}

/** Settings with every switch set from `name`; other settings (hearing range) are kept. */
export function applyPreset(settings, name) {
  if (!PRESETS[name]) throw new Error(`unknown preset: ${name}`);
  return { ...(settings || {}), ...PRESETS[name] };
}

/** A new campaign's settings: Guided, 60 ft hearing range. */
export function defaultSettings() {
  return { ...PRESETS.guided, spatialRange: 60 };
}
