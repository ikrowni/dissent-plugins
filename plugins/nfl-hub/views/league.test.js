// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseScoreboard } from '../core/espn-game.js';
import { renderLeague, pickHeroGame, gameRow } from './league.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const games = parseScoreboard(JSON.parse(
  readFileSync(join(FIXTURES, 'scoreboard-2025-wk1.json'), 'utf8'),
)).games;

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

const mk = (over = {}) => ({
  id: '1', state: 'pre', period: null, clock: null, redZone: false,
  down: null, distance: null, downDistanceText: null,
  timeslot: 'Sunday · 1:00 PM ET', startsAt: '2025-09-07T17:00Z',
  home: { abbr: 'PHI', name: 'Eagles', score: 0, record: '0-0',
    logo: 'nfl-hub/assets/logos/phi.png', primary: '#06424d' },
  away: { abbr: 'DAL', name: 'Cowboys', score: 0, record: '0-0',
    logo: 'nfl-hub/assets/logos/dal.png', primary: '#002a5c' },
  ...over,
});

describe('pickHeroGame', () => {
  it('prefers a game in the red zone over any other live game', () => {
    const chosen = pickHeroGame([
      mk({ id: 'live', state: 'in' }),
      mk({ id: 'rz', state: 'in', redZone: true }),
    ]);
    expect(chosen.id).toBe('rz');
  });

  it('prefers the closest live game when none is in the red zone', () => {
    const chosen = pickHeroGame([
      mk({ id: 'blowout', state: 'in',
        home: { ...mk().home, score: 35 }, away: { ...mk().away, score: 3 } }),
      mk({ id: 'close', state: 'in',
        home: { ...mk().home, score: 21 }, away: { ...mk().away, score: 20 } }),
    ]);
    expect(chosen.id).toBe('close');
  });

  it('falls back to the next scheduled game when nothing is live', () => {
    const chosen = pickHeroGame([
      mk({ id: 'done', state: 'post' }),
      mk({ id: 'later', state: 'pre', startsAt: '2025-09-07T20:25Z' }),
      mk({ id: 'next', state: 'pre', startsAt: '2025-09-07T17:00Z' }),
    ]);
    expect(chosen.id).toBe('next');
  });

  it('falls back to a finished game rather than returning nothing', () => {
    expect(pickHeroGame([mk({ id: 'done', state: 'post' })]).id).toBe('done');
  });

  it('returns null for an empty slate', () => {
    expect(pickHeroGame([])).toBeNull();
    expect(pickHeroGame(null)).toBeNull();
  });

  it('picks something from the real 16-game fixture', () => {
    expect(pickHeroGame(games)).not.toBeNull();
  });
});

describe('gameRow', () => {
  it('renders both teams with local logos', () => {
    const el = parse(gameRow(mk()));
    const imgs = [...el.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(imgs).toHaveLength(2);
    for (const src of imgs) expect(src).not.toContain('espncdn');
  });

  it('marks a live game so it gets the accent rail', () => {
    expect(parse(gameRow(mk({ state: 'in' }))).querySelector('.game-card.live')).not.toBeNull();
    expect(parse(gameRow(mk())).querySelector('.game-card.live')).toBeNull();
  });

  it('shows a red-zone badge only in the red zone', () => {
    expect(parse(gameRow(mk({ state: 'in', redZone: true })))
      .querySelector('.badge.redzone')).not.toBeNull();
    expect(parse(gameRow(mk({ state: 'in' }))).querySelector('.badge.redzone')).toBeNull();
  });

  it('dims the trailing score and not the leading one', () => {
    const el = parse(gameRow(mk({
      state: 'post',
      home: { ...mk().home, score: 24 }, away: { ...mk().away, score: 17 },
    })));
    const [away, home] = el.querySelectorAll('.sc');
    expect(away.classList.contains('trail')).toBe(true);
    expect(home.classList.contains('lead')).toBe(true);
  });

  it('dims neither score before kickoff', () => {
    const el = parse(gameRow(mk()));
    for (const s of el.querySelectorAll('.sc')) {
      expect(s.classList.contains('trail')).toBe(false);
      expect(s.classList.contains('lead')).toBe(false);
    }
  });

  it('carries the game id so delegation can open Game Center', () => {
    const el = parse(gameRow(mk({ id: '42' })));
    expect(el.querySelector('[data-act="game"]').dataset.game).toBe('42');
  });

  it('shows the clock while live and Final when over', () => {
    expect(parse(gameRow(mk({ state: 'in', period: 3, clock: '7:42' }))).textContent)
      .toContain('Q3');
    expect(parse(gameRow(mk({ state: 'post' }))).textContent).toContain('Final');
  });

  it('shows down and distance while live', () => {
    const el = parse(gameRow(mk({
      state: 'in', period: 2, clock: '1:00', down: 3, distance: 7,
      downDistanceText: '3rd & 7 at PHI 40',
    })));
    expect(el.textContent).toContain('3rd & 7');
  });

  it('renders every game in the real fixture without throwing', () => {
    for (const g of games) expect(() => gameRow(g)).not.toThrow();
  });
});

describe('renderLeague', () => {
  it('renders a loading state while games are absent', () => {
    expect(parse(renderLeague({ loading: true })).querySelector('.spinner')).not.toBeNull();
  });

  it('renders an error state with a retry when the fetch failed', () => {
    expect(parse(renderLeague({ error: 'offline' })).querySelector('[data-act="retry"]'))
      .not.toBeNull();
  });

  it('renders the hero plus one card per game from the real fixture', () => {
    const el = parse(renderLeague({ games, week: 1, season: 2025 }));
    expect(el.querySelector('.hero')).not.toBeNull();
    expect(el.querySelectorAll('.game-card')).toHaveLength(16);
  });

  it('groups games by broadcast timeslot', () => {
    const el = parse(renderLeague({ games, week: 1, season: 2025 }));
    const heads = [...el.querySelectorAll('.panel-head h2')].map((h) => h.textContent);
    expect(heads.length).toBeGreaterThan(1);
    expect(heads.some((h) => /Sunday|Thursday|Monday/.test(h))).toBe(true);
  });

  it('honours an explicitly chosen hero game', () => {
    const target = games[5];
    const el = parse(renderLeague({ games, heroId: target.id, week: 1, season: 2025 }));
    // The hero shows that game's abbreviations.
    expect(el.querySelector('.hero').textContent).toContain(target.home.abbr);
  });

  it('renders an empty-slate message rather than a bare hero', () => {
    const el = parse(renderLeague({ games: [], week: 1, season: 2026 }));
    expect(el.querySelector('.hero')).toBeNull();
    expect(el.textContent).toMatch(/no games/i);
  });

  it('escapes hostile content from the payload', () => {
    const el = parse(renderLeague({
      games: [mk({ timeslot: '<script>x</script>' })], week: 1, season: 2025,
    }));
    expect(el.querySelector('script')).toBeNull();
  });
});
