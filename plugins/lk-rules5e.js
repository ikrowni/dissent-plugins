// lk-rules5e.js — LanternKeep's fifth-edition (SRD 5.1) rules in one place.
//
// ⚠️ SOURCE. dnd-hub, dnd-master and dnd-player each import a generated copy (scripts/vendor-shared.mjs),
// so the creator, the sheet, level-up, the DM's tools and the Hub compute the same numbers. Before this the
// rules lived in five files and disagreed (audit 2026-10-02: three spell-slot shapes, crits on the total, …).
// Pure functions only: no DOM, no storage. Every function returns a NEW object; inputs are never mutated.

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const abilityMod = score => Math.floor(((score ?? 10) - 10) / 2);
export const profBonus = level => Math.ceil(1 + Math.max(1, level || 1) / 4);

const HIT_DIE = { barbarian: 12, fighter: 10, paladin: 10, ranger: 10, bard: 8, cleric: 8, druid: 8, monk: 8,
  rogue: 8, warlock: 8, sorcerer: 6, wizard: 6 };
export const hitDieFor = cls => HIT_DIE[String(cls || '').toLowerCase()] || 8;

const ASI = { fighter: [4, 6, 8, 12, 14, 16, 19], rogue: [4, 8, 10, 12, 16, 19] };
export const isAsiLevel = (cls, level) => (ASI[String(cls || '').toLowerCase()] || [4, 8, 12, 16, 19]).includes(level);

// ── Spell slots ───────────────────────────────────────────────────────────────
// Canonical shape: an array of 10 [current, max] pairs, index = slot level, index 0 unused.

const FULL = [null,
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1]];
const FULL_CASTERS = ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'];
const HALF_CASTERS = ['paladin', 'ranger'];
// Pact Magic: [slot count, slot level] by warlock level.
const PACT = [null, [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
  [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]];

export const isCaster = cls => {
  const c = String(cls || '').toLowerCase();
  return FULL_CASTERS.includes(c) || HALF_CASTERS.includes(c) || c === 'warlock';
};

/** Max slots per slot level (array of 10, index = slot level). */
export function maxSlotsFor(cls, level) {
  const c = String(cls || '').toLowerCase();
  const lv = Math.min(20, Math.max(1, level || 1));
  const out = new Array(10).fill(0);
  let row = null;
  if (FULL_CASTERS.includes(c)) row = FULL[lv];
  else if (HALF_CASTERS.includes(c) && lv >= 2) row = FULL[Math.ceil(lv / 2)];
  else if (c === 'warlock') { const [n, at] = PACT[lv]; out[at] = n; return out; }
  (row || []).forEach((n, i) => { out[i + 1] = n; });
  return out;
}

const pair = v => (Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0] : [0, 0]);

/**
 * Any slot data ever saved, in the canonical shape. Three shapes exist in old saves:
 * creator (9 entries, index = level, index 0 = [0,0]); old level-up (9 entries, index 0 = 1st level);
 * the DM editor ({level: used} plus a separate {level: max}).
 */
export function normalizeSlots(slots, maxes) {
  const out = Array.from({ length: 10 }, () => [0, 0]);
  if (!slots) return out;
  if (!Array.isArray(slots)) {
    for (let l = 1; l <= 9; l++) {
      const max = Number(maxes?.[l]) || 0;
      const used = Number(slots[l]) || 0;
      if (max) out[l] = [Math.max(0, max - used), max];
    }
    return out;
  }
  const pairs = slots.map(pair);
  const zeroIndexed = pairs.length <= 9 && pairs[0][1] > 0;
  pairs.forEach((p, i) => {
    const l = zeroIndexed ? i + 1 : i;
    if (l >= 1 && l <= 9) out[l] = [Math.min(p[0], p[1]), p[1]];
  });
  return out;
}

/** Slots for a new class level: spent stay spent, every slot gained is ready to use. */
export function withSlotsForLevel(slots, cls, level) {
  const cur = normalizeSlots(slots);
  const max = maxSlotsFor(cls, level);
  return max.map((m, l) => {
    if (l === 0) return [0, 0];
    const [c, oldMax] = cur[l];
    return [Math.max(0, Math.min(m, c + Math.max(0, m - oldMax))), m];
  });
}

