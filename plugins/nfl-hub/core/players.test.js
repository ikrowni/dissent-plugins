import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPlayerIndex, normalizeName } from './players.js';

const REAL = JSON.parse(
  readFileSync(new URL('../assets/players.index.json', import.meta.url), 'utf8'));

describe('normalizeName', () => {
  it('casefolds and collapses whitespace', () => {
    expect(normalizeName('  Patrick   Mahomes ')).toBe('patrick mahomes');
  });

  it('strips punctuation that the two sources disagree on', () => {
    expect(normalizeName("Le'Veon Bell")).toBe('leveon bell');
    expect(normalizeName('A.J. Brown')).toBe('aj brown');
    expect(normalizeName('Amon-Ra St. Brown')).toBe('amonra st brown');
  });

  it('strips generational suffixes', () => {
    expect(normalizeName('Odell Beckham Jr.')).toBe('odell beckham');
    expect(normalizeName('Michael Pittman Jr')).toBe('michael pittman');
    expect(normalizeName('Robert Griffin III')).toBe('robert griffin');
    expect(normalizeName('Marvin Harrison Jr.')).toBe('marvin harrison');
  });

  it('returns empty string for nullish input', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('createPlayerIndex', () => {
  let idx;
  beforeEach(() => {
    idx = createPlayerIndex({
      loader: () => Promise.resolve({
        4046: { n: 'Patrick Mahomes', p: 'QB', t: 'KC', e: 3139477 },
        6794: { n: 'Justin Jefferson', p: 'WR', t: 'MIN', e: 4262921 },
        9999: { n: 'Brandon Aubrey', p: 'K', t: 'DAL', e: null },
      }),
    });
  });

  it('resolves a sleeper id to a normalised player', async () => {
    await idx.load();
    expect(idx.get('4046')).toEqual({
      sleeperId: '4046', name: 'Patrick Mahomes', position: 'QB',
      teamAbbr: 'KC', espnId: 3139477,
    });
  });

  it('loads only once even when called concurrently', async () => {
    const loader = vi.fn().mockResolvedValue({});
    const i = createPlayerIndex({ loader });
    await Promise.all([i.load(), i.load(), i.load()]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown id instead of throwing', async () => {
    await idx.load();
    expect(idx.get('nope')).toBeNull();
    expect(idx.get(null)).toBeNull();
  });

  it('normalises team abbreviations through the alias table', async () => {
    const i = createPlayerIndex({
      loader: () => Promise.resolve({ 1: { n: 'X', p: 'QB', t: 'WAS', e: 1 } }),
    });
    await i.load();
    expect(i.get('1').teamAbbr).toBe('WSH');
  });

  it('maps many ids at once, dropping unknowns', async () => {
    await idx.load();
    const out = idx.getMany(['4046', 'nope', '6794']);
    expect(out.map((p) => p.name)).toEqual(['Patrick Mahomes', 'Justin Jefferson']);
  });

  it('reports not-ready before load and ready after', async () => {
    expect(idx.isReady).toBe(false);
    await idx.load();
    expect(idx.isReady).toBe(true);
  });

  it('a failed load leaves the index empty rather than throwing to the caller', async () => {
    const i = createPlayerIndex({ loader: () => Promise.reject(new Error('offline')) });
    await expect(i.load()).resolves.toBe(false);
    expect(i.get('4046')).toBeNull();
    expect(i.isReady).toBe(false);
  });
});

describe('resolveEspnId — the join that actually has to work', () => {
  // Sleeper populates espn_id for only ~22% of active fantasy players on a team
  // (measured 2026-08-07), and the gaps include starters like Brandon Aubrey and
  // first-round picks like Omarion Hampton. So the id is a fast path, not the join.
  let idx;
  beforeEach(async () => {
    idx = createPlayerIndex({
      loader: () => Promise.resolve({
        4046: { n: 'Patrick Mahomes', p: 'QB', t: 'KC', e: 3139477 },
        9999: { n: 'Brandon Aubrey', p: 'K', t: 'DAL', e: null },
        8888: { n: 'Odell Beckham Jr.', p: 'WR', t: 'BAL', e: null },
        7777: { n: 'Nobody Here', p: 'TE', t: 'NYJ', e: null },
      }),
    });
    await idx.load();
  });

  const espnAthletes = [
    { id: '3139477', displayName: 'Patrick Mahomes', position: { abbreviation: 'QB' } },
    { id: '4361741', displayName: 'Brandon Aubrey', position: { abbreviation: 'PK' } },
    { id: '3051926', displayName: 'Odell Beckham Jr', position: { abbreviation: 'WR' } },
  ];

  it('uses espn_id directly when Sleeper has one', () => {
    expect(idx.resolveEspnId(idx.get('4046'), [])).toBe(3139477);
  });

  it('falls back to a normalised name match when espn_id is missing', () => {
    expect(idx.resolveEspnId(idx.get('9999'), espnAthletes)).toBe(4361741);
  });

  it('matches across suffix punctuation differences between the two sources', () => {
    // Sleeper says "Odell Beckham Jr.", ESPN says "Odell Beckham Jr" — no period.
    expect(idx.resolveEspnId(idx.get('8888'), espnAthletes)).toBe(3051926);
  });

  it('returns null rather than guessing when there is no match', () => {
    expect(idx.resolveEspnId(idx.get('7777'), espnAthletes)).toBeNull();
  });

  it('returns null for a nullish player', () => {
    expect(idx.resolveEspnId(null, espnAthletes)).toBeNull();
  });

  it('accepts the flattened athlete shape too, not just ESPN raw', () => {
    const flat = [{ id: 4361741, name: 'Brandon Aubrey' }];
    expect(idx.resolveEspnId(idx.get('9999'), flat)).toBe(4361741);
  });
});

describe('the committed index asset', () => {
  it('holds a plausible number of players', () => {
    expect(Object.keys(REAL).length).toBeGreaterThan(1000);
  });

  it('uses the compact single-letter field names', () => {
    const first = Object.values(REAL)[0];
    expect(Object.keys(first).sort()).toEqual(['e', 'n', 'p', 't']);
  });

  it('documents the real espn_id coverage rather than assuming it is high', () => {
    const vals = Object.values(REAL);
    const withEspn = vals.filter((p) => p.e !== null).length;
    const pct = withEspn / vals.length;
    // Measured 41% overall on 2026-08-07, and only ~22% for active fantasy players on
    // a team. This assertion exists to catch the coverage COLLAPSING (Sleeper dropping
    // the field entirely), not to assert it is good — it isn't, which is precisely why
    // resolveEspnId falls back to name matching.
    expect(pct).toBeGreaterThan(0.15);
    expect(pct).toBeLessThan(1);
  });

  it('gives every player a name and position, since those drive the fallback join', () => {
    for (const p of Object.values(REAL)) {
      expect(typeof p.n).toBe('string');
      expect(p.n.length).toBeGreaterThan(0);
      expect(typeof p.p).toBe('string');
    }
  });
});

describe('end-to-end join against a real ESPN roster', () => {
  // The highest-value test here: it exercises the actual cross-source join with real
  // data from both providers, which is the thing the fantasy features depend on.
  // Measured 2026-08-07 for PHI: 20% resolve by espn_id, 78% by name, 98% combined.
  // Without the name fallback this would be 20% and roster intelligence would be
  // useless for most of a lineup.
  const roster = JSON.parse(
    readFileSync(new URL('../tests/fixtures/team-roster-phi.json', import.meta.url), 'utf8'));

  it('resolves nearly every PHI player, and mostly not via espn_id', async () => {
    const idx = createPlayerIndex({ loader: () => Promise.resolve(REAL) });
    await idx.load();
    const athletes = roster.team.athletes;

    const phi = Object.entries(REAL)
      .filter(([, v]) => v.t === 'PHI')
      .map(([id]) => id);
    expect(phi.length).toBeGreaterThan(30);

    let viaId = 0; let viaName = 0; const unresolved = [];
    for (const id of phi) {
      const p = idx.get(id);
      if (p.espnId) { viaId += 1; continue; }
      if (idx.resolveEspnId(p, athletes)) viaName += 1;
      else unresolved.push(p);
    }

    const covered = (viaId + viaName) / phi.length;
    expect(covered).toBeGreaterThan(0.9);
    // The fallback must be doing the heavy lifting — if this inverts, either Sleeper
    // started populating espn_id again or the name matcher has silently broken.
    expect(viaName).toBeGreaterThan(viaId);

    // The only acceptable miss is the team defence, which is not an athlete.
    for (const p of unresolved) expect(p.position).toBe('DEF');
  });
});
