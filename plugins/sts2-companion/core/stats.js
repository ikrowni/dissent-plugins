// core/stats.js — community stats: where they come from, and what they say. The ONLY module that knows.
//
// Loading order (spec §7): the copy cached in storage:local → at most once a day a conditional net.fetch
// (If-None-Match, so an unchanged day is a 304) → the snapshot bundled with this plugin release. Web users,
// users who declined net:direct, and anyone offline get the cache or the snapshot, labelled as such.
//
// The file holds COUNTS; rates and Wilson intervals are computed here, exactly as Insights does for the
// user's own runs.

import { wilson } from './wilson.js';
import { compareBuilds } from './builds.js';
import { STATS_HOST } from './sharing.js';

export const STATS_URL = `${STATS_HOST}/v1/stats/latest.json`;
export const CACHE_KEY = 'community:stats';
export const DAY_MS = 86_400_000;
/** Like Insights: a card needs this many runs picking it AND skipping it before a difference is shown. */
const MIN_EACH_WAY = 5;

const isStats = (v) => v && v.schema === 1 && v.builds && typeof v.builds === 'object';

export async function loadStats({ local, net, snapshot, now = Date.now() }) {
  const cached = await Promise.resolve().then(() => local.get(CACHE_KEY)).catch(() => null);
  const cache = isStats(cached?.stats) ? cached : null;
  if (cache && now - cache.checkedAt < DAY_MS) return { source: 'cache', stats: cache.stats };

  try {
    const r = await net(STATS_URL, { headers: cache?.etag ? { 'If-None-Match': cache.etag } : {} });
    if (r.status === 304 && cache) {
      await local.set(CACHE_KEY, { ...cache, checkedAt: now }).catch(() => {});
      return { source: 'cache', stats: cache.stats };
    }
    if (r.status === 200) {
      const stats = JSON.parse(r.body);
      if (isStats(stats)) {
        await local.set(CACHE_KEY, { etag: r.etag ?? null, checkedAt: now, stats }).catch(() => {});
        return { source: 'network', stats };
      }
    }
  } catch {
    // Not granted, desktop only, or offline: fall back below.
  }

  if (cache) return { source: 'cache', stale: true, stats: cache.stats };
  const bundled = await Promise.resolve().then(() => snapshot()).catch(() => null);
  if (isStats(bundled)) return { source: 'snapshot', stats: bundled };
  return { source: 'none', stats: null };
}

/** The published cell for this group — in the user's build if it has one, else the newest build that does. */
export function pickCell(stats, { build, character, band, mode }) {
  if (!isStats(stats)) return null;
  const find = (b) => stats.builds[b]?.cells?.find((c) => c.character === character && c.band === band && c.mode === mode);
  const own = build && find(build);
  if (own) return { build, sameBuild: true, cell: own };
  for (const b of Object.keys(stats.builds).sort(compareBuilds).reverse()) {
    const cell = find(b);
    if (cell) return { build: b, sameBuild: false, cell };
  }
  return null;
}

const rate = (k, n) => {
  const w = wilson(k, n);
  return w ? { ...w, n } : { rate: null, low: null, high: null, n };
};

export function communityRates(cell) {
  return {
    runs: cell.runs,
    winRate: rate(cell.wins, cell.runs),
    floorBuckets: cell.floorBuckets,
    encounters: cell.encounters
      .map((e) => ({ id: e.id, fought: e.fought, deaths: e.deaths, rate: rate(e.deaths, e.fought) }))
      .sort((a, b) => b.rate.rate - a.rate.rate || b.fought - a.fought),
    buildTypes: cell.buildTypes.map((t) => ({ label: t.label, runs: t.runs, wins: t.wins, rate: rate(t.wins, t.runs), medianFloor: t.medianFloor })),
    cards: cell.cards.map((c) => {
      const skipped = c.offered - c.picked;
      const pickedRate = rate(c.pickedWins, c.picked);
      const skippedRate = rate(c.skippedWins, skipped);
      const impact = c.picked >= MIN_EACH_WAY && skipped >= MIN_EACH_WAY ? pickedRate.rate - skippedRate.rate : null;
      return { id: c.id, offered: c.offered, picked: c.picked, pickRate: rate(c.picked, c.offered), pickedRate, skippedRate, impact };
    }).sort((a, b) => Math.abs(b.impact ?? -1) - Math.abs(a.impact ?? -1) || b.offered - a.offered),
  };
}
