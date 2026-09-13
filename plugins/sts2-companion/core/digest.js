// core/digest.js — one finished run as the small summary Insights works from.
//
// Kept once per run in storage:local (core/digestStore.js), so opening Insights reads only runs it has
// not seen. Bump DIGEST_VERSION whenever the shape or a rule here changes: every cached digest is then
// rebuilt rather than half-trusted.
//
// 🔴 No time fields. The `id` is the run's start timestamp and is kept ONLY as the device-local cache
// key; the community contribution built later drops it (community stats spec §3).
// 🔴 Co-op: the save numbers players by net_id and cannot say which one is the user, so a co-op
// digest has run-level facts only (`solo: null`).

import { floorRows, floorChanges } from './runs.js';
import { classifyDeck } from './classify.js';

export const DIGEST_VERSION = 1;

const FIGHTS = new Set(['monster', 'elite', 'boss']);

export async function runDigest(run, data) {
  const s = run?.summary ?? {};
  const floors = run?.floors ?? [];
  const fought = [...new Set(floors.flatMap((f) => (f.rooms ?? []).filter((r) => FIGHTS.has(r.type) && r.id).map((r) => r.id)))];
  const digest = {
    v: DIGEST_VERSION,
    id: String(s.id),
    build: s.build ?? null,
    ascension: s.ascension ?? 0,
    players: s.players ?? run?.players?.length ?? 1,
    characters: s.characters ?? [],
    win: Boolean(s.win),
    abandoned: Boolean(s.abandoned),
    floors: s.floors ?? floors.length,
    killedBy: s.killed_by ?? null,
    fought,
    solo: null,
  };
  if (digest.players !== 1 || run?.players?.length !== 1) return digest;

  const p = run.players[0];
  const damageByAct = [];
  const choices = new Map();
  for (const row of floorRows(run, p.player)) {
    const c = floorChanges(row.stats);
    damageByAct[row.act - 1] = (damageByAct[row.act - 1] ?? 0) + c.damage;
    for (const id of c.cardSkipped) if (!choices.has(id)) choices.set(id, false);
    for (const id of c.cardPicked) choices.set(id, true);
  }
  const build = await classifyDeck(p.deck, p.character, data);
  digest.solo = {
    character: p.character,
    buildTags: build.tags,
    damageByAct: Array.from(damageByAct, (v) => v ?? 0),
    choices: [...choices].map(([id, picked]) => ({ id, picked })),
  };
  return digest;
}
