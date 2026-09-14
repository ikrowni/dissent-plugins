// core/digest.js — one finished run as the small summary Insights works from.
//
// Kept once per run in storage:local (core/digestStore.js), so opening Insights reads only runs it has
// not seen. Bump DIGEST_VERSION whenever the shape or a rule here changes: every cached digest is then
// rebuilt rather than half-trusted.
//
// 🔴 No time fields. The `id` is the run's start timestamp and is kept ONLY as the device-local cache
// key; the community contribution built later drops it (community stats spec §3).
// 🔴 Per-player facts (`mine`) are kept only for the player the app says was this computer's
// (`summary.you`: 1 in a solo run; in co-op matched from the Steam account folder, desktop v1.2.240+).
// When it cannot say — an older desktop, an unmatched account — `mine` is null: never a guess at player 1.

import { floorRows, floorChanges } from './runs.js';
import { classifyDeck } from './classify.js';

/** 2: per-player facts for YOUR player in co-op too (`mine`, was `solo`). 3: `gameMode`. */
export const DIGEST_VERSION = 3;

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
    gameMode: s.game_mode ?? null,
    killedBy: s.killed_by ?? null,
    fought,
    mine: null,
  };
  const you = s.you ?? (digest.players === 1 && run?.players?.length === 1 ? 1 : null);
  const p = you == null ? null : run?.players?.find((x) => x.player === you);
  if (!p) return digest;

  const damageByAct = [];
  const choices = new Map();
  for (const row of floorRows(run, p.player)) {
    const c = floorChanges(row.stats);
    damageByAct[row.act - 1] = (damageByAct[row.act - 1] ?? 0) + c.damage;
    for (const id of c.cardSkipped) if (!choices.has(id)) choices.set(id, false);
    for (const id of c.cardPicked) choices.set(id, true);
  }
  const build = await classifyDeck(p.deck, p.character, data);
  digest.mine = {
    character: p.character,
    buildTags: build.tags,
    damageByAct: Array.from(damageByAct, (v) => v ?? 0),
    choices: [...choices].map(([id, picked]) => ({ id, picked })),
  };
  return digest;
}
