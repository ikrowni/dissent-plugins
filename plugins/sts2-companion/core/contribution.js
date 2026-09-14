// core/contribution.js — one finished run as the anonymous contribution STS2 community stats pools.
//
// Shared by the plugin (which builds and sends it) and the stats service (which checks and counts it),
// so both mean the same thing by a contribution. Pure: no DOM, no network.
//
// 🔴 No id, no timestamp, no exact duration. The run id IS the start timestamp, and a timestamp links a
// shared run to a person who said "just died on floor 38" (community stats spec §3). Duration is kept
// only rounded to ten minutes.

import { floorRows, floorChanges } from './runs.js';

export const CONTRIBUTION_SCHEMA = 1;

const FIGHTS = new Set(['monster', 'elite', 'boss']);

function player(run, p) {
  const rows = floorRows(run, p.player);
  const damageByAct = [];
  const choices = new Map();
  for (const r of rows) {
    const c = floorChanges(r.stats);
    damageByAct[r.act - 1] = (damageByAct[r.act - 1] ?? 0) + c.damage;
    for (const id of c.cardSkipped) if (!choices.has(id)) choices.set(id, false);
    for (const id of c.cardPicked) choices.set(id, true);
  }
  return {
    character: p.character,
    deck: (p.deck ?? []).map((d) => ({ id: d.id, upgrades: d.upgrades ?? 0, ...(d.enchantment ? { enchantment: d.enchantment } : {}) })),
    relics: [...(p.relics ?? [])],
    potions: [...(p.potions ?? [])],
    damageByAct: Array.from(damageByAct, (v) => v ?? 0),
    choices: [...choices].map(([id, picked]) => ({ id, picked })),
    floors: rows.map((r) => ({
      act: r.act,
      type: r.type,
      encounter: r.rooms.find((x) => FIGHTS.has(x.type) && x.id)?.id ?? null,
      hp: r.stats?.hp ?? null,
      maxHp: r.stats?.max_hp ?? null,
      damage: r.stats?.damage_taken ?? 0,
    })),
  };
}

/** The contribution for a `game.saves.run` answer, or null when it is not a finished standard run. */
export function buildContribution(run) {
  const s = run?.summary;
  if (run?.status !== 'ok' || !s) return null;
  if (s.abandoned || s.game_mode !== 'standard' || (!s.win && !s.killed_by)) return null;
  return {
    schema: CONTRIBUTION_SCHEMA,
    build: String(s.build ?? ''),
    ascension: s.ascension ?? 0,
    win: Boolean(s.win),
    floors: s.floors ?? (run.floors ?? []).length,
    killedBy: s.win ? null : s.killed_by,
    runMinutes: Number.isFinite(s.run_time) ? Math.round(s.run_time / 600) * 10 : null,
    players: (run.players ?? []).map((p) => player(run, p)),
  };
}

/** JSON with object keys sorted at every depth — the form a contribution is hashed in. */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
