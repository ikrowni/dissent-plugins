import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildContribution, canonicalJSON, CONTRIBUTION_SCHEMA } from './contribution.js';

const ROOT = process.cwd();
const run = JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/run-1773796874.json`));

describe('buildContribution on the REAL co-op run', () => {
  it('keeps what the statistics need', () => {
    const c = buildContribution(run);
    expect(c).toMatchObject({
      schema: CONTRIBUTION_SCHEMA, build: 'v0.99.1', ascension: 0, win: false, floors: 39,
      killedBy: 'ENCOUNTER.SOUL_NEXUS_ELITE', runMinutes: 140,
    });
    expect(c.players).toHaveLength(2);
    const p1 = c.players[0];
    expect(p1.character).toBe('CHARACTER.IRONCLAD');
    expect(p1.deck).toHaveLength(30);
    expect(p1.deck.find((d) => d.enchantment === 'ENCHANTMENT.SOWN')).toEqual({ id: 'CARD.BASH', upgrades: 1, enchantment: 'ENCHANTMENT.SOWN' });
    expect(p1.relics).toHaveLength(11);
    expect(p1.damageByAct).toEqual([101, 221, 92]);
    expect(p1.choices).toHaveLength(46);
    expect(p1.choices.filter((x) => x.picked)).toHaveLength(16);
    expect(p1.floors).toHaveLength(39);
    expect(p1.floors[0]).toEqual({ act: 1, type: 'monster', encounter: 'ENCOUNTER.NIBBITS_WEAK', hp: 69, maxHp: 80, damage: 17 });
  });

  // 🔴 The run id IS its start timestamp; a timestamp links a shared run to a person (spec §3).
  it('🔴 carries no id, no timestamp and no exact duration', () => {
    const json = JSON.stringify(buildContribution(run));
    expect(json).not.toContain(String(run.summary.started_at));
    for (const key of ['"id":"1773796874"', 'started_at', 'saved_at', 'run_time']) expect(json).not.toContain(key);
  });

  it('refuses what is not a finished standard run', () => {
    expect(buildContribution({ ...run, summary: { ...run.summary, abandoned: true } })).toBeNull();
    expect(buildContribution({ ...run, summary: { ...run.summary, killed_by: null, win: false } })).toBeNull();
    expect(buildContribution({ ...run, summary: { ...run.summary, game_mode: 'daily' } })).toBeNull();
    expect(buildContribution({ status: 'not_found' })).toBeNull();
    // Started and left: never past the first floor.
    expect(buildContribution({ ...run, summary: { ...run.summary, floors: 1 } })).toBeNull();
  });

  it('a win carries no killer', () => {
    expect(buildContribution({ ...run, summary: { ...run.summary, win: true } }).killedBy).toBeNull();
  });
});

describe('canonicalJSON', () => {
  it('is the same whatever the key order', () => {
    expect(canonicalJSON({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJSON({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
