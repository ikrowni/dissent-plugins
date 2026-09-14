import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, publish, compareBuilds, MIN_RUNS, MIN_OFFERS } from './aggregate.mjs';
import { openDb } from './db.mjs';
import { pluginData } from './data.mjs';
import { buildContribution } from '../../../plugins/sts2-companion/core/contribution.js';

const run = JSON.parse(readFileSync(new URL('../../../scripts/sts2/fixtures/saves/run-1773796874.json', import.meta.url)));
const base = () => structuredClone(buildContribution(run));
const many = (n, over = {}) => Array.from({ length: n }, () => ({ ...base(), ...over }));

describe('aggregate', () => {
  it(`publishes nothing about a cell under ${MIN_RUNS} runs`, async () => {
    const stats = await aggregate(many(MIN_RUNS - 1), pluginData());
    expect(stats.builds['v0.99.1'].runs).toBe(MIN_RUNS - 1);
    expect(stats.builds['v0.99.1'].cells).toEqual([]);
  });

  it('counts a co-op cell from the REAL run: the killer, both players\' build types, card offers', async () => {
    const stats = await aggregate(many(60), pluginData());
    const [cell] = stats.builds['v0.99.1'].cells;
    expect(cell).toMatchObject({ character: 'CHARACTER.IRONCLAD', band: '0', mode: 'coop', runs: 60, wins: 0 });
    expect(cell.encounters.find((e) => e.id === 'ENCOUNTER.SOUL_NEXUS_ELITE')).toEqual({ id: 'ENCOUNTER.SOUL_NEXUS_ELITE', fought: 60, deaths: 60 });
    expect(cell.buildTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Vulnerable', runs: 60 }),
      expect.objectContaining({ label: 'Mixed', runs: 60 }),
    ]));
    expect(cell.floorBuckets.find((b) => b.label === '31–40').n).toBe(60);
    for (const card of cell.cards) expect(card.offered).toBeGreaterThanOrEqual(MIN_OFFERS);
  });

  it('separates bands, modes and builds', async () => {
    const solo = base(); solo.players = [solo.players[0]];
    const stats = await aggregate([...many(50), ...many(50, { ascension: 7 }), ...Array.from({ length: 50 }, () => structuredClone(solo))], pluginData());
    const keys = stats.builds['v0.99.1'].cells.map((c) => `${c.band}|${c.mode}`).sort();
    expect(keys).toEqual(['0|coop', '0|solo', '5-9|coop']);
  });
});

describe('publish', () => {
  it('orders builds by version and keeps the newest three', () => {
    expect(['v0.99.1', '1.3.0', 'v1.10.0', '1.2.9'].sort(compareBuilds)).toEqual(['v0.99.1', '1.2.9', '1.3.0', 'v1.10.0']);
    expect(compareBuilds('v1.10.0', '1.3.0')).toBeGreaterThan(0);
  });

  it('writes latest.json and one file per build atomically, and prunes old builds\' raw runs', async () => {
    const db = openDb(':memory:');
    const add = db.prepare('INSERT INTO runs (key, contributor_id, build, received_day, body) VALUES (?, ?, ?, ?, ?)');
    ['1.0.0', '1.1.0', '1.2.0', '1.3.0'].forEach((b, i) => add.run(`k${i}`, 'c', b, 1, JSON.stringify({ ...base(), build: b })));
    const out = mkdtempSync(join(tmpdir(), 'sts2-stats-'));
    await publish({ db, data: pluginData(), outDir: out, keepBuilds: 3 });
    expect(readdirSync(out).sort()).toEqual(['latest.json', 'stats-1.1.0.json', 'stats-1.2.0.json', 'stats-1.3.0.json']);
    expect(db.prepare('SELECT build FROM runs ORDER BY build').all().map((r) => r.build)).toEqual(['1.1.0', '1.2.0', '1.3.0']);
    const latest = JSON.parse(readFileSync(join(out, 'latest.json')));
    expect(latest).toMatchObject({ schema: 1, minRuns: MIN_RUNS, minOffers: MIN_OFFERS });
    expect(latest.available).toEqual(['1.1.0', '1.2.0', '1.3.0']);
    expect(Object.keys(latest.builds)).toEqual(['1.3.0']); // newest only: size stays under net:direct's cap
    expect(Object.keys(JSON.parse(readFileSync(join(out, 'stats-1.1.0.json'))).builds)).toEqual(['1.1.0']);
  });
});
