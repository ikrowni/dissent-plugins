import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from './data.js';
import { runDigest, DIGEST_VERSION } from './digest.js';

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const run = JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/run-1773796874.json`));

/**
 * ⚠️ DERIVED, not captured: there is no finished SOLO run fixture. This keeps the real co-op run's
 * player 1 and nothing else — the projection's shape for a one-player run. Windows check 3 (plan
 * Task 10) is what proves solo runs on real saves.
 */
const soloFrom = (r) => ({
  ...r,
  summary: { ...r.summary, players: 1, you: 1, characters: [r.summary.characters[0]] },
  players: [r.players[0]],
  floors: r.floors.map((f) => ({ ...f, players: f.players.filter((p) => p.player === 1) })),
});

describe('the REAL co-op run', () => {
  it('keeps run-level facts, and per-player ones for YOUR player (the app says which: player 2)', async () => {
    expect(run.summary.you).toBe(2);
    const d = await runDigest(run, createData({ load }));
    expect(d).toMatchObject({
      v: DIGEST_VERSION, id: '1773796874', build: 'v0.99.1', ascension: 0, players: 2,
      characters: ['CHARACTER.IRONCLAD', 'CHARACTER.IRONCLAD'], win: false, abandoned: false,
      floors: 39, killedBy: 'ENCOUNTER.SOUL_NEXUS_ELITE', gameMode: 'standard',
    });
    expect(d.fought).toHaveLength(19);
    expect(new Set(d.fought).size).toBe(19);
    expect(d.fought).toContain('ENCOUNTER.SOUL_NEXUS_ELITE');
    // Player 2's own damage, summed from the real floors — not player 1's [101, 221, 92].
    const expected = [];
    for (const f of run.floors) {
      const p2 = f.players.find((p) => p.player === 2);
      expected[f.act] = (expected[f.act] ?? 0) + (p2?.damage_taken ?? 0);
    }
    expect(d.mine.character).toBe('CHARACTER.IRONCLAD');
    expect(d.mine.damageByAct).toEqual(Array.from(expected, (v) => v ?? 0));
    expect(d.mine.damageByAct).not.toEqual([101, 221, 92]);
    expect(d.mine.choices.length).toBeGreaterThan(0);
  });

  // 🔴 When the app cannot say which player was the user (older desktop, or an unmatched account),
  // nothing per-player is kept — never a guess at player 1.
  it('co-op with no known local player keeps run-level facts only', async () => {
    const d = await runDigest({ ...run, summary: { ...run.summary, you: null } }, createData({ load }));
    expect(d.mine).toBeNull();
    const old = await runDigest({ ...run, summary: (({ you, ...rest }) => rest)(run.summary) }, createData({ load }));
    expect(old.mine).toBeNull();
  });

  // The run id IS its start timestamp; the digest keeps it only as the device-local cache key.
  // Nothing else about when or how long is kept — the community contribution (a later plan) drops the id too.
  it('keeps no time fields beyond the id it is cached under', async () => {
    const d = await runDigest(run, createData({ load }));
    for (const key of ['started_at', 'startedAt', 'run_time', 'runTime', 'saved_at']) expect(key in d).toBe(false);
  });
});

describe('a solo run (derived from the real one)', () => {
  it('adds the build type, damage by act and distinct card choices', async () => {
    const d = await runDigest(soloFrom(run), createData({ load }));
    expect(d.players).toBe(1);
    expect(d.mine.character).toBe('CHARACTER.IRONCLAD');
    expect(d.mine.buildTags).toEqual(['Vulnerable']);
    expect(d.mine.damageByAct).toEqual([101, 221, 92]);
    expect(d.mine.choices).toHaveLength(46);
    expect(d.mine.choices.filter((c) => c.picked)).toHaveLength(16);
    expect(d.mine.choices.find((c) => c.id === 'CARD.SETUP_STRIKE')).toEqual({ id: 'CARD.SETUP_STRIKE', picked: true });
  });

  it('a digest is small', async () => {
    const d = await runDigest(soloFrom(run), createData({ load }));
    expect(JSON.stringify(d).length).toBeLessThan(4000);
  });
});
