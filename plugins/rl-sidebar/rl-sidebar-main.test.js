import { describe, it, expect } from 'vitest';
import { getMemberRankInfo } from './rl-sidebar-main.js';

const mockData = {
  currentSeason: 40,
  seasons: {
    40: {
      playlists: {
        11: { mmr: 800,  rankName: 'Gold',     division: 'I',   iconSrc: '' },
        12: { mmr: 1200, rankName: 'Diamond',  division: 'II',  iconSrc: '' },
        13: { mmr: 1024, rankName: 'Platinum', division: 'III', iconSrc: '' },
      }
    }
  }
};

describe('getMemberRankInfo', () => {
  it('returns null when data is null', () => {
    expect(getMemberRankInfo(null, null)).toBe(null);
  });

  it('returns null when data has no seasons', () => {
    expect(getMemberRankInfo({ seasons: {} }, null)).toBe(null);
  });

  it('returns Peak + highest MMR rank when offline (no liveGameState)', () => {
    const result = getMemberRankInfo(mockData, null);
    expect(result).toEqual({ label: 'Peak', sub: 'Diamond II' });
  });

  it('returns current mode rank when live in 3v3 Standard', () => {
    const result = getMemberRankInfo(mockData, { mode: '3v3 Standard' });
    expect(result).toEqual({ label: '3v3', sub: 'Platinum III' });
  });

  it('returns current mode rank when live in 2v2 Doubles', () => {
    const result = getMemberRankInfo(mockData, { mode: '2v2 Doubles' });
    expect(result).toEqual({ label: '2v2', sub: 'Diamond II' });
  });

  it('returns current mode rank when live in 1v1 Duel', () => {
    const result = getMemberRankInfo(mockData, { mode: '1v1 Duel' });
    expect(result).toEqual({ label: '1v1', sub: 'Gold I' });
  });

  it('returns null when live in unrecognised mode (e.g. Unranked)', () => {
    expect(getMemberRankInfo(mockData, { mode: 'Unranked' })).toBe(null);
  });

  it('returns null when live in known mode but playlist has no MMR', () => {
    const noRankData = {
      currentSeason: 40,
      seasons: { 40: { playlists: { 13: { mmr: null, rankName: 'Unranked', division: '', iconSrc: '' } } } }
    };
    expect(getMemberRankInfo(noRankData, { mode: '3v3 Standard' })).toBe(null);
  });

  it('omits division from sub when division is empty string', () => {
    const data = {
      currentSeason: 40,
      seasons: { 40: { playlists: { 13: { mmr: 1500, rankName: 'Grand Champion', division: '', iconSrc: '' } } } }
    };
    const result = getMemberRankInfo(data, { mode: '3v3 Standard' });
    expect(result).toEqual({ label: '3v3', sub: 'Grand Champion' });
  });
});
