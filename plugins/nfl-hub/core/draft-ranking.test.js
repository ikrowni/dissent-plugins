import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setRanking, getRanking, rankingFor } from './draft-ranking.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const asset = JSON.parse(readFileSync(join(HERE, '..', 'assets', 'draft-ranking.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(HERE, '..', 'assets', 'players.index.json'), 'utf8'));

const SCORINGS = ['ppr', 'half', 'std'];
const positionOf = (id) => String(index[String(id)]?.p ?? '').toUpperCase();

beforeEach(() => setRanking(null));

// ⚠️ THE BUG THIS FILE EXISTS FOR. On 2026-08-31 the shipped asset was built
// from the 2025 season's ACTUAL points and had been since 2026-08-10. Nothing
// anywhere asserted the board was for the season being drafted, so it went a
// whole offseason without a rookie in it and was reported as "the rankings are
// incorrect". A wrong formula would have been caught by review; a stale file
// looks exactly like a correct one.
describe('the shipped ranking is for the season being drafted', () => {
  // The NFL season spans two calendar years and drafts run in the late summer,
  // so from July onward the live draft season is the current calendar year.
  const now = new Date();
  const draftSeason = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

  it(`is not stale (needs season >= ${draftSeason})`, () => {
    expect(asset.season).toBeGreaterThanOrEqual(draftSeason);
  });

  it('records what it was built from, so a stale file is diagnosable', () => {
    expect(String(asset.basis)).toMatch(/adp/i);
    expect(asset.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the shipped ranking is usable as a board', () => {
  it('carries every scoring type the settings form offers', () => {
    for (const key of SCORINGS) {
      expect(Array.isArray(asset[key]), key).toBe(true);
      expect(asset[key].length).toBeGreaterThanOrEqual(300);
    }
  });

  // The board renders from the player index; an id it does not know draws a
  // nameless row, which reads as a broken board rather than as missing data.
  it('names every ranked player in the index', () => {
    for (const key of SCORINGS) {
      const unknown = asset[key].filter((id) => !index[String(id)]);
      expect(unknown, `${key} has unresolvable ids`).toEqual([]);
    }
  });

  // gradesPane reads `${scoring}_v`; a missing entry silently drops a pick from
  // a team's total and hands them a worse grade than they earned.
  it('carries a grade value for every ranked player', () => {
    for (const key of SCORINGS) {
      const missing = asset[key].filter((id) => asset[`${key}_v`]?.[String(id)] === undefined);
      expect(missing, `${key}_v is incomplete`).toEqual([]);
    }
  });

  it('ranks only positions a fantasy roster can start', () => {
    const allowed = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    for (const key of SCORINGS) {
      const bad = asset[key].filter((id) => !allowed.has(positionOf(id)));
      expect(bad, `${key} ranks an unstartable position`).toEqual([]);
    }
  });

  // ⚠️ THE REGRESSION THAT MAKES A BOARD LOOK BROKEN. Quarterbacks outscore
  // everyone, so any ordering that falls back to raw projected points puts a
  // wall of them in round one — nine of the top fifteen, measured. A real PPR
  // board opens with running backs and receivers.
  it('does not open with a wall of quarterbacks', () => {
    const firstRound = asset.ppr.slice(0, 12).map(positionOf);
    expect(firstRound.filter((p) => p === 'QB').length).toBeLessThanOrEqual(1);
    expect(firstRound.every((p) => ['RB', 'WR', 'TE', 'QB'].includes(p))).toBe(true);
  });

  // ⚠️ NO "contains a rookie" TEST HERE, deliberately. The obvious one — assert
  // this year's rookies are present — was written and then removed: it passed
  // against the stale 2025 asset too, because that season's rookies had a real
  // 2025 line and were already in it. A test that cannot fail for the reason it
  // names is worse than no test, because it reads like cover. Staleness is
  // caught by the season assertion above, which was verified against the actual
  // shipped 2025 file.
});

describe('rankingFor', () => {
  it('returns the list for the scoring type asked for', () => {
    setRanking({ ppr: ['1'], half: ['2'], std: ['3'] });
    expect(rankingFor('half')).toEqual(['2']);
    expect(rankingFor('STD')).toEqual(['3']);
  });

  // A league with an unusual scoring name should still get a board.
  it('falls back to PPR rather than to nothing', () => {
    setRanking({ ppr: ['1'], half: [], std: [] });
    expect(rankingFor('dynasty-superflex')).toEqual(['1']);
    expect(rankingFor('half')).toEqual(['1']);
  });

  it('is empty rather than throwing when nothing is loaded', () => {
    expect(rankingFor('ppr')).toEqual([]);
    expect(getRanking()).toBe(null);
  });
});
