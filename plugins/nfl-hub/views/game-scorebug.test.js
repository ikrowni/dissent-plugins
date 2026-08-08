// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHero, wpSplit } from './game-scorebug.js';

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

const g = {
  id: '9', state: 'in', period: 3, clock: '7:42', redZone: false,
  down: 2, distance: 6, downDistanceText: '2nd & 6 at PHI 38',
  possessionAbbr: 'DAL', timeslot: 'Sunday Night Football', venue: 'Lincoln Financial Field',
  broadcast: 'NBC',
  home: { abbr: 'PHI', fullName: 'Philadelphia Eagles', score: 17, record: '0-0',
    logo: 'nfl-hub/assets/logos/phi.png', primary: '#06424d' },
  away: { abbr: 'DAL', fullName: 'Dallas Cowboys', score: 24, record: '0-0',
    logo: 'nfl-hub/assets/logos/dal.png', primary: '#002a5c' },
};

describe('wpSplit', () => {
  it('returns the home share and rounds it', () => {
    expect(wpSplit([{ homePct: 67.6, awayPct: 32.4 }])).toEqual({ home: 68, away: 32 });
  });
  it('uses the LAST sample, since the series is oldest-first', () => {
    expect(wpSplit([{ homePct: 10, awayPct: 90 }, { homePct: 80, awayPct: 20 }]))
      .toEqual({ home: 80, away: 20 });
  });
  it('returns null with no samples, so the bar can be omitted', () => {
    expect(wpSplit([])).toBeNull();
    expect(wpSplit(null)).toBeNull();
  });
});

describe('renderHero', () => {
  it('paints both team colours into the duotone halves', () => {
    const el = parse(renderHero(g));
    const halves = el.querySelectorAll('.hero-half');
    expect(halves).toHaveLength(2);
    expect(halves[0].getAttribute('style')).toContain('#002a5c'); // away on the left
    expect(halves[1].getAttribute('style')).toContain('#06424d');
  });

  it('renders both scores with the trailing side dimmed', () => {
    const el = parse(renderHero(g));
    const scores = el.querySelectorAll('.hero-score');
    expect(scores[0].textContent).toBe('24');
    expect(scores[1].textContent).toBe('17');
    expect(scores[1].classList.contains('trail')).toBe(true);
    expect(scores[0].classList.contains('trail')).toBe(false);
  });

  it('dims neither score before kickoff', () => {
    const el = parse(renderHero({ ...g, state: 'pre' }));
    for (const s of el.querySelectorAll('.hero-score')) {
      expect(s.classList.contains('trail')).toBe(false);
    }
  });

  it('tags scores for the flip animation', () => {
    const el = parse(renderHero(g));
    expect(el.querySelector('[data-score="away"]')).not.toBeNull();
    expect(el.querySelector('[data-score="home"]')).not.toBeNull();
  });

  it('shows the clock and down-and-distance while live', () => {
    const el = parse(renderHero(g));
    expect(el.querySelector('.hero-q').textContent).toBe('Q3 · 7:42');
    expect(el.querySelector('.hero-pos').textContent).toContain('2nd & 6');
    expect(el.querySelector('.hero-pos').textContent).toContain('DAL');
  });

  it('omits the possession pill before kickoff', () => {
    const el = parse(renderHero({ ...g, state: 'pre', down: null, possessionAbbr: null }));
    expect(el.querySelector('.hero-pos')).toBeNull();
  });

  it('says Final rather than a clock once the game is over', () => {
    const el = parse(renderHero({ ...g, state: 'post', period: null, clock: null }));
    expect(el.querySelector('.hero-q').textContent).toBe('Final');
  });

  it('includes the sweep only when motion is allowed', () => {
    expect(parse(renderHero(g)).querySelector('.sweep')).not.toBeNull();
    expect(parse(renderHero(g, { motion: false })).querySelector('.sweep')).toBeNull();
  });

  it('renders the win-probability bar only when samples exist', () => {
    expect(parse(renderHero(g, { winProb: [{ homePct: 60, awayPct: 40 }] }))
      .querySelector('.hero-wp')).not.toBeNull();
    expect(parse(renderHero(g)).querySelector('.hero-wp')).toBeNull();
  });

  it('sizes the win-probability bar from the latest sample', () => {
    const el = parse(renderHero(g, { winProb: [{ homePct: 60, awayPct: 40 }] }));
    const [away, home] = el.querySelectorAll('.hero-wp .bar i');
    expect(away.getAttribute('style')).toContain('40%');
    expect(home.getAttribute('style')).toContain('60%');
  });

  it('uses local logos everywhere, never espncdn', () => {
    const el = parse(renderHero(g));
    const imgs = [...el.querySelectorAll('img')];
    expect(imgs.length).toBe(4); // two watermarks + two team logos
    for (const img of imgs) expect(img.getAttribute('src')).not.toContain('espncdn');
  });

  it('renders rotation dots when given siblings', () => {
    const el = parse(renderHero(g, { siblings: [{ id: '9' }, { id: '10' }] }));
    const dots = el.querySelectorAll('.hero-dots button');
    expect(dots).toHaveLength(2);
    expect(dots[0].getAttribute('aria-current')).toBe('true');
    expect(dots[1].dataset.game).toBe('10');
    expect(dots[1].dataset.act).toBe('hero-dot');
  });

  it('omits dots for a single game', () => {
    expect(parse(renderHero(g, { siblings: [{ id: '9' }] })).querySelector('.hero-dots')).toBeNull();
  });

  it('returns empty string for no game rather than an empty hero', () => {
    expect(renderHero(null)).toBe('');
  });

  it('escapes hostile venue and broadcast strings', () => {
    const el = parse(renderHero({ ...g, venue: '<script>x</script>', broadcast: '<b>y</b>' }));
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('.hero-banner b')).toBeNull();
  });

  it('survives a game missing a side rather than throwing', () => {
    expect(() => renderHero({ ...g, home: null })).not.toThrow();
  });
});
