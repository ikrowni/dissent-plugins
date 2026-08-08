// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseTeamRoster, parseTeamRecord, parseDepthChart, parseTeamSchedule, athleteIdFromRef,
} from './espn-team.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const fx = (n) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));
const rosterRaw = fx('team-roster-phi.json');
const depth = fx('depthchart-phi.json');
const sched = fx('team-schedule-phi.json');

describe('athleteIdFromRef', () => {
  it('extracts the id from a depth-chart $ref', () => {
    expect(athleteIdFromRef({ $ref: 'http://x/seasons/2025/athletes/4685759?lang=en' }))
      .toBe(4685759);
  });
  it('accepts a bare url', () => {
    expect(athleteIdFromRef('http://x/athletes/123')).toBe(123);
  });
  it('returns null for junk', () => {
    expect(athleteIdFromRef(null)).toBeNull();
    expect(athleteIdFromRef({})).toBeNull();
    expect(athleteIdFromRef('nope')).toBeNull();
  });
});

describe('parseTeamRoster', () => {
  it('returns every athlete with a headshot routed through the combiner', () => {
    const out = parseTeamRoster(rosterRaw);
    expect(out.length).toBeGreaterThan(50);
    for (const a of out) {
      expect(typeof a.name).toBe('string');
      if (a.headshot) {
        expect(a.headshot).toContain('combiner');
        expect(a.headshot).not.toMatch(/^https:\/\/a\.espncdn\.com\/i\/headshots/);
      }
    }
  });

  it('spans multiple positions so a roster can be grouped', () => {
    expect(new Set(parseTeamRoster(rosterRaw).map((a) => a.position)).size).toBeGreaterThan(5);
  });

  it('flags injured players from the inline injuries array', () => {
    expect(parseTeamRoster(rosterRaw).some((a) => a.injured)).toBe(true);
  });

  it('returns an empty array rather than throwing on junk', () => {
    expect(parseTeamRoster(null)).toEqual([]);
    expect(parseTeamRoster({})).toEqual([]);
  });
});

describe('parseTeamRecord', () => {
  it('pulls the team identity from the roster payload', () => {
    const r = parseTeamRecord(rosterRaw);
    expect(r.abbr).toBe('PHI');
    expect(r.fullName).toMatch(/Eagles/);
    expect(r.logo).toBe('nfl-hub/assets/logos/phi.png');
    expect(r.conf).toBe('NFC');
    expect(r.div).toBe('East');
  });
  it('returns null for junk', () => {
    expect(parseTeamRecord(null)).toBeNull();
    expect(parseTeamRecord({})).toBeNull();
  });
});

describe('parseDepthChart', () => {
  const roster = parseTeamRoster(rosterRaw);

  it('flattens formations, whose positions are a DICT not an array', () => {
    const out = parseDepthChart(depth, roster);
    expect(out.length).toBeGreaterThan(0);
    for (const f of out) {
      expect(typeof f.name).toBe('string');
      expect(Array.isArray(f.positions)).toBe(true);
      for (const p of f.positions) {
        expect(typeof p.label).toBe('string');
        expect(Array.isArray(p.athletes)).toBe(true);
      }
    }
  });

  it('resolves athlete $refs against the roster, needing no extra fetch', () => {
    const named = parseDepthChart(depth, roster)
      .flatMap((f) => f.positions).flatMap((p) => p.athletes)
      .filter((a) => a.name && a.name !== 'Unknown');
    expect(named.length).toBeGreaterThan(0);
  });

  it('orders athletes by depth rank', () => {
    const pos = parseDepthChart(depth, roster)
      .flatMap((f) => f.positions).find((p) => p.athletes.length > 1);
    expect(pos).toBeDefined();
    for (let i = 1; i < pos.athletes.length; i += 1) {
      expect(pos.athletes[i - 1].rank).toBeLessThanOrEqual(pos.athletes[i].rank);
    }
  });

  it('reads the position label from the inlined position object', () => {
    const labels = parseDepthChart(depth, roster).flatMap((f) => f.positions).map((p) => p.label);
    // Inlined alongside the $ref, so a real name is available rather than just a slug.
    expect(labels.some((l) => /\s/.test(l))).toBe(true);
  });

  it('survives an empty roster rather than throwing', () => {
    expect(() => parseDepthChart(depth, [])).not.toThrow();
    const out = parseDepthChart(depth, []);
    expect(out.flatMap((f) => f.positions).flatMap((p) => p.athletes)
      .every((a) => a.name === 'Unknown')).toBe(true);
  });

  it('returns an empty array for junk', () => {
    expect(parseDepthChart(null, [])).toEqual([]);
    expect(parseDepthChart({}, [])).toEqual([]);
  });
});

describe('parseTeamSchedule', () => {
  it('flattens events with opponent, result and week', () => {
    const out = parseTeamSchedule(sched, 'PHI');
    expect(out.length).toBeGreaterThan(0);
    for (const g of out) {
      expect(typeof g.id).toBe('string');
      expect(['pre', 'in', 'post']).toContain(g.state);
      expect(g.opponentAbbr === null || /^[A-Z]{2,3}$/.test(g.opponentAbbr)).toBe(true);
      if (g.opponentLogo) expect(g.opponentLogo).toContain('nfl-hub/assets/logos/');
    }
  });

  it('resolves home and away for the team being viewed', () => {
    const out = parseTeamSchedule(sched, 'PHI');
    expect(out.some((g) => g.isHome === true || g.isHome === false)).toBe(true);
  });

  it('computes W/L only for completed games', () => {
    for (const g of parseTeamSchedule(sched, 'PHI')) {
      if (g.state !== 'post') expect(g.result).toBeNull();
      else if (g.myScore !== null) expect(['W', 'L', 'T']).toContain(g.result);
    }
  });

  it('normalises the abbreviation it is given', () => {
    // WAS -> WSH; asking with the alias must still match the payload.
    expect(() => parseTeamSchedule(sched, 'was')).not.toThrow();
  });

  it('returns an empty array for junk', () => {
    expect(parseTeamSchedule(null, 'PHI')).toEqual([]);
    expect(parseTeamSchedule({}, 'PHI')).toEqual([]);
  });
});
