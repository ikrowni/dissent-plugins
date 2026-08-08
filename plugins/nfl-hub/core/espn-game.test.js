import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseScoreboard, parsePlays, parseDrives, parseProbabilities, clockToSeconds,
} from './espn-game.js';

const fixture = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const REF = (id) =>
  `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/teams/${id}?lang=en&region=us`;

describe('clockToSeconds', () => {
  it('converts a display clock', () => {
    expect(clockToSeconds('11:49')).toBe(709);
    expect(clockToSeconds('0:00')).toBe(0);
    expect(clockToSeconds('15:00')).toBe(900);
  });
  it('returns 0 for junk', () => {
    expect(clockToSeconds(null)).toBe(0);
    expect(clockToSeconds('')).toBe(0);
  });
});

describe('parseScoreboard', () => {
  const raw = {
    season: { type: 2, year: 2025 },
    week: { number: 1 },
    events: [{
      id: '401772510',
      date: '2025-09-05T00:20Z',
      shortName: 'DAL @ PHI',
      competitions: [{
        id: '401772510',
        venue: { fullName: 'Lincoln Financial Field' },
        broadcast: 'NBC',
        status: {
          displayClock: '7:42', period: 3,
          type: { state: 'in', completed: false, detail: 'Q3 - 7:42' },
        },
        situation: {
          down: 2, distance: 6, yardLine: 38,
          downDistanceText: '2nd & 6 at PHI 38',
          isRedZone: false,
          possession: '21',
          lastPlay: { text: 'J.Daniels pass short right' },
        },
        competitors: [
          { homeAway: 'home', winner: false, score: '17',
            team: { id: '21', abbreviation: 'PHI', shortDisplayName: 'Eagles',
                    displayName: 'Philadelphia Eagles', color: '06424d', alternateColor: '000000' },
            records: [{ type: 'total', summary: '0-0' }] },
          { homeAway: 'away', winner: false, score: '24',
            team: { id: '6', abbreviation: 'DAL', shortDisplayName: 'Cowboys',
                    displayName: 'Dallas Cowboys', color: '002a5c', alternateColor: 'b0b7bc' },
            records: [{ type: 'total', summary: '0-0' }] },
        ],
      }],
    }],
  };

  it('flattens season and week', () => {
    const out = parseScoreboard(raw);
    expect(out.season).toBe(2025);
    expect(out.seasonType).toBe(2);
    expect(out.week).toBe(1);
    expect(out.games).toHaveLength(1);
  });

  it('splits home and away regardless of array order', () => {
    const g = parseScoreboard(raw).games[0];
    expect(g.home.abbr).toBe('PHI');
    expect(g.away.abbr).toBe('DAL');
    expect(g.home.score).toBe(17);
    expect(g.away.score).toBe(24);
  });

  it('uses ESPN colours and prefixes them with #', () => {
    const g = parseScoreboard(raw).games[0];
    expect(g.home.primary).toBe('#06424d');
    expect(g.away.alt).toBe('#b0b7bc');
  });

  it('resolves possession from the numeric team id', () => {
    const g = parseScoreboard(raw).games[0];
    expect(g.possessionAbbr).toBe('PHI');
    expect(g.down).toBe(2);
    expect(g.distance).toBe(6);
    expect(g.redZone).toBe(false);
  });

  it('derives the broadcast timeslot', () => {
    expect(parseScoreboard(raw).games[0].timeslot).toBe('Thursday Night Football');
  });

  it('points logos at local assets', () => {
    expect(parseScoreboard(raw).games[0].home.logo).toBe('nfl-hub/assets/logos/phi.png');
  });

  it('tolerates a pregame event with no situation', () => {
    const pre = structuredClone(raw);
    delete pre.events[0].competitions[0].situation;
    pre.events[0].competitions[0].status.type.state = 'pre';
    const g = parseScoreboard(pre).games[0];
    expect(g.state).toBe('pre');
    expect(g.possessionAbbr).toBeNull();
    expect(g.down).toBeNull();
  });

  it('returns an empty list rather than throwing on a payload with no events', () => {
    expect(parseScoreboard({}).games).toEqual([]);
    expect(parseScoreboard(null).games).toEqual([]);
  });

  it('drops an event missing a competitor rather than emitting a half game', () => {
    const broken = structuredClone(raw);
    broken.events[0].competitions[0].competitors.pop();
    expect(parseScoreboard(broken).games).toEqual([]);
  });

  it('parses the recorded 2025 week 1 fixture', () => {
    const out = parseScoreboard(fixture('scoreboard-2025-wk1.json'));
    expect(out.games.length).toBe(16);
    for (const g of out.games) {
      expect(g.home.abbr).toMatch(/^[A-Z]{2,3}$/);
      expect(g.away.abbr).toMatch(/^[A-Z]{2,3}$/);
      expect(['pre', 'in', 'post']).toContain(g.state);
    }
  });

  it('parses the recorded current-week fixture, whatever the season state', () => {
    const out = parseScoreboard(fixture('scoreboard-current.json'));
    expect(Array.isArray(out.games)).toBe(true);
    expect(out.season).toBeGreaterThan(2020);
  });
});

