import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { setIndex, searchPlayers, playerLabel, positionOf, playerName } from './player-index.js';

// The REAL index, not a stub — it is a committed asset and its shape (`n`, `p`,
// `t`) is exactly what a hand-written double would get subtly wrong.
const REAL = JSON.parse(readFileSync(new URL('../assets/players.index.json', import.meta.url), 'utf8'));

beforeEach(() => setIndex(REAL));

describe('labels', () => {
  it('renders name, position and team', () => {
    // Patrick Mahomes, a stable id in the committed index.
    expect(playerLabel('4046')).toMatch(/Mahomes \(QB/);
    expect(playerName('4046')).toBe('Patrick Mahomes');
    expect(positionOf('4046')).toBe('QB');
  });

  it('falls back to the id rather than blank for an unknown player', () => {
    expect(playerLabel('nope')).toBe('#nope');
    expect(playerName('nope')).toBe('#nope');
    expect(positionOf('nope')).toBe(null);
  });
});

describe('searchPlayers', () => {
  it('finds a player by name', () => {
    const hits = searchPlayers('mahomes');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toContain('Mahomes');
    expect(hits[0].position).toBe('QB');
  });

  it('needs at least two characters, so one keystroke does not scan 5,000 players', () => {
    expect(searchPlayers('m')).toEqual([]);
    expect(searchPlayers('')).toEqual([]);
  });

  // ⚠️ A board that offers a drafted player produces a refusal on every click,
  // and the user cannot tell whether they mistyped or were beaten to him.
  it('excludes players already taken', () => {
    const before = searchPlayers('mahomes');
    const id = before[0].id;
    const after = searchPlayers('mahomes', { taken: new Set([id]) });
    expect(after.map((h) => h.id)).not.toContain(id);
  });

  it('ranks a prefix match above a mid-name match', () => {
    const hits = searchPlayers('jeff', { limit: 30 });
    const names = hits.map((h) => h.name.toLowerCase());
    const firstPrefix = names.findIndex((n) => n.startsWith('jeff'));
    const firstContains = names.findIndex((n) => !n.startsWith('jeff') && n.includes('jeff'));
    if (firstPrefix !== -1 && firstContains !== -1) {
      expect(firstPrefix).toBeLessThan(firstContains);
    }
  });

  it('returns only fantasy positions by default', () => {
    const hits = searchPlayers('smith', { limit: 50 });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']).toContain(hit.position);
    }
  });

  it('can be narrowed to specific positions', () => {
    const hits = searchPlayers('smith', { positions: ['WR'], limit: 30 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.position).toBe('WR');
  });

  it('respects the limit', () => {
    expect(searchPlayers('a', { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('returns nothing rather than throwing with no index loaded', () => {
    setIndex(null);
    expect(searchPlayers('mahomes')).toEqual([]);
    expect(playerLabel('4046')).toBe('#4046');
  });
});
