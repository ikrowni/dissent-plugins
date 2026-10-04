// dnd-hub-starting-gear.js — each class's starting equipment as the 5e SRD (5.1) lists it: "(a) a greataxe or (b) any
// martial melee weapon", the gear every member of the class gets, the packs' contents, and the background's gear.
// Pure: no DOM. Both creators use it (the Hero Forge's gear step and the full creator's Equipment step); the view
// is dnd-hub-gear-view.js. Owner request 2026-10-04: "more options for starter equipment, like D&D Beyond".
//
// A draft's choice lives in `draft.gear = { opts: [option index per choice], picks: { key: itemId } }`;
// `applyGear` turns it into `draft.equipment` (item ids, as before), `draft.equipmentQty` and `draft.gearNamed`.
import { weaponKind } from './lk-rules5e.js';

const it = (id, qty = 1) => ({ id, qty });
const any = (kind, count = 1) => ({ pick: kind, count });

/** What "any …" may be, as item ids from equipment.json. */
export const PICK_KINDS = {
  'simple':         { label: 'any simple weapon',        test: id => weaponKind(id)?.cat === 'simple' },
  'simple-melee':   { label: 'any simple melee weapon',  test: id => weaponKind(id)?.cat === 'simple' && !weaponKind(id).ranged },
  'martial':        { label: 'any martial weapon',       test: id => weaponKind(id)?.cat === 'martial' },
  'martial-melee':  { label: 'any martial melee weapon', test: id => weaponKind(id)?.cat === 'martial' && !weaponKind(id).ranged },
  'instrument':     { label: 'any musical instrument',   ids: ['bagpipes', 'drum', 'dulcimer', 'flute', 'lute', 'lyre', 'horn', 'pan-flute', 'shawm', 'viol'] },
  'holy-symbol':    { label: 'a holy symbol',            ids: ['amulet', 'emblem', 'reliquary'] },
  'arcane-focus':   { label: 'an arcane focus',          ids: ['crystal', 'orb', 'rod', 'staff', 'wand'] },
  'druidic-focus':  { label: 'a druidic focus',          ids: ['sprig-of-mistletoe', 'totem', 'wooden-staff', 'yew-wand'] },
};

/** The ids a pick of `kind` may take, from the SRD's equipment list (so a missing item is never offered). */
export function pickOptions(kind, equipment = []) {
  const k = PICK_KINDS[kind];
  if (!k) return [];
  const have = new Set(equipment.map(e => e.id));
  return k.ids ? k.ids.filter(id => have.has(id)) : equipment.map(e => e.id).filter(k.test);
}

// Each class: `choices` (each a list of options; an option is a list of items or picks) and `fixed`.
// "(if proficient)" options are offered anyway with that note: the creator does not know a cleric's domain yet.
export const CLASS_GEAR = {
  barbarian: {
    choices: [[[it('greataxe')], [any('martial-melee')]], [[it('handaxe', 2)], [any('simple')]]],
    fixed: [it('explorers-pack'), it('javelin', 4)],
  },
  bard: {
    choices: [[[it('rapier')], [it('longsword')], [any('simple')]], [[it('diplomats-pack')], [it('entertainers-pack')]],
      [[it('lute')], [any('instrument')]]],
    fixed: [it('leather-armor'), it('dagger')],
  },
  cleric: {
    choices: [[[it('mace')], [it('warhammer')]], [[it('scale-mail')], [it('leather-armor')], [it('chain-mail')]],
      [[it('crossbow-light'), it('crossbow-bolt', 20)], [any('simple')]], [[it('priests-pack')], [it('explorers-pack')]]],
    fixed: [it('shield'), any('holy-symbol')],
    proficient: ['warhammer', 'chain-mail'],
  },
  druid: {
    choices: [[[it('shield')], [any('simple')]], [[it('scimitar')], [any('simple-melee')]]],
    fixed: [it('leather-armor'), it('explorers-pack'), any('druidic-focus')],
  },
  fighter: {
    choices: [[[it('chain-mail')], [it('leather-armor'), it('longbow'), it('arrow', 20)]],
      [[any('martial'), it('shield')], [any('martial', 2)]], [[it('crossbow-light'), it('crossbow-bolt', 20)], [it('handaxe', 2)]],
      [[it('dungeoneers-pack')], [it('explorers-pack')]]],
    fixed: [],
  },
  monk: {
    choices: [[[it('shortsword')], [any('simple')]], [[it('dungeoneers-pack')], [it('explorers-pack')]]],
    fixed: [it('dart', 10)],
  },
  paladin: {
    choices: [[[any('martial'), it('shield')], [any('martial', 2)]], [[it('javelin', 5)], [any('simple-melee')]],
      [[it('priests-pack')], [it('explorers-pack')]]],
    fixed: [it('chain-mail'), any('holy-symbol')],
  },
  ranger: {
    choices: [[[it('scale-mail')], [it('leather-armor')]], [[it('shortsword', 2)], [any('simple-melee', 2)]],
      [[it('dungeoneers-pack')], [it('explorers-pack')]]],
    fixed: [it('longbow'), it('quiver'), it('arrow', 20)],
  },
  rogue: {
    choices: [[[it('rapier')], [it('shortsword')]], [[it('shortbow'), it('quiver'), it('arrow', 20)], [it('shortsword')]],
      [[it('burglars-pack')], [it('dungeoneers-pack')], [it('explorers-pack')]]],
    fixed: [it('leather-armor'), it('dagger', 2), it('thieves-tools')],
  },
  sorcerer: {
    choices: [[[it('crossbow-light'), it('crossbow-bolt', 20)], [any('simple')]], [[it('component-pouch')], [any('arcane-focus')]],
      [[it('dungeoneers-pack')], [it('explorers-pack')]]],
    fixed: [it('dagger', 2)],
  },
  warlock: {
    choices: [[[it('crossbow-light'), it('crossbow-bolt', 20)], [any('simple')]], [[it('component-pouch')], [any('arcane-focus')]],
      [[it('scholars-pack')], [it('dungeoneers-pack')]]],
    fixed: [it('leather-armor'), any('simple'), it('dagger', 2)],
  },
  wizard: {
    choices: [[[it('quarterstaff')], [it('dagger')]], [[it('component-pouch')], [any('arcane-focus')]],
      [[it('scholars-pack')], [it('explorers-pack')]]],
    fixed: [it('spellbook')],
  },
};