const refill = slots => normalizeSlots(slots).map(([, m]) => [m, m]);

// ── Hit points, 0 HP, death ───────────────────────────────────────────────────

const without = (list, name) => (list || []).filter(c => c !== name);
const withCond = (list, name) => [...without(list, name), name];
const freshSaves = () => ({ successes: 0, failures: 0 });

function settleDeath(s) {
  const ds = s.deathSaves;
  if (ds.failures >= 3) return { ...s, dead: true, stable: false };
  if (ds.successes >= 3) return { ...s, stable: true, deathSaves: freshSaves() };
  return s;
}

/** Damage after temporary HP, with 0 HP, damage at 0 and massive damage. */
export function applyDamage(state, amount, { crit = false } = {}) {
  const s = { ...state, conditions: [...(state.conditions || [])], deathSaves: { ...(state.deathSaves || freshSaves()) } };
  let dmg = Math.max(0, Math.floor(amount || 0));
  if (s.dead || !dmg) return s;
  const soaked = Math.min(s.hpTemp || 0, dmg);
  s.hpTemp = (s.hpTemp || 0) - soaked;
  dmg -= soaked;
  if (!dmg) return s;
  if ((s.hp || 0) <= 0) {
    if (dmg >= (s.hpMax || 0)) return { ...s, dead: true, stable: false };
    s.stable = false;
    s.deathSaves.failures += crit ? 2 : 1;
    return settleDeath(s);
  }
  const left = dmg - s.hp;
  if (left < 0) return { ...s, hp: s.hp - dmg };
  if (left >= (s.hpMax || 0)) return { ...s, hp: 0, dead: true, stable: false };
  return { ...s, hp: 0, stable: false, deathSaves: freshSaves(), conditions: withCond(s.conditions, 'Unconscious') };
}

export function applyHealing(state, amount) {
  if (state.dead) return { ...state };
  const heal = Math.max(0, Math.floor(amount || 0));
  const wasDown = (state.hp || 0) <= 0;
  const hp = Math.min(state.hpMax || 0, (state.hp || 0) + heal);
  if (!wasDown || hp <= 0) return { ...state, hp };
  return { ...state, hp, stable: false, deathSaves: freshSaves(), conditions: without(state.conditions, 'Unconscious') };
}

/**
 * The DM sets a hero's HP to a number (the tracker's HP box, the map's Edit HP). The number is the DM's word, so
 * temporary HP are not spent; what crossing 0 means still applies: down to 0 is unconscious with fresh death saves,
 * back above 0 wakes them (SRD "Dropping to 0 Hit Points"). It used to set the number alone: a hero at 0 stayed awake.
 */
export function setHp(state, hp) {
  if (state.dead) return { ...state };
  const next = Math.max(0, Math.min(state.hpMax || 0, Math.floor(Number(hp) || 0)));
  const was = state.hp || 0;
  if (next <= 0 && was > 0) {
    return { ...state, hp: 0, stable: false, deathSaves: freshSaves(), conditions: withCond(state.conditions, 'Unconscious') };
  }
  if (next > 0 && was <= 0) {
    return { ...state, hp: next, stable: false, deathSaves: freshSaves(), conditions: without(state.conditions, 'Unconscious') };
  }
  return { ...state, hp: next };
}

/** "-7" → { damage: 7 }, "+5" → { heal: 5 }, "12" → { hp: 12 }, "12/20" → { hp: 12, hpMax: 20 }; null if unreadable. */
export function parseHpEntry(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  let m = t.match(/^-(\d+)$/); if (m) return { damage: Number(m[1]) };
  m = t.match(/^\+(\d+)$/); if (m) return { heal: Number(m[1]) };
  m = t.match(/^(\d+)(?:\/(\d+))?$/); if (m) return { hp: Number(m[1]), ...(m[2] ? { hpMax: Number(m[2]) } : {}) };
  return null;
}

