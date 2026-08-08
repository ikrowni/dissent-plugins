// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNews } from '../core/espn-league.js';
import { renderNews, oddsRow } from './news.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const articles = parseNews(JSON.parse(readFileSync(join(FIXTURES, 'news.json'), 'utf8')));
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

const game = {
  id: '1', state: 'pre', startsAt: '2025-09-07T17:00Z',
  home: { abbr: 'PHI', logo: 'nfl-hub/assets/logos/phi.png' },
  away: { abbr: 'DAL', logo: 'nfl-hub/assets/logos/dal.png' },
};

describe('oddsRow', () => {
  it('renders spread, total and both moneylines', () => {
    const txt = parse(oddsRow(game, {
      provider: 'ESPN BET', details: 'PHI -1.5', spread: -1.5, total: 47.5,
      homeMoneyline: -120, awayMoneyline: 100, homeFavorite: true,
    })).textContent;
    expect(txt).toContain('-1.5');
    expect(txt).toContain('47.5');
    expect(txt).toContain('-120');
    expect(txt).toContain('+100');
    expect(txt).toContain('ESPN BET');
  });

  it('shows a dash per column when no odds are published, not zeros', () => {
    const txt = parse(oddsRow(game, null)).textContent;
    expect(txt).toContain('—');
    expect(txt).not.toContain('0.0');
    expect(txt).not.toContain('undefined');
  });

  it('makes both teams clickable', () => {
    const el = parse(oddsRow(game, null));
    expect(el.querySelectorAll('[data-act="team"]')).toHaveLength(2);
  });
});

describe('renderNews', () => {
  it('renders loading and error states', () => {
    expect(parse(renderNews({ loading: true })).querySelector('.spinner')).not.toBeNull();
    expect(parse(renderNews({ error: 'x' })).querySelector('[data-act="retry"]')).not.toBeNull();
  });

  it('renders one entry per article from the real fixture', () => {
    const el = parse(renderNews({ articles }));
    expect(el.querySelectorAll('.news-item').length).toBe(articles.length);
    expect(articles.length).toBeGreaterThan(5);
  });

  it('links out and escapes headlines', () => {
    const el = parse(renderNews({
      articles: [{ headline: '<script>x</script>', blurb: null, link: 'https://espn.com/a', image: null }],
    }));
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('a[href="https://espn.com/a"]')).not.toBeNull();
  });

  it('opens external links safely', () => {
    const a = parse(renderNews({
      articles: [{ headline: 'h', blurb: null, link: 'https://espn.com/a', image: null }],
    })).querySelector('a');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('routes article thumbnails through the image proxy, never raw espncdn', () => {
    const src = parse(renderNews({
      articles: [{ headline: 'h', blurb: null, link: null, image: 'https://a.espncdn.com/photo/x.jpg' }],
    })).querySelector('img')?.getAttribute('src');
    expect(src).not.toMatch(/^https:\/\/a\.espncdn\.com/);
  });

  it('renders the odds board once games are present', () => {
    const el = parse(renderNews({ articles, games: [game], odds: {} }));
    expect(el.textContent).toMatch(/odds board/i);
    expect(el.querySelectorAll('table.grid').length).toBeGreaterThanOrEqual(1);
  });

  it('omits the odds board entirely when there are no games', () => {
    expect(parse(renderNews({ articles, games: [] })).textContent).not.toMatch(/spread/i);
  });

  it('renders an empty headline state rather than a bare panel', () => {
    expect(parse(renderNews({ articles: [], games: [] })).textContent).toMatch(/no headlines/i);
  });
});