/** What is inside each pack (SRD 5.1), for showing the player what they carry. */
export const PACK_CONTENTS = {
  'burglars-pack': 'a backpack, a bag of 1,000 ball bearings, 10 feet of string, a bell, 5 candles, a crowbar, a hammer, 10 pitons, a hooded lantern, 2 flasks of oil, 5 days of rations, a tinderbox, a waterskin and 50 feet of hempen rope',
  'diplomats-pack': 'a chest, 2 cases for maps and scrolls, a set of fine clothes, a bottle of ink, an ink pen, a lamp, 2 flasks of oil, 5 sheets of paper, a vial of perfume, sealing wax and soap',
  'dungeoneers-pack': 'a backpack, a crowbar, a hammer, 10 pitons, 10 torches, a tinderbox, 10 days of rations, a waterskin and 50 feet of hempen rope',
  'entertainers-pack': 'a backpack, a bedroll, 2 costumes, 5 candles, 5 days of rations, a waterskin and a disguise kit',
  'explorers-pack': 'a backpack, a bedroll, a mess kit, a tinderbox, 10 torches, 10 days of rations, a waterskin and 50 feet of hempen rope',
  'priests-pack': 'a backpack, a blanket, 10 candles, a tinderbox, an alms box, 2 blocks of incense, a censer, vestments, 2 days of rations and a waterskin',
  'scholars-pack': 'a backpack, a book of lore, a bottle of ink, an ink pen, 10 sheets of parchment, a little bag of sand and a small knife',
};

export const gearFor = classId => CLASS_GEAR[classId] || null;

/** The key a pick's chosen item is kept under: choice index (or 'f' for the fixed list), option, part. */
export const pickKey = (choice, opt, part) => `${choice}.${opt}.${part}`;

/** A fresh choice for `classId`: the first option of every choice, the first item of every pick. */
export function defaultGear(classId) {
  const g = gearFor(classId);
  return { cls: classId, opts: g ? g.choices.map(() => 0) : [], picks: {} };
}

/** The draft's gear choice, started afresh when there is none or it was made for another class. */
export function draftGear(draft) {
  if (!draft.gear || draft.gear.cls !== draft.class) draft.gear = defaultGear(draft.class);
  return draft.gear;
}

