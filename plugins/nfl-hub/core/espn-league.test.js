import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseStandings, parseInjuries, parseRosterInjuries, parseNews, parseOdds, parseAthlete,
  parseLeaders, parseAthleteBio, leadersSeason} from './espn-league.js';

const fixture = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

describe('parseStandings', () => {
  it('groups the recorded level=3 payload into eight divisions of four', () => {
    const out = parseStandings(fixture('standings.json'));
    expect(Object.keys(out)).toHaveLength(8);
    for (const [division, rows] of Object.entries(out)) {
      expect(division).toMatch(/^(AFC|NFC) (East|North|South|West)$/);
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        expect(r.abbr).toMatch(/^[A-Z]{2,3}$/);
        expect(r.logo).toContain('nfl-hub/assets/logos/');
        expect(typeof r.wins).toBe('number');
        expect(typeof r.losses).toBe('number');
      }
    }
  });

  it('reads the real stat names, including the one with spaces and a period', () => {
    const out = parseStandings(fixture('standings.json'));
    const row = out['AFC East'][0];
    // divisionRecord's numeric value is 0.0; the record lives in displayValue.
    expect(row.divRecord).toMatch(/^\d+-\d+/);
    expect(row.confRecord).toMatch(/^\d+-\d+/);
    expect(row.overall).toMatch(/^\d+-\d+/);
    expect(row.streak).toMatch(/^[WL]\d+$/);
    expect(row.pct).toMatch(/^\.\d+$/);
  });

  it('orders each division by wins descending', () => {
    const rows = parseStandings(fixture('standings.json'))['AFC East'];
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].wins).toBeGreaterThanOrEqual(rows[i].wins);
    }
  });

  it('covers all 32 teams exactly once', () => {
    const all = Object.values(parseStandings(fixture('standings.json'))).flat();
    expect(all).toHaveLength(32);
    expect(new Set(all.map((r) => r.abbr)).size).toBe(32);
  });

  it('returns an empty object rather than throwing on junk', () => {
    expect(parseStandings({})).toEqual({});
    expect(parseStandings(null)).toEqual({});
  });

  it('ignores a conference-level (level=2) payload rather than mislabelling it', () => {
    const level2 = { children: [{ name: 'American Football Conference', standings: { entries: [] } }] };
    expect(parseStandings(level2)).toEqual({});
  });
});

describe('parseInjuries', () => {
  it('keys the summary injuries block by team abbreviation', () => {
    const raw = { injuries: [{
      team: { id: '21', abbreviation: 'PHI', displayName: 'Philadelphia Eagles' },
      injuries: [{
        status: 'Questionable',
        date: '2026-08-07T14:29Z',
        athlete: { id: '4870795', displayName: 'Makai Lemon',
                   position: { abbreviation: 'WR' } },
        type: { abbreviation: 'Q' },
        details: { type: 'Hamstring', location: 'Leg', returnDate: '2026-08-15' },
      }],
    }] };
    const out = parseInjuries(raw);
    expect(out.PHI).toHaveLength(1);
    expect(out.PHI[0]).toEqual({
      athleteId: 4870795,
      name: 'Makai Lemon',
      position: 'WR',
      status: 'Questionable',
      detail: 'Hamstring',
      returnDate: '2026-08-15',
    });
  });

  it('reads team from the nested object, not the entry root', () => {
    // The league-wide endpoint put abbreviation at the entry root; the summary block
    // nests it. Getting this wrong silently yields an empty map.
    const wrong = { injuries: [{ abbreviation: 'PHI', injuries: [{ status: 'Out', athlete: {} }] }] };
    expect(parseInjuries(wrong)).toEqual({});
  });

  it('parses both teams from the recorded summary fixture', () => {
    const out = parseInjuries(fixture('summary-dalphi.json'));
    expect(Object.keys(out).sort()).toEqual(['DAL', 'PHI']);
    for (const list of Object.values(out)) {
      expect(list.length).toBeGreaterThan(0);
      for (const i of list) expect(typeof i.name).toBe('string');
    }
  });

  it('returns an empty object rather than throwing on junk', () => {
    expect(parseInjuries(null)).toEqual({});
    expect(parseInjuries({})).toEqual({});
  });
});

describe('parseRosterInjuries', () => {
  it('extracts injured athletes from a team roster payload', () => {
    const out = parseRosterInjuries(fixture('team-roster-phi.json'));
    expect(Array.isArray(out)).toBe(true);
    for (const i of out) {
      expect(typeof i.name).toBe('string');
      expect(i.athleteId === null || typeof i.athleteId === 'number').toBe(true);
    }
  });

  it('returns an empty array rather than throwing on junk', () => {
    expect(parseRosterInjuries(null)).toEqual([]);
  });
});