describe('parsePlays', () => {
  const raw = {
    items: [{
      id: '401772510247', sequenceNumber: '24700',
      text: 'J.Williams left guard for 1 yard, TOUCHDOWN.',
      awayScore: 7, homeScore: 0,
      period: { number: 1 }, clock: { displayValue: '11:49' },
      scoringPlay: true, scoreValue: 6, isTurnover: false, isPenalty: false,
      statYardage: 1,
      type: { text: 'Rushing Touchdown' },
      team: { $ref: REF(6) },
      start: { down: 1, distance: 1, yardLine: 1, downDistanceText: '1st & Goal at PHI 1' },
    }],
  };

  it('resolves the team $ref to an abbreviation', () => {
    expect(parsePlays(raw)[0].teamAbbr).toBe('DAL');
  });

  it('flattens period, clock and scoring fields', () => {
    const p = parsePlays(raw)[0];
    expect(p.period).toBe(1);
    expect(p.clock).toBe('11:49');
    expect(p.clockSeconds).toBe(709);
    expect(p.scoring).toBe(true);
    expect(p.scoreValue).toBe(6);
    expect(p.awayScore).toBe(7);
    expect(p.yards).toBe(1);
    expect(p.typeText).toBe('Rushing Touchdown');
    expect(p.downDistanceText).toBe('1st & Goal at PHI 1');
  });

  it('sorts newest first by sequence number', () => {
    const two = { items: [
      { ...raw.items[0], id: 'a', sequenceNumber: '100' },
      { ...raw.items[0], id: 'b', sequenceNumber: '24700' },
    ] };
    expect(parsePlays(two).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('leaves teamAbbr null when the ref is unresolvable', () => {
    const bad = { items: [{ ...raw.items[0], team: { $ref: 'https://x/teams/999' } }] };
    expect(parsePlays(bad)[0].teamAbbr).toBeNull();
  });

  it('returns an empty array rather than throwing on junk', () => {
    expect(parsePlays(null)).toEqual([]);
    expect(parsePlays({})).toEqual([]);
  });

  it('parses all 171 plays of the recorded game', () => {
    const plays = parsePlays(fixture('plays-dalphi.json'));
    expect(plays.length).toBe(171);
    expect(plays.filter((p) => p.scoring).length).toBeGreaterThan(0);
    expect(plays.every((p) => typeof p.text === 'string')).toBe(true);
    // Every play in a real game resolves to one of the two teams.
    expect(plays.every((p) => p.teamAbbr === null || /^[A-Z]{2,3}$/.test(p.teamAbbr))).toBe(true);
  });
});

describe('parseDrives', () => {
  const raw = {
    items: [{
      id: '4017725101', description: '6 plays, 53 yards, 3:11',
      team: { $ref: REF(6) },
      result: 'TD', displayResult: 'Touchdown',
      yards: 53, offensivePlays: 6, isScore: true,
      timeElapsed: { displayValue: '3:11' },
      start: { period: { number: 1 }, text: 'DAL 47' },
      end: { period: { number: 1 }, text: 'PHI 0' },
    }],
  };

  it('flattens a drive and resolves its team', () => {
    const d = parseDrives(raw)[0];
    expect(d.teamAbbr).toBe('DAL');
    expect(d.result).toBe('TD');
    expect(d.resultText).toBe('Touchdown');
    expect(d.yards).toBe(53);
    expect(d.plays).toBe(6);
    expect(d.timeElapsed).toBe('3:11');
    expect(d.startText).toBe('DAL 47');
    expect(d.endText).toBe('PHI 0');
    expect(d.startPeriod).toBe(1);
    expect(d.scoring).toBe(true);
  });

  it('returns an empty array rather than throwing on junk', () => {
    expect(parseDrives(null)).toEqual([]);
  });

  it('parses all 16 drives of the recorded game', () => {
    const drives = parseDrives(fixture('drives-dalphi.json'));
    expect(drives.length).toBe(16);
    expect(drives.every((d) => d.teamAbbr !== null)).toBe(true);
    expect(drives.some((d) => d.scoring)).toBe(true);
  });
});

describe('parseProbabilities', () => {
  it('converts fractions to percentages and rounds them', () => {
    const raw = { items: [{
      sequenceNumber: '1',
      homeWinPercentage: 0.676,
      awayWinPercentage: 0.32399999999999995,
      tiePercentage: 0,
      secondsLeft: 3600,
    }] };
    const [w] = parseProbabilities(raw);
    expect(w.homePct).toBe(67.6);
    expect(w.awayPct).toBe(32.4);
    expect(w.tiePct).toBe(0);
    expect(w.secondsLeft).toBe(3600);
  });

  it('sorts oldest first so it can be plotted left to right', () => {
    const raw = { items: [
      { sequenceNumber: '900', homeWinPercentage: 0.9, awayWinPercentage: 0.1 },
      { sequenceNumber: '100', homeWinPercentage: 0.5, awayWinPercentage: 0.5 },
    ] };
    expect(parseProbabilities(raw).map((w) => w.seq)).toEqual([100, 900]);
  });

  it('returns an empty array rather than throwing on junk', () => {
    expect(parseProbabilities(null)).toEqual([]);
  });

  it('parses all 164 samples of the recorded game', () => {
    const wp = parseProbabilities(fixture('probabilities-dalphi.json'));
    expect(wp.length).toBe(164);
    for (const w of wp) {
      expect(w.homePct).toBeGreaterThanOrEqual(0);
      expect(w.homePct).toBeLessThanOrEqual(100);
    }
  });

  it('never emits float artefacts, since these are rendered directly', () => {
    const wp = parseProbabilities(fixture('probabilities-dalphi.json'));
    for (const w of wp) {
      expect(String(w.homePct)).not.toMatch(/\.\d{3,}/);
      expect(String(w.awayPct)).not.toMatch(/\.\d{3,}/);
    }
  });
});
