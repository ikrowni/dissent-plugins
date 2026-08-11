import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  scoreStatLine, scoreWeek, classifyStatKey, scorableEntities, scoreBreakdown,
  PPR_SCORING, HALF_PPR_SCORING, STANDARD_SCORING, sleeperDefaultPoints,
} from './scoring.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));

// Real recorded payloads, never hand-written stubs. The stats payload is
// irregular in ways a stub would smooth over — three key namespaces, tier
// indicator fields, and dozens of stats no league scores.
const stats = fx('sleeper-stats-w14.json');
const league = fx('sleeper-league.json');
const leagueSettings = league.scoring_settings;

describe('scoreStatLine', () => {
  it('is a dot product of the stat line and the settings', () => {
    expect(scoreStatLine({ rec: 5, rec_yd: 60, rec_td: 1 }, PPR_SCORING)).toBe(17);
  });

  it('ignores stats the league does not score rather than throwing', () => {
    // The payload carries far more than any league scores. A new upstream field
    // must never break a scoring run mid-season.
    expect(scoreStatLine({ rec: 5, pass_rtg: 118.3, off_yd_per_play: 6.1 }, PPR_SCORING)).toBe(5);
  });

  it('handles the empty and malformed cases without throwing', () => {
    expect(scoreStatLine(null, PPR_SCORING)).toBe(0);
    expect(scoreStatLine({ rec: 3 }, null)).toBe(0);
    expect(scoreStatLine({ rec: 'nonsense' }, PPR_SCORING)).toBe(0);
  });

  it('applies negative weights', () => {
    expect(scoreStatLine({ pass_int: 2, fum_lost: 1 }, PPR_SCORING)).toBe(-4);
  });

  it('scores a points-allowed tier from the payload indicator, with no branching', () => {
    // A defense that allowed 10 points carries pts_allow_7_13: 1 in its line.
    expect(scoreStatLine({ pts_allow_7_13: 1, sack: 2, int: 3 }, PPR_SCORING)).toBe(12);
  });
});

// ⚠️ THE CROSS-CHECK THAT MATTERS. Every other test here asserts the engine
// against my own understanding; this one asserts it against SLEEPER'S OWN
// ARITHMETIC over a whole recorded week. If the model were wrong, hundreds of
// entities would disagree.
describe('cross-check against Sleeper’s own totals', () => {
  // pts_ppr in the global stats payload is computed under SLEEPER'S DEFAULTS.
  // The recorded league customises pts_allow_14_20 (1 vs Sleeper's 0), so the
  // oracle needs that one value put back to the default — otherwise the six
  // defenses it touches disagree, which is exactly how this was discovered.
  const defaultScoring = { ...leagueSettings, pts_allow_14_20: 0 };

  const scored = Object.entries(stats).filter(([, line]) => 'pts_ppr' in line);

  it('reproduces every scored entity in the week exactly', () => {
    expect(scored.length).toBeGreaterThan(300);
    const mismatches = scored.filter(([, line]) => {
      const mine = scoreStatLine(line, defaultScoring);
      return Math.abs(mine - Number(line.pts_ppr.toFixed(2))) > 0.011;
    });
    expect(mismatches.map(([id]) => id)).toEqual([]);
  });

  // ⚠️ This is the guard against the most tempting shortcut in the whole design:
  // reading pts_ppr straight out of the payload instead of scoring the raw stats.
  // It documents the exact size and shape of the resulting error.
  it('DIVERGES from pts_ppr under custom scoring — which is why pts_ppr must not be used', () => {
    const diverged = scored.filter(([, line]) => {
      const mine = scoreStatLine(line, leagueSettings);
      return Math.abs(mine - sleeperDefaultPoints(line)) > 0.011;
    });
    // Every divergence is a defense, and every one is off by exactly the league's
    // customised tier value. Silent, small, and confined to a handful of entities
    // — the hardest kind of scoring bug to notice in a live season.
    expect(diverged.length).toBeGreaterThan(0);
    for (const [id, line] of diverged) {
      expect(classifyStatKey(id)).toBe('defense');
      expect(scoreStatLine(line, leagueSettings) - sleeperDefaultPoints(line)).toBeCloseTo(1, 5);
    }
  });
});

describe('scoring presets', () => {
  const line = { rec: 6, rec_yd: 80, rec_td: 1 };

  it('differ only in the per-reception value', () => {
    expect(scoreStatLine(line, PPR_SCORING)).toBe(20);
    expect(scoreStatLine(line, HALF_PPR_SCORING)).toBe(17);
    expect(scoreStatLine(line, STANDARD_SCORING)).toBe(14);
  });

  it('are frozen, so one league cannot mutate another league’s scoring', () => {
    expect(() => { PPR_SCORING.rec = 99; }).toThrow();
  });
});

