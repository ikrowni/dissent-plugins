// @vitest-environment jsdom
// ^ rl-sidebar-main touches window at import time.
// The members list and the leaderboard used to read EVERY member's full stats on every open —
// ~8 reads per mount, and the hub, the sidebar and the overlay mount often enough to pass the
// node's 120/min read limit (429s, 2026-10-01). One summary key replaces those reads, so it
// must answer exactly what the full stats answered for those two views.
import { describe, it, expect } from 'vitest';
import { summarize, withSummaries, SUMMARY_MAX_BYTES } from './rl-stats-summary.js';
import { getMemberRankInfo } from '../rl-sidebar/rl-sidebar-main.js';

const full = {
  currentSeason: 36,
  seasonLabels: { 35: 'Season 21', 36: 'Season 22' },
  seasons: {
    35: { playlists: { 13: { mmr: 900, rankName: 'Diamond II', division: 'Div I', iconSrc: 'old.png' } } },
    36: {
      playlists: {
        11: { mmr: 700, rankName: 'Platinum III', division: 'Div II', iconSrc: 'p3.png', matches: 41, winStreak: 2 },
        13: { mmr: 1010, rankName: 'Champion I', division: '', iconSrc: 'c1.png', matches: 300 },
      },
      rewardLevel: 'Gold', history: Array.from({ length: 50 }, (_, i) => ({ day: i, mmr: 900 + i })),
    },
  },
  profile: { avatar: 'x', bio: 'long text' },
};

describe('summarize', () => {
  it('keeps the current season and only what the lists render', () => {
    expect(summarize(full)).toEqual({
      currentSeason: 36,
      seasonLabels: { 36: 'Season 22' },
      seasons: { 36: { playlists: {
        11: { mmr: 700, rankName: 'Platinum III', division: 'Div II', iconSrc: 'p3.png' },
        13: { mmr: 1010, rankName: 'Champion I', division: '', iconSrc: 'c1.png' },
      } } },
    });
  });

  it('gives the sidebar the same rank, live or not, as the full stats do', () => {
    expect(getMemberRankInfo(summarize(full), null)).toEqual(getMemberRankInfo(full, null));
    const live = { mode: '1v1 Duel' };
    expect(getMemberRankInfo(summarize(full), live)).toEqual(getMemberRankInfo(full, live));
  });

  it('is much smaller than what it replaces', () => {
    expect(JSON.stringify(summarize(full)).length).toBeLessThan(JSON.stringify(full).length / 3);
  });

  it('survives data with no season', () => {
    expect(summarize(null)).toBeNull();
    expect(summarize({ seasons: {} })).toBeNull();
  });
});

describe('withSummaries', () => {
  const at = '2026-10-01T02:00:00.000Z';

  it('adds and replaces entries, keyed like the per-member stats', () => {
    const before = { 'rl:stats:epic:a': { fetchedAt: 'old', data: { currentSeason: 1, seasons: {} } } };
    const out = withSummaries(before, [['rl:stats:epic:b', { fetchedAt: at, data: full }]]);
    expect(Object.keys(out)).toEqual(['rl:stats:epic:a', 'rl:stats:epic:b']);
    expect(out['rl:stats:epic:b']).toEqual({ fetchedAt: at, data: summarize(full) });
    expect(before['rl:stats:epic:b']).toBeUndefined(); // the input is not mutated
  });

  it('returns null rather than a value the node would refuse (64 KB per value)', () => {
    const many = Array.from({ length: 400 }, (_, i) => [`rl:stats:epic:p${i}`, { fetchedAt: at, data: full }]);
    expect(withSummaries({}, many)).toBeNull();
    expect(SUMMARY_MAX_BYTES).toBeLessThan(64 * 1024);
  });
});