/** A rolled death save (d20 = the die). */
export function rollDeathSave(state, d20) {
  if (state.dead || state.stable || (state.hp || 0) > 0) return { ...state };
  if (d20 === 20) return applyHealing(state, 1);
  const ds = { ...(state.deathSaves || freshSaves()) };
  if (d20 === 1) ds.failures += 2;
  else if (d20 >= 10) ds.successes += 1;
  else ds.failures += 1;
  return settleDeath({ ...state, deathSaves: ds });
}

/** A death-save pip clicked by hand: set the count, then apply the same outcome rules. */
export function markDeathSave(state, kind, count) {
  const ds = { ...(state.deathSaves || freshSaves()) };
  ds[kind === 'success' ? 'successes' : 'failures'] = Math.max(0, Math.min(3, count));
  return settleDeath({ ...state, deathSaves: ds });
}

// ── Attacks ───────────────────────────────────────────────────────────────────

export function attackOutcome(d20, total, ac) {
  if (d20 === 20) return { hit: true, crit: true };
  if (d20 === 1) return { hit: false, crit: false };
  return { hit: total >= (ac ?? 10), crit: false };
}

/** A saving throw for half damage: `total` against `dc`; a success halves it, rounding down (SRD "Saving Throws"). */
export function saveForHalf(damage, total, dc) {
  const saved = total >= dc;
  return { saved, damage: saved ? Math.floor(damage / 2) : damage };
}