describe('classifyStatKey', () => {
  // ⚠️ Measured against the recorded payload, not assumed: THREE namespaces.
  it('separates players, team-offense aggregates and defenses', () => {
    expect(classifyStatKey('4046')).toBe('player');
    expect(classifyStatKey('TEAM_BUF')).toBe('team_offense');
    expect(classifyStatKey('BUF')).toBe('defense');
  });

  it('finds all three in the real payload', () => {
    const kinds = Object.keys(stats).reduce((acc, id) => {
      acc[classifyStatKey(id)] = (acc[classifyStatKey(id)] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds.player).toBeGreaterThan(1000);
    expect(kinds.team_offense).toBe(28);
    expect(kinds.defense).toBe(28);
  });

  it('excludes team-offense aggregates from the scorable set', () => {
    const ids = scorableEntities(stats);
    expect(ids.some((id) => id.startsWith('TEAM_'))).toBe(false);
    expect(ids).toContain('BUF');
  });

  // A TEAM_ row scores to a plausible ~100 points — wrong in a way that survives
  // review, which is why it is excluded by name rather than by a magnitude check.
  it('would score a team-offense row to a plausible but wrong number', () => {
    const teamPoints = scoreStatLine(stats.TEAM_BUF, PPR_SCORING);
    expect(teamPoints).toBeGreaterThan(50);
  });
});

describe('scoreWeek', () => {
  it('preserves the caller’s id space', () => {
    const out = scoreWeek({ 4046: { rec: 2 }, BUF: { sack: 3 } }, PPR_SCORING);
    expect(out).toEqual({ 4046: 2, BUF: 3 });
  });

  it('scores the whole recorded week without throwing', () => {
    const out = scoreWeek(stats, PPR_SCORING);
    expect(Object.keys(out).length).toBe(Object.keys(stats).length);
    expect(Object.values(out).every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe('scoreBreakdown', () => {
  const settings = { rec_yd: 0.1, rec: 1, rec_td: 6, rush_yd: 0.1 };

  it('returns one row per rule that fired', () => {
    expect(scoreBreakdown({ rec_yd: 265, rec: 11, rec_td: 2 }, settings)).toEqual([
      { key: 'rec_yd', stat: 265, per: 0.1, points: 26.5 },
      { key: 'rec', stat: 11, per: 1, points: 11 },
      { key: 'rec_td', stat: 2, per: 6, points: 12 },
    ]);
  });

  it('omits stat keys the league does not score', () => {
    const rows = scoreBreakdown({ rec_yd: 10, pass_rtg: 99, off_yd_per_play: 5 }, settings);
    expect(rows.map((r) => r.key)).toEqual(['rec_yd']);
  });

  it('omits rules that scored nothing', () => {
    expect(scoreBreakdown({ rec: 0, rush_yd: 0 }, settings)).toEqual([]);
  });

  it('keeps negative contributions', () => {
    const rows = scoreBreakdown({ fum_lost: 2 }, { fum_lost: -2 });
    expect(rows).toEqual([{ key: 'fum_lost', stat: 2, per: -2, points: -4 }]);
  });

  it('ignores non-finite stats', () => {
    expect(scoreBreakdown({ rec: 'x', rec_yd: null }, settings)).toEqual([]);
  });

  // ⚠️ THE GUARD THAT MATTERS: a breakdown that does not sum to the score shown
  // beside it is worse than showing no breakdown at all.
  it('sums to exactly what scoreStatLine returns', () => {
    for (const stats of [
      { rec_yd: 265, rec: 11, rec_td: 2 },
      { rush_yd: 87, rec: 4, rec_yd: 33 },
      { rec_yd: 1, rec: 1 },
    ]) {
      const total = scoreBreakdown(stats, settings).reduce((s, r) => s + r.points, 0);
      expect(Math.round(total * 100) / 100).toBe(scoreStatLine(stats, settings));
    }
  });

  it('agrees with scoreStatLine on the real PPR map', () => {
    const stats = { pass_yd: 312, pass_td: 3, pass_int: 1, rush_yd: 22, fum_lost: 1 };
    const total = scoreBreakdown(stats, PPR_SCORING).reduce((s, r) => s + r.points, 0);
    expect(Math.round(total * 100) / 100).toBe(scoreStatLine(stats, PPR_SCORING));
  });

  it('is empty without stats or settings', () => {
    expect(scoreBreakdown(null, settings)).toEqual([]);
    expect(scoreBreakdown({ rec: 1 }, null)).toEqual([]);
  });
});