/** The items (`{ id, qty }`, repeats merged) the choice comes to. An unset or unknown pick takes its first item. */
export function resolveGear(classId, gear, equipment = []) {
  const g = gearFor(classId);
  if (!g) return [];
  const out = new Map();
  const add = (id, qty) => { if (id) out.set(id, (out.get(id) || 0) + qty); };
  const take = (parts, choice, opt) => parts.forEach((p, part) => {
    if (!p.pick) return add(p.id, p.qty);
    const allowed = pickOptions(p.pick, equipment);
    for (let n = 0; n < p.count; n++) {
      const key = pickKey(choice, opt, part) + (n ? '.' + n : '');
      const chosen = gear?.picks?.[key];
      add(allowed.includes(chosen) ? chosen : allowed[0], 1);
    }
  });
  g.choices.forEach((options, c) => {
    const o = Math.min(Math.max(0, Number(gear?.opts?.[c]) || 0), options.length - 1);
    take(options[o], c, o);
  });
  take(g.fixed, 'f', 0);
  return [...out].map(([id, qty]) => ({ id, qty }));
}

/** The background's gear: SRD names matched to items (`{ items, named }`; `named` = no matching item). */
export function backgroundGear(background, equipment = []) {
  const byName = new Map(equipment.map(e => [String(e.name).toLowerCase(), e.id]));
  const items = [], named = [];
  for (const n of background?.starting_equipment || []) {
    const id = byName.get(String(n).toLowerCase());
    if (id) items.push({ id, qty: 1 }); else if (n) named.push(String(n));
  }
  return { items, named };
}

/** A price ("10gp", "5 sp", "2cp") in copper pieces; unknown → null. */
export function costCp(cost) {
  const m = String(cost ?? '').replace(/,/g, '').match(/^\s*(\d+(?:\.\d+)?)\s*(pp|gp|ep|sp|cp)\s*$/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 }[m[2].toLowerCase()]);
}
export const fmtCp = cp => cp % 100 === 0 ? `${cp / 100} gp` : cp % 10 === 0 ? `${cp / 10} sp` : `${cp} cp`;

/** What a player may buy with starting gold: everything with a price except mounts and vehicles. */
export const SHOP_CATEGORIES = ['Weapon', 'Armor', 'Adventuring Gear', 'Tools'];
export const shopItems = (equipment = [], category) =>
  equipment.filter(e => SHOP_CATEGORIES.includes(e.category) && (!category || e.category === category) && costCp(e.cost) != null);

/** The copper spent on `buy` ({ id: count }). */
export function spentCp(buy, equipment = []) {
  let cp = 0;
  for (const [id, n] of Object.entries(buy || {})) cp += (costCp(equipment.find(e => e.id === id)?.cost) || 0) * (Number(n) || 0);
  return cp;
}

/** Add `delta` of item `id` to the draft's shopping, never below 0 nor past the budget. Returns whether it changed. */
export function buyItem(draft, id, delta, budgetCp, equipment = []) {
  const buy = { ...(draft.buy || {}) };
  const next = Math.max(0, (buy[id] || 0) + delta);
  if (next === (buy[id] || 0)) return false;
  if (next) buy[id] = next; else delete buy[id];
  if (delta > 0 && spentCp(buy, equipment) > budgetCp) return false;
  draft.buy = buy;
  return true;
}

/**
 * Write the chosen gear into the draft: `equipment` (ids, once each), `equipmentQty` (id → count, only when > 1)
 * and `gearNamed` (background gear with no item). With starting gold it is what the player bought instead.
 */
export function applyGear(draft, srd) {
  const eq = srd?.equipment || [];
  if (draft.useStartingGold) {
    const buy = Object.entries(draft.buy || {}).filter(([, n]) => n > 0);
    draft.equipment = buy.map(([id]) => id);
    draft.equipmentQty = Object.fromEntries(buy.filter(([, n]) => n > 1));
    draft.gearNamed = [];
    return draft;
  }
  const items = resolveGear(draft.class, draftGear(draft), eq);
  const bg = backgroundGear((srd?.backgrounds || []).find(b => b.id === draft.background), eq);
  const all = new Map();
  for (const { id, qty } of [...items, ...bg.items]) all.set(id, (all.get(id) || 0) + qty);
  draft.equipment = [...all.keys()];
  draft.equipmentQty = Object.fromEntries([...all].filter(([, q]) => q > 1));
  draft.gearNamed = bg.named;
  return draft;
}

/** "Greataxe", "2 × Handaxe", "any martial melee weapon", for an option's label. */
export function partLabel(p, equipment = []) {
  if (p.pick) return (p.count > 1 ? p.count + ' × ' : '') + (PICK_KINDS[p.pick]?.label || p.pick);
  const name = equipment.find(e => e.id === p.id)?.name || p.id;
  return (p.qty > 1 ? p.qty + ' × ' : '') + name;
}
