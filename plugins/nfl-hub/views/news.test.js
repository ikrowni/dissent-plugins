// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNews, parseOdds } from '../core/espn-league.js';
import { renderNews, oddsRow, oddsLine } from './news.js';
import { fmtAgo } from '../core/format.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const articles = parseNews(JSON.parse(readFileSync(join(FIXTURES, 'news.json'), 'utf8')));
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

const game = {
  id: '1', state: 'pre', startsAt: '2025-09-07T17:00Z',
  home: { abbr: 'PHI', logo: 'assets/logos/phi.png' },
  away: { abbr: 'DAL', logo: 'assets/logos/dal.png' },
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

  // Asserts the intent rather than the old `.news-item` class: every article still
  // renders, one of them as the lead and the rest as the list.
  it('renders every article from the real fixture, one of them as the lead', () => {
    const el = parse(renderNews({ articles }));
    expect(articles.length).toBeGreaterThan(5);
    expect(el.querySelectorAll('.wr-lead').length).toBe(1);
    expect(el.querySelectorAll('.wr-item').length).toBe(articles.length - 1);
  });

  // ⚠️ TWENTY-FIVE IDENTICAL ROWS IS NOT A FEED. Measured live in August, twenty
  // of the twenty-five were one syndicated template with the same blurb, so the
  // single piece of real news looked exactly like the rest of it.
  it('gives the lead a headline the list does not get', () => {
    const el = parse(renderNews({ articles }));
    expect(el.querySelector('.wr-lead .wr-lead-head').textContent).toBe(articles[0].headline);
    expect(el.querySelector('.wr-lead .wr-lead-blurb')).not.toBeNull();
    // The list carries no blurbs — that room is what makes the lead a lead.
    expect(el.querySelectorAll('.wr-list .wr-lead-blurb').length).toBe(0);
  });

  it('survives a feed of exactly one story without rendering an empty list', () => {
    const el = parse(renderNews({ articles: [articles[0]] }));
    expect(el.querySelectorAll('.wr-lead').length).toBe(1);
    expect(el.querySelectorAll('.wr-list').length).toBe(0);
  });

  // ⚠️ parseNews HAS ALWAYS CARRIED `published` AND THE VIEW DISCARDED IT. With
  // twenty headlines sharing one template, recency is the only thing separating
  // them, and there was nothing on screen to say whether the top one broke ten
  // minutes or ten days ago.
  it('timestamps every story', () => {
    const now = Date.parse('2026-08-12T00:30:00Z');
    const el = parse(renderNews({
      articles: [
        { headline: 'a', published: '2026-08-12T00:21:12Z', byline: 'Brady Henderson' },
        { headline: 'b', published: '2026-08-09T00:00:00Z' },
      ],
    }, now));
    const metas = [...el.querySelectorAll('.wr-meta')].map((m) => m.textContent);
    expect(metas[0]).toBe('8m ago · Brady Henderson');
    expect(metas[1]).toBe('3d ago');
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

  it('stands the lines on a stage once games are present', () => {
    const el = parse(renderNews({ articles, games: [game], odds: {} }));
    const stage = el.querySelector('.stage.wr-stage');
    expect(stage).not.toBeNull();
    expect(stage.textContent).toMatch(/the week's lines/i);
    expect(stage.querySelectorAll('.wr-odds').length).toBe(1);
    // ⚠️ The wire stays OFF the stage. A feed reads better quiet.
    expect(stage.querySelectorAll('.wr-item, .wr-lead').length).toBe(0);
  });

  it('omits the board entirely when there are no games', () => {
    const el = parse(renderNews({ articles, games: [] }));
    expect(el.querySelector('.wr-stage')).toBeNull();
    expect(el.querySelectorAll('.wr-odds').length).toBe(0);
  });

  // ⚠️ THIS VIEW REPAINTS ONCE PER GAME as the odds land — up to sixteen renders
  // in a burst. An ungated entrance would restart on every one of them.
  it('marks the first paint as an arrival and withholds it afterwards', () => {
    const on = parse(renderNews({ articles, games: [game], settled: false }));
    expect(on.querySelector('.wr-stage').classList.contains('is-first')).toBe(true);
    expect(on.querySelector('.wr-wire').classList.contains('is-first')).toBe(true);
    const off = parse(renderNews({ articles, games: [game], settled: true }));
    expect(off.querySelector('.wr-stage').classList.contains('is-first')).toBe(false);
    expect(off.querySelector('.wr-wire').classList.contains('is-first')).toBe(false);
    // The gate costs the board nothing but motion.
    expect(off.querySelectorAll('.wr-odds').length).toBe(on.querySelectorAll('.wr-odds').length);
  });

  // ⚠️ AND THE OTHER HALF: the row that just gained odds flashes, so a board
  // filling in one row at a time tells you which one moved.
  it('flashes only the row whose odds just landed', () => {
    const g2 = { ...game, id: '2' };
    const el = parse(renderNews({
      articles, games: [game, g2], settled: true, fresh: '2', odds: {},
    }));
    const rows = el.querySelectorAll('.wr-odds');
    expect(rows[0].classList.contains('is-new')).toBe(false);
    expect(rows[1].classList.contains('is-new')).toBe(true);
  });

  it('renders an empty headline state rather than a bare panel', () => {
    expect(parse(renderNews({ articles: [], games: [] })).textContent).toMatch(/no headlines/i);
  });

});

describe('oddsLine — whose line is it', () => {
  const teams = { home: { abbr: 'PHI' }, away: { abbr: 'DAL' } };

  // ⚠️ THE BUG. Measured live on the Hall of Fame game, ESPN's payload was
  // `spread: 1.5, details: "CAR -1.5", awayTeamOdds.favorite: true` — Carolina
  // favoured by a point and a half — and the board rendered fmtSpread(1.5) =
  // "+1.5" in a column headed "Spread" beside a cell naming both teams. The
  // INVERSE of how that line is quoted anywhere else, attached to neither club.
  it('names the favourite and quotes the line against them', () => {
    expect(oddsLine({ spread: -7.5 }, teams)).toEqual({ abbr: 'PHI', text: '-7.5' });
    expect(oddsLine({ spread: 1.5 }, teams)).toEqual({ abbr: 'DAL', text: '-1.5' });
  });

  // ⚠️ A PICK'EM HAS NO FAVOURITE. Naming one invents the whole line.
  it('says PK and names nobody at zero', () => {
    expect(oddsLine({ spread: 0 }, teams)).toEqual({ abbr: null, text: 'PK' });
  });

  it('says nothing at all rather than guessing when there is no spread', () => {
    expect(oddsLine(null, teams)).toBeNull();
    expect(oddsLine({ spread: null }, teams)).toBeNull();
    expect(oddsLine({ spread: undefined }, teams)).toBeNull();
    expect(oddsLine({ spread: 'n/a' }, teams)).toBeNull();
  });

  it('survives a team with no abbreviation rather than printing undefined', () => {
    expect(oddsLine({ spread: -3 }, {})).toEqual({ abbr: null, text: '-3' });
  });

  // ⚠️ THE GUARD THAT MATTERS: our derived line must equal ESPN's OWN formatting.
  // Checked against the real fixture, whose game is DAL at PHI.
  it('agrees with ESPN’s own `details` string on the real payload', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'odds-dalphi.json'), 'utf8'));
    const o = parseOdds(raw);
    const line = oddsLine(o, teams);
    expect(`${line.abbr} ${line.text}`).toBe(o.details);
  });

  // ⚠️ THE SIGN IS THE SOURCE, NOT `homeFavorite` — that flag lives under
  // `homeTeamOdds`, so a payload missing that object yields `false`, which is
  // indistinguishable from "the away team is favoured". They must still agree on
  // real data, and if they ever stop, somebody should look.
  it('agrees with the payload’s own favourite flag', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'odds-dalphi.json'), 'utf8'));
    const o = parseOdds(raw);
    expect(oddsLine(o, teams).abbr).toBe(o.homeFavorite ? 'PHI' : 'DAL');
  });
});

describe('fmtAgo', () => {
  const now = Date.parse('2026-08-12T00:30:00Z');
  it('shortens as it ages', () => {
    expect(fmtAgo('2026-08-12T00:29:30Z', now)).toBe('just now');
    expect(fmtAgo('2026-08-12T00:21:12Z', now)).toBe('8m ago');
    expect(fmtAgo('2026-08-11T20:30:00Z', now)).toBe('4h ago');
    expect(fmtAgo('2026-08-09T00:30:00Z', now)).toBe('3d ago');
  });

  it('falls back to a date past a week, rather than "31d ago"', () => {
    expect(fmtAgo('2026-07-01T00:00:00Z', now)).toMatch(/Jul/);
  });

  // ⚠️ CLOCK SKEW IS NORMAL AND SMALL. "-3m ago" makes the whole column look
  // broken over a few seconds of drift between a viewer and ESPN's publisher.
  it('never renders negative time', () => {
    expect(fmtAgo('2026-08-12T00:33:00Z', now)).toBe('just now');
  });

  it('says nothing for a missing or unparseable timestamp', () => {
    expect(fmtAgo(null, now)).toBe('');
    expect(fmtAgo('', now)).toBe('');
    expect(fmtAgo('not a date', now)).toBe('');
  });
});
