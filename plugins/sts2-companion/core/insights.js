// core/insights.js — digests in, the figures Insights shows out. Pure.
//
// Honesty rules (community stats spec §2): a rate needs MIN_RATE_N samples to be shown and is marked
// lowSample under LOW_SAMPLE_N; every shown rate carries a Wilson interval. Co-op runs count toward
// run-level figures only.

import { wilson } from './wilson.js';
import { buildTypeLabel } from './classify.js';

export const MIN_RATE_N = 5;
export const LOW_SAMPLE_N = 20;

export function rateOf(k, n) {
  if (n < MIN_RATE_N) return { rate: null, low: null, high: null, n, lowSample: true };
  return { ...wilson(k, n), n, lowSample: n < LOW_SAMPLE_N };
}

const FLOOR_BUCKETS = [[1, 10, '1–10'], [11, 20, '11–20'], [21, 30, '21–30'], [31, 40, '31–40'], [41, Infinity, '41+']];

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function insights(digests, { character = null } = {}) {
  const finished = (digests ?? []).filter((d) => d && !d.abandoned && (d.win || d.killedBy));
  const runs = character ? finished.filter((d) => d.characters.includes(character)) : finished;
  // Runs where the app said which player was you: per-player figures come from these only.
  const mine = runs.filter((d) => d.mine && (!character || d.mine.character === character));

  const floorBuckets = FLOOR_BUCKETS.map(([lo, hi, label]) => ({ label, n: runs.filter((d) => d.floors >= lo && d.floors <= hi).length }));

  const enc = new Map();
  for (const d of runs) {
    for (const id of d.fought) {
      const e = enc.get(id) ?? { id, fought: 0, deaths: 0 };
      e.fought += 1;
      if (d.killedBy === id) e.deaths += 1;
      enc.set(id, e);
    }
  }
  const encounters = [...enc.values()]
    .map((e) => ({ ...e, rate: rateOf(e.deaths, e.fought) }))
    .sort((a, b) => b.deaths - a.deaths || (b.rate.rate ?? -1) - (a.rate.rate ?? -1) || a.id.localeCompare(b.id));

  const damageByAct = [];
  for (const d of mine) {
    d.mine.damageByAct.forEach((v, i) => {
      const a = damageByAct[i] ?? { act: i + 1, total: 0, n: 0 };
      a.total += v; a.n += 1;
      damageByAct[i] = a;
    });
  }

  const builds = new Map();
  for (const d of mine) {
    const label = buildTypeLabel(d.mine.buildTags);
    const b = builds.get(label) ?? { label, runs: 0, wins: 0, floors: [] };
    b.runs += 1; if (d.win) b.wins += 1; b.floors.push(d.floors);
    builds.set(label, b);
  }
  const buildTypes = [...builds.values()]
    .map((b) => ({ label: b.label, runs: b.runs, wins: b.wins, rate: rateOf(b.wins, b.runs), medianFloor: median(b.floors) }))
    .sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label));

  const cardMap = new Map();
  for (const d of mine) {
    for (const ch of d.mine.choices) {
      const c = cardMap.get(ch.id) ?? { id: ch.id, offered: 0, picked: 0, pickedWins: 0, skippedWins: 0 };
      c.offered += 1;
      if (ch.picked) { c.picked += 1; if (d.win) c.pickedWins += 1; } else if (d.win) c.skippedWins += 1;
      cardMap.set(ch.id, c);
    }
  }
  const cards = [...cardMap.values()].map((c) => {
    const pickedRate = rateOf(c.pickedWins, c.picked);
    const skippedRate = rateOf(c.skippedWins, c.offered - c.picked);
    const impact = pickedRate.rate != null && skippedRate.rate != null ? pickedRate.rate - skippedRate.rate : null;
    return { id: c.id, offered: c.offered, picked: c.picked, pickedRate, skippedRate, impact };
  }).sort((a, b) => (b.impact ?? -Infinity) - (a.impact ?? -Infinity) || b.offered - a.offered || a.id.localeCompare(b.id));

  return {
    runs: runs.length,
    soloRuns: runs.filter((d) => d.players === 1).length,
    coopRuns: runs.filter((d) => d.players !== 1).length,
    yourRuns: mine.length,
    wins: runs.filter((d) => d.win).length,
    floorBuckets,
    encounters,
    damageByAct: damageByAct.filter(Boolean).map((a) => ({ act: a.act, mean: Math.round(a.total / a.n), n: a.n })),
    buildTypes,
    cards,
  };
}