describe('parseNews', () => {
  it('extracts headline, blurb, link and thumbnail', () => {
    const raw = { articles: [{
      headline: 'Big trade', description: 'A blurb', published: '2026-08-07T12:00Z',
      links: { web: { href: 'https://espn.com/story' } },
      images: [{ url: 'https://a.espncdn.com/photo/x.jpg' }],
    }] };
    const [a] = parseNews(raw);
    expect(a.headline).toBe('Big trade');
    expect(a.blurb).toBe('A blurb');
    expect(a.link).toBe('https://espn.com/story');
    expect(a.image).toBe('https://a.espncdn.com/photo/x.jpg');
  });

  it('survives an article with no image or link', () => {
    const [a] = parseNews({ articles: [{ headline: 'H' }] });
    expect(a.image).toBeNull();
    expect(a.link).toBeNull();
  });

  it('parses the recorded fixture', () => {
    const out = parseNews(fixture('news.json'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((a) => typeof a.headline === 'string')).toBe(true);
  });

  it('returns an empty array rather than throwing on junk', () => {
    expect(parseNews(null)).toEqual([]);
  });
});

describe('parseOdds', () => {
  it('picks the first provider and flattens spread, total and moneylines', () => {
    const raw = { items: [{
      provider: { name: 'ESPN BET' },
      details: 'PHI -1.5', overUnder: 47.5, spread: -1.5,
      homeTeamOdds: { moneyLine: -120, favorite: true },
      awayTeamOdds: { moneyLine: 100, favorite: false },
    }] };
    expect(parseOdds(raw)).toEqual({
      provider: 'ESPN BET', details: 'PHI -1.5', spread: -1.5, total: 47.5,
      homeMoneyline: -120, awayMoneyline: 100, homeFavorite: true,
    });
  });

  it('returns null when no odds are published, so the strip can hide', () => {
    expect(parseOdds({ items: [] })).toBeNull();
    expect(parseOdds({})).toBeNull();
    expect(parseOdds(null)).toBeNull();
  });

  it('parses the recorded fixture without throwing', () => {
    const o = parseOdds(fixture('odds-dalphi.json'));
    expect(o === null || typeof o.provider === 'string' || o.provider === null).toBe(true);
  });
});

describe('parseAthlete', () => {
  it('parses the recorded overview into a bio plus stats', () => {
    const a = parseAthlete(fixture('athlete-overview.json'));
    expect(a).not.toBeNull();
    expect(Array.isArray(a.seasonStats)).toBe(true);
    expect(Array.isArray(a.gameLog)).toBe(true);
    expect(Array.isArray(a.news)).toBe(true);
  });

  it('returns null for junk', () => {
    expect(parseAthlete(null)).toBeNull();
    expect(parseAthlete('nope')).toBeNull();
  });
});

describe('parseLeaders', () => {
  const raw = fixture('leaders.json');

  it('returns categories with inline athletes from the real fixture', () => {
    const out = parseLeaders(raw);
    expect(out.length).toBeGreaterThan(5);
    for (const c of out) {
      expect(typeof c.label).toBe('string');
      expect(c.leaders.length).toBeGreaterThan(0);
      for (const l of c.leaders) {
        expect(typeof l.name).toBe('string');
        expect(l.name.length).toBeGreaterThan(0);
        expect(l.athleteId === null || typeof l.athleteId === 'number').toBe(true);
      }
    }
  });

  it('keeps the display value as ESPN formatted it', () => {
    expect(typeof parseLeaders(raw)[0].leaders[0].value).toBe('string');
  });

  it('routes headshots through the combiner, never the raw path', () => {
    const all = parseLeaders(raw).flatMap((c) => c.leaders).filter((l) => l.headshot);
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) {
      expect(l.headshot).toContain('combiner');
      expect(l.headshot).not.toMatch(/^https:\/\/a\.espncdn\.com\/i\/headshots/);
    }
  });

  it('resolves a team abbreviation where one is present', () => {
    const all = parseLeaders(raw).flatMap((c) => c.leaders);
    expect(all.some((l) => l.teamAbbr !== null)).toBe(true);
  });

  it('returns an empty array rather than throwing on junk', () => {
    expect(parseLeaders(null)).toEqual([]);
    expect(parseLeaders({})).toEqual([]);
  });
});

describe('parseAthleteBio', () => {
  const raw = fixture('athlete-bio.json');

  it('extracts the bio the overview endpoint lacks', () => {
    const b = parseAthleteBio(raw);
    expect(b.name).toBe('Patrick Mahomes');
    expect(b.jersey).toBe('15');
    expect(b.height).toMatch(/\d/);
    expect(b.weight).toMatch(/\d/);
    expect(typeof b.age).toBe('number');
    expect(b.college).toBe('Texas Tech');
    expect(b.position).toBe('QB');
    expect(b.teamAbbr).toBe('KC');
  });

  it('points the headshot through the combiner, never the raw path', () => {
    const b = parseAthleteBio(raw);
    expect(b.headshot).toContain('combiner');
    expect(b.headshot).not.toMatch(/^https:\/\/a\.espncdn\.com\/i\/headshots/);
  });

  it('returns null for junk', () => {
    expect(parseAthleteBio(null)).toBeNull();
    expect(parseAthleteBio({})).toBeNull();
  });
});

// ── Which season are the leaders FROM? ──────────────────────────────────────
//
// ⚠️ IN AUGUST THIS ENDPOINT ANSWERS WITH LAST SEASON. Measured live 2026-08-11:
// currentSeason 2026 Preseason, requestedSeason 2025 Regular Season. The tab
// rendered those finals with no year anywhere, so a reader in the 2026 preseason
// saw 2025's totals presented as the current race. parseLeaders discarded both
// fields; they are in the payload for free.
describe('leadersSeason', () => {
  const payload = (over = {}) => ({
    currentSeason: { year: 2026, type: { name: 'Preseason' } },
    requestedSeason: { year: 2025, type: { name: 'Regular Season' } },
    ...over,
  });

  it('reports the season the numbers actually came from', () => {
    expect(leadersSeason(payload())).toMatchObject({ year: 2025, name: 'Regular Season' });
  });

  it('flags that it is NOT the current season', () => {
    expect(leadersSeason(payload()).isCurrent).toBe(false);
  });

  it('flags a live season as current, so the label can stay quiet', () => {
    const live = payload({
      currentSeason: { year: 2025, type: { name: 'Regular Season' } },
    });
    expect(leadersSeason(live).isCurrent).toBe(true);
  });

  it('survives a payload with neither field rather than throwing', () => {
    expect(leadersSeason({})).toEqual({ year: null, name: null, isCurrent: true });
    expect(leadersSeason(null)).toEqual({ year: null, name: null, isCurrent: true });
  });
});