/** "1d6+2" → "2d6+2": a critical hit doubles the dice, never the modifier. */
export function critDamageExpr(expr) {
  const m = String(expr || '').replace(/\s+/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return String(expr || '');
  return `${(Number(m[1]) || 1) * 2}d${m[2]}${m[3] || ''}`;
}

/** Grid distance as the 5e default counts it: every square, diagonal included, is 5 ft. */
export const gridFeet = (dx, dy, gs) => Math.max(Math.round(Math.abs(dx) / gs), Math.round(Math.abs(dy) / gs)) * 5;

// ── Encounters ────────────────────────────────────────────────────────────────

const MULT = [1, 1.5, 2, 2.5, 3, 4];
export function encounterMultiplier(monsters, partySize) {
  const n = Math.max(1, monsters || 1);
  let i = n === 1 ? 0 : n === 2 ? 1 : n <= 6 ? 2 : n <= 10 ? 3 : n <= 14 ? 4 : 5;
  if (partySize < 3) i = Math.min(5, i + 1);
  else if (partySize >= 6) i = Math.max(0, i - 1);
  if (partySize >= 6 && n === 1) return 0.5;
  return MULT[i];
}
export function adjustedEncounterXp(groups, partySize) {
  const count = groups.reduce((s, g) => s + (g.count || 1), 0);
  const xp = groups.reduce((s, g) => s + (g.xp || 0) * (g.count || 1), 0);
  return Math.round(xp * encounterMultiplier(count, partySize));
}

// ── Rests ─────────────────────────────────────────────────────────────────────

const hitDiceLeft = c => (c.hitDiceRemaining ?? c.level ?? 1);

/** Short rest: spend `dice` Hit Dice (roll(d) returns one die). Warlock pact slots come back. */
export function shortRestSpend(c, dice, roll) {
  const spend = Math.max(0, Math.min(dice || 0, hitDiceLeft(c)));
  const d = hitDieFor(c.class), con = abilityMod(c.con);
  let hp = c.hp || 0;
  for (let i = 0; i < spend; i++) hp += Math.max(0, roll(d) + con);
  const out = { ...c, hp: Math.min(c.hpMax || 0, hp), hitDiceRemaining: hitDiceLeft(c) - spend };
  if (String(c.class || '').toLowerCase() === 'warlock' && c.spellSlots) out.spellSlots = refill(c.spellSlots);
  return out;
}

export function longRest(c) {
  const level = c.level || 1;
  return {
    ...c,
    hp: c.dead ? c.hp : c.hpMax, hpTemp: 0, stable: false,
    hitDiceRemaining: Math.min(level, hitDiceLeft(c) + Math.max(1, Math.floor(level / 2))),
    exhaustion: Math.max(0, (c.exhaustion || 0) - 1),
    spellSlots: c.spellSlots ? refill(c.spellSlots) : c.spellSlots,
    deathSaves: freshSaves(),
    concentration: null,
    conditions: c.dead ? c.conditions : without(c.conditions, 'Unconscious'),
  };
}

// ── Derived numbers ───────────────────────────────────────────────────────────

const castingAbility = c => (c.spellcastingAbility
  || ({ wizard: 'int', cleric: 'wis', druid: 'wis', ranger: 'wis', bard: 'cha', paladin: 'cha', sorcerer: 'cha', warlock: 'cha' })[String(c.class || '').toLowerCase()]
  || null);
export const spellAttackBonus = c => (castingAbility(c) ? profBonus(c.level) + abilityMod(c[castingAbility(c)]) : null);
export const spellSaveDC = c => (castingAbility(c) ? 8 + spellAttackBonus(c) : null);

/** Extra max HP when CON goes from `from` to `to` at character level `level` (retroactive). */
export const conHpBonusOnIncrease = (from, to, level) => (abilityMod(to) - abilityMod(from)) * (level || 1);

/** HP max for a new character of `level`: max die at 1, then the fixed average per level. */
export function hpMaxAt(cls, level, con) {
  const d = hitDieFor(cls), m = abilityMod(con);
  return Math.max(1, d + m) + Math.max(0, (level || 1) - 1) * Math.max(1, Math.ceil(d / 2) + 1 + m);
}

/** What the campaign keeps about a hero for the DM tools and the party view. `eff` = effective stats. */
export function characterSummary(c, eff = {}) {
  const prof = profBonus(c.level);
  const perc = (c.skills || {}).Perception;
  const pp = 10 + abilityMod(eff.wis ?? c.wis) + (perc === 'expertise' ? prof * 2 : perc === 'proficient' ? prof : 0);
  return {
    name: c.name || 'Unknown', race: c.race || '', class: c.class || '', level: c.level || 1,
    hp: c.hp ?? 0, hpMax: eff.hpMax ?? c.hpMax ?? 0, hpTemp: c.hpTemp || 0,
    ac: eff.ac ?? c.ac ?? 10, dex: eff.dex ?? c.dex ?? 10, passivePerception: pp, speed: c.speed || 30,
    conditions: [...(c.conditions || [])], dead: !!c.dead, stable: !!c.stable,
    portraitUrl: c.portraitUrl || '', portraitFileId: c.portraitFileId || '',
    concentration: c.concentration?.spellName || null,
    deathSaves: { successes: c.deathSaves?.successes || 0, failures: c.deathSaves?.failures || 0 },
  };
}

// ── Equipment (SRD 5.1 tables; the bundled equipment.json lacks armour type and weapon category) ──────

const ARMOR = {
  'padded-armor': [11, 'light'], 'leather-armor': [11, 'light'], 'studded-leather-armor': [12, 'light'],
  'hide-armor': [12, 'medium'], 'chain-shirt': [13, 'medium'], 'scale-mail': [14, 'medium'], breastplate: [14, 'medium'],
  'half-plate-armor': [15, 'medium'], 'ring-mail': [14, 'heavy'], 'chain-mail': [16, 'heavy'], 'splint-armor': [17, 'heavy'],
  'plate-armor': [18, 'heavy'],
};

/** AC from equipped item ids (or items with `id`), with Unarmored Defense for barbarian and monk. */
export function armorClass(c, equipped) {
  const ids = (equipped || []).map(x => (typeof x === 'string' ? x : x?.id));
  const dex = abilityMod(c.dex);
  const armor = ids.map(id => ARMOR[id]).find(Boolean);
  const shield = ids.includes('shield') ? 2 : 0;
  const cls = String(c.class || '').toLowerCase();
  if (armor) {
    const [base, type] = armor;
    return base + (type === 'light' ? dex : type === 'medium' ? Math.min(2, dex) : 0) + shield;
  }
  if (cls === 'barbarian') return 10 + dex + abilityMod(c.con) + shield;
  if (cls === 'monk' && !shield) return 10 + dex + abilityMod(c.wis);
  return 10 + dex + shield;
}

// id: [dice, damage type, 'simple'|'martial', properties, normal range in ft (ranged weapons only)]
const W = (dice, type, cat, props = '', range = 0) => ({ dice, type, cat, props: props.split(' ').filter(Boolean), range });
const WEAPONS = {
  club: W('1d4', 'bludgeoning', 'simple', 'light monk'), dagger: W('1d4', 'piercing', 'simple', 'finesse light thrown monk'),
  greatclub: W('1d8', 'bludgeoning', 'simple'), handaxe: W('1d6', 'slashing', 'simple', 'light thrown monk'),
  javelin: W('1d6', 'piercing', 'simple', 'thrown monk'), 'light-hammer': W('1d4', 'bludgeoning', 'simple', 'light thrown monk'),
  mace: W('1d6', 'bludgeoning', 'simple', 'monk'), quarterstaff: W('1d6', 'bludgeoning', 'simple', 'monk'),
  sickle: W('1d4', 'slashing', 'simple', 'light monk'), spear: W('1d6', 'piercing', 'simple', 'thrown monk'),
  'crossbow-light': W('1d8', 'piercing', 'simple', 'ranged', 80), dart: W('1d4', 'piercing', 'simple', 'finesse thrown', 0),
  shortbow: W('1d6', 'piercing', 'simple', 'ranged', 80), sling: W('1d4', 'bludgeoning', 'simple', 'ranged', 30),
  battleaxe: W('1d8', 'slashing', 'martial'), flail: W('1d8', 'bludgeoning', 'martial'), glaive: W('1d10', 'slashing', 'martial', 'reach'),
  greataxe: W('1d12', 'slashing', 'martial'), greatsword: W('2d6', 'slashing', 'martial'), halberd: W('1d10', 'slashing', 'martial', 'reach'),
  lance: W('1d12', 'piercing', 'martial', 'reach'), longsword: W('1d8', 'slashing', 'martial'), maul: W('2d6', 'bludgeoning', 'martial'),
  morningstar: W('1d8', 'piercing', 'martial'), pike: W('1d10', 'piercing', 'martial', 'reach'), rapier: W('1d8', 'piercing', 'martial', 'finesse'),
  scimitar: W('1d6', 'slashing', 'martial', 'finesse light'), shortsword: W('1d6', 'piercing', 'martial', 'finesse light monk'),
  trident: W('1d6', 'piercing', 'martial', 'thrown'), 'war-pick': W('1d8', 'piercing', 'martial'), warhammer: W('1d8', 'bludgeoning', 'martial'),
  whip: W('1d4', 'slashing', 'martial', 'finesse reach'), blowgun: W('1d1', 'piercing', 'martial', 'ranged', 25),
  'crossbow-hand': W('1d6', 'piercing', 'martial', 'ranged light', 30), 'crossbow-heavy': W('1d10', 'piercing', 'martial', 'ranged', 100),
  longbow: W('1d8', 'piercing', 'martial', 'ranged', 150),
};
export const isWeaponId = id => !!WEAPONS[id];

// Thrown weapons' ranges, normal/long in ft; a ranged weapon's long range is four times its normal (SRD 5.1).
const THROWN = { dagger: [20, 60], handaxe: [20, 60], javelin: [30, 120], 'light-hammer': [20, 60], spear: [20, 60],
  dart: [20, 60], trident: [20, 60] };

/**
 * How far a weapon reaches: `melee` (5 ft, 10 with reach; null for a bow) and, for ranged or thrown weapons, `normal`
 * and `long` range (beyond normal: disadvantage; beyond long: no attack). Null for something that is not a weapon.
 */
export function weaponReach(item) {
  const forged = (item?.effects || []).find(e => e.type === 'weapon');
  if (forged) {
    const r = Number(forged.rangeFt) || 5;
    return r > 10 ? { melee: null, normal: r, long: r * 4 } : { melee: r, normal: null, long: null };
  }
  const w = WEAPONS[item?.id];
  if (!w) return null;
  if (w.props.includes('ranged')) return { melee: null, normal: w.range, long: w.range * 4 };
  const t = THROWN[item.id];
  return { melee: w.props.includes('reach') ? 10 : 5, normal: t?.[0] ?? null, long: t?.[1] ?? null };
}

/** Attacks per Attack action: Extra Attack gives 2, "Extra Attack (2)" 3, "(3)" 4 (fighters at 11 and 20). */
export function attacksPerAction(features = []) {
  let n = 1;
  for (const f of features) {
    const m = String(typeof f === 'string' ? f : f?.name || '').match(/^Extra Attack(?:\s*\((\d)\))?$/i);
    if (m) n = Math.max(n, m[1] ? Number(m[1]) + 1 : 2);
  }
  return n;
}

/**
 * How the rules sort a weapon: `{ cat: 'simple'|'martial', ranged }`, or null for no weapon. Darts and nets are ranged
 * weapons (the class equipment lists say "any simple melee weapon"); a net has no attack roll entry here.
 */
export function weaponKind(id) {
  if (id === 'net') return { cat: 'martial', ranged: true };
  const w = WEAPONS[id];
  return w ? { cat: w.cat, ranged: w.props.includes('ranged') || id === 'dart' } : null;
}

const MARTIAL_CLASSES = ['barbarian', 'fighter', 'paladin', 'ranger'];
const EXTRA_WEAPONS = {
  bard: ['crossbow-hand', 'longsword', 'rapier', 'shortsword'], rogue: ['crossbow-hand', 'longsword', 'rapier', 'shortsword'],
  monk: ['shortsword'], druid: ['scimitar'],
};
const LIMITED = {
  wizard: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light'],
  sorcerer: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light'],
  druid: ['club', 'dagger', 'dart', 'javelin', 'mace', 'quarterstaff', 'scimitar', 'sickle', 'sling', 'spear'],
};
function proficientWith(cls, id) {
  const c = String(cls || '').toLowerCase(), w = WEAPONS[id];
  if (!w) return false;
  if (LIMITED[c]) return LIMITED[c].includes(id);
  if (MARTIAL_CLASSES.includes(c)) return true;
  return w.cat === 'simple' || (EXTRA_WEAPONS[c] || []).includes(id);
}

/**
 * To-hit and damage for a weapon in a character's hands. A DM-forged `weapon` effect wins (it is the
 * DM's statement of what the item does); otherwise the SRD weapon: STR melee, DEX ranged, the better
 * of the two for finesse (and for a monk's monk weapons), + proficiency when the class has it.
 */
export function weaponProfile(item, c) {
  const forged = (item?.effects || []).find(e => e.type === 'weapon');
  if (forged) {
    return { toHit: parseInt(forged.toHit, 10) || 0, damage: String(forged.damage || '1d4').replace(/\s+/g, ''),
      damageType: forged.damageType || '', rangeFt: Number(forged.rangeFt) || 5 };
  }
  const w = WEAPONS[item?.id];
  if (!w) return null;
  const str = abilityMod(c.str), dex = abilityMod(c.dex);
  const monk = String(c.class || '').toLowerCase() === 'monk' && w.props.includes('monk');
  const mod = w.props.includes('ranged') ? dex : (w.props.includes('finesse') || monk) ? Math.max(str, dex) : str;
  const prof = proficientWith(c.class, item.id) ? profBonus(c.level) : 0;
  return { toHit: mod + prof, damage: `${w.dice}${mod > 0 ? '+' + mod : mod < 0 ? mod : ''}`, damageType: w.type,
    rangeFt: w.range || (w.props.includes('reach') ? 10 : 5) };
}

// ── Skills ────────────────────────────────────────────────────────────────────

export const RACE_SKILLS = { elf: ['Perception'], 'half-orc': ['Intimidation'] };

/** Skill proficiencies from class picks, the background's skills and the race. */
export function skillProficiencies({ race, classSkills = [], extraSkills = [] }, background) {
  const bg = (background?.starting_proficiencies || []).filter(p => p.startsWith('Skill: ')).map(p => p.slice(7));
  const out = {};
  for (const n of [...classSkills, ...bg, ...(RACE_SKILLS[race] || []), ...extraSkills]) out[n] = 'proficient';
  return out;
}
