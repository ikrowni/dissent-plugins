// core/plausible.js — is a contribution believable? Run by the stats service on every submission.
//
// Nothing can prove a run is genuine: this refuses what the game cannot produce, so the statistics
// only have to withstand junk that looks real (community stats spec §5). Pure apart from data lookups.
//
// ⚠️ Unknown ids are TOLERATED up to MAX.unknownShare. A genuine run from an older build can hold ids the
// current data lacks (the v0.99.1 fixture holds CARD.GRAPPLE, gone by 1.3.0), so refusing any unknown id
// would refuse real history forever.

import { CONTRIBUTION_SCHEMA } from './contribution.js';

const ID = /^[A-Z]+\.[A-Z0-9_]+$/;
const KIND_OF = { CARD: 'card', RELIC: 'relic', POTION: 'potion', ENCOUNTER: 'encounter' };

export const MAX = { players: 4, floors: 80, deck: 200, relics: 60, potions: 10, choices: 400, ascension: 20, hp: 999, runMinutes: 1440, upgrades: 10, damage: 99999, unknownShare: 0.1 };

// 🔴 Exactly these fields and no others. A contribution is stored as sent, so an extra field — a run id, a
// Steam id, anything a modified client adds — would be kept verbatim. Refusing unknown fields is what makes
// "no id, no timestamp" true of the database and not only of this plugin.
const FIELDS = {
  top: ['ascension', 'build', 'floors', 'killedBy', 'players', 'runMinutes', 'schema', 'win'],
  player: ['character', 'choices', 'damageByAct', 'deck', 'floors', 'potions', 'relics'],
  floor: ['act', 'damage', 'encounter', 'hp', 'maxHp', 'type'],
  card: ['enchantment', 'id', 'upgrades'],
  choice: ['id', 'picked'],
};
const onlyFields = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const ids = (list, max) => Array.isArray(list) && list.length <= max && list.every((x) => typeof x === 'string' && ID.test(x));

function floorOk(f) {
  return f && int(f.act, 1, 5) && typeof f.type === 'string' && f.type.length <= 32
    && (f.encounter === null || (typeof f.encounter === 'string' && ID.test(f.encounter)))
    && (f.hp === null || int(f.hp, 0, MAX.hp)) && (f.maxHp === null || int(f.maxHp, 1, MAX.hp))
    && int(f.damage, 0, MAX.damage);
}

/** `{ ok: true }` or `{ ok: false, reason }` — the first rule broken. */
export async function checkContribution(c, data) {
  const fail = (reason) => ({ ok: false, reason });
  if (!c || typeof c !== 'object' || Array.isArray(c)) return fail('not_an_object');
  if (c.schema !== CONTRIBUTION_SCHEMA) return fail('schema');
  if (typeof c.build !== 'string' || !/^v?\d+\.\d+(\.\d+)?$/.test(c.build)) return fail('build');
  if (!int(c.ascension, 0, MAX.ascension)) return fail('ascension');
  if (typeof c.win !== 'boolean') return fail('win');
  if (c.win ? c.killedBy !== null : !(typeof c.killedBy === 'string' && ID.test(c.killedBy))) return fail('killed_by');
  if (!int(c.floors, 1, MAX.floors)) return fail('floors');
  if (c.runMinutes !== null && !int(c.runMinutes, 0, MAX.runMinutes)) return fail('run_minutes');
  if (!Array.isArray(c.players) || c.players.length < 1 || c.players.length > MAX.players) return fail('players');
  if (!onlyFields(c, FIELDS.top)) return fail('fields');
  for (const p of c.players) {
    if (!p || typeof p !== 'object') return fail('players');
    if (!onlyFields(p, FIELDS.player)) return fail('fields');
    for (const [list, allowed] of [[p.floors, FIELDS.floor], [p.deck, FIELDS.card], [p.choices, FIELDS.choice]]) {
      if (Array.isArray(list) && list.some((x) => x && typeof x === 'object' && !onlyFields(x, allowed))) return fail('fields');
    }
  }

  const seen = c.killedBy ? [c.killedBy] : [];
  for (const p of c.players) {
    if (!p || typeof p.character !== 'string' || !/^CHARACTER\.[A-Z0-9_]+$/.test(p.character)) return fail('character');
    if (!Array.isArray(p.deck) || p.deck.length > MAX.deck || !p.deck.every((d) => d && typeof d.id === 'string' && ID.test(d.id)
      && int(d.upgrades, 0, MAX.upgrades) && (d.enchantment === undefined || (typeof d.enchantment === 'string' && ID.test(d.enchantment))))) return fail('deck');
    if (!ids(p.relics, MAX.relics)) return fail('relics');
    if (!ids(p.potions, MAX.potions)) return fail('potions');
    if (!Array.isArray(p.choices) || p.choices.length > MAX.choices
      || !p.choices.every((x) => x && typeof x.id === 'string' && ID.test(x.id) && typeof x.picked === 'boolean')) return fail('choices');
    if (!Array.isArray(p.damageByAct) || p.damageByAct.length > 5 || !p.damageByAct.every((v) => int(v, 0, MAX.damage))) return fail('damage');
    if (!Array.isArray(p.floors) || p.floors.length > MAX.floors || !p.floors.every(floorOk)) return fail('floor_rows');
    seen.push(...p.deck.map((d) => d.id), ...p.relics, ...p.potions, ...p.choices.map((x) => x.id),
      ...p.floors.map((f) => f.encounter).filter(Boolean));
  }

  const checkable = seen.filter((id) => KIND_OF[id.slice(0, id.indexOf('.'))]);
  let unknown = 0;
  for (const id of checkable) {
    const dot = id.indexOf('.');
    if ((await data.get(KIND_OF[id.slice(0, dot)], id.slice(dot + 1))).unknown) unknown += 1;
  }
  if (checkable.length && unknown / checkable.length > MAX.unknownShare) return fail('unknown_ids');
  return { ok: true };
}
