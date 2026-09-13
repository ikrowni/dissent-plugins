// core/runs.js — maths over a finished run (game.saves.run) and profile stats. No DOM.
// Ids stay save ids (`CARD.BASH`) here; views name them through data.label().

import { saveIdToDataId } from './data.js';

/** Every floor as a row for one player (1-based, as the projection numbers them). */
export function floorRows(run, player = 1) {
  return (run?.floors ?? []).map((f, i) => ({
    floor: i + 1,
    act: (f.act ?? 0) + 1,
    type: f.type ?? 'unknown',
    rooms: (f.rooms ?? []).map((r) => ({ id: r.id ?? null, type: r.type ?? null, turns: r.turns ?? null, monsters: r.monsters ?? [] })),
    stats: (f.players ?? []).find((p) => p.player === player) ?? null,
  }));
}

export function hpSeries(rows) {
  return rows.filter((r) => Number.isFinite(r.stats?.hp)).map((r) => ({ x: r.floor, y: r.stats.hp, max: r.stats.max_hp }));
}

/** A labelled mark on the first floor of every act after the first. */
export function actMarks(rows) {
  return rows.filter((r, i) => i > 0 && r.act !== rows[i - 1].act).map((r) => ({ x: r.floor, label: `Act ${r.act}` }));
}

/** What one player's floor changed, as save ids. */
export function floorChanges(stats) {
  const s = stats ?? {};
  const picked = (list) => (list ?? []).filter((c) => c.picked).map((c) => c.id);
  const cardPicked = picked(s.card_choices);
  const gained = [...(s.cards_gained ?? [])];
  for (const id of cardPicked) { const i = gained.indexOf(id); if (i >= 0) gained.splice(i, 1); }
  return {
    cardPicked,
    cardSkipped: (s.card_choices ?? []).filter((c) => !c.picked).map((c) => c.id),
    gained,
    relics: picked(s.relic_choices),
    potions: picked(s.potion_choices),
    upgraded: s.upgraded_cards ?? [],
    removed: s.cards_removed ?? [],
    transformed: s.cards_transformed ?? [],
    potionsUsed: s.potions_used ?? [],
    rest: s.rest_site_choices ?? [],
    damage: s.damage_taken ?? 0,
  };
}

export const outcome = (summary) => (summary?.win ? 'Victory' : summary?.abandoned ? 'Abandoned' : 'Defeat');

export function formatDuration(secs) {
  if (!Number.isFinite(secs)) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (!h && !m) return '<1m';
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Profile card stats with names and rates. A rate is null when there is nothing to divide. */
export async function cardStatRows(data, stats) {
  return Promise.all((stats?.cards ?? []).map(async (c) => {
    const card = await data.get('card', saveIdToDataId(String(c.id)).id);
    const picked = c.picked ?? 0; const skipped = c.skipped ?? 0; const won = c.won ?? 0; const lost = c.lost ?? 0;
    return {
      id: c.id, name: card.name, unknown: Boolean(card.unknown), color: card.color ?? null,
      picked, skipped, won, lost,
      pickRate: picked + skipped ? picked / (picked + skipped) : null,
      winRate: won + lost ? won / (won + lost) : null,
    };
  }));
}

/** Sort by a column; nulls last in either direction; ties by name. */
export function sortRows(rows, key, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key]; const y = b[key];
    if (x == null || y == null) return (x == null) - (y == null) || a.name.localeCompare(b.name);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return c * sign || a.name.localeCompare(b.name);
  });
}
