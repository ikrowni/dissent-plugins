import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderPanel } from './news.js';
import { parseNews } from '../core/ufc-news.js';

const articles = parseNews(JSON.parse(readFileSync(
  new URL('../tests/fixtures/espn-news.json', import.meta.url), 'utf8')));

const html = (over = {}) => renderPanel({ articles, ...over });

describe('renderPanel', () => {
  it('lists the feed', () => {
    expect(html().match(/class="nw-item/g).length).toBe(articles.length);
  });

  it('calls it MMA news, because that is what the endpoint returns', () => {
    // ⚠️ ESPN's ufc/news path returns the whole sport — the top article on the
    // measured day was about the PFL. Labelling it "UFC news" would be untrue.
    expect(html()).toContain('Latest MMA news');
  });

  it('lifts card articles above the rest and does not repeat them', () => {
    const card = [articles[3]];
    const out = renderPanel({ articles, cardArticles: card, eventName: 'UFC 330' });
    expect(out).toContain('UFC 330');
    // ⚠️ "Mentions", never "About": the match is a category tag, and a rankings
    // round-up carries a dozen of them without being about the fight.
    expect(out).toContain('Mentions fighters on this card');
    expect(out.indexOf(articles[3].headline)).toBeLessThan(out.indexOf('Latest MMA news'));
    // once in the card section, not again in the feed below
    expect(out.split(articles[3].headline).length - 1).toBe(1);
  });

  it('names WHICH fighter an article matched, so the claim is checkable', () => {
    const target = articles.find((a) => a.athleteIds.length);
    const names = { [target.athleteIds[0]]: 'Makhachev' };
    const out = renderPanel({ articles, cardArticles: [target], names });
    expect(out).toContain('Makhachev');
    expect(out).toContain('nw-who');
  });

  it('explains an empty card section instead of rendering a blank', () => {
    // ⚠️ Empty is the normal case: only 2 of 8 August cards had any matching article.
    const out = renderPanel({ articles, cardArticles: [] });
    expect(out).toContain('Nothing written about these fighters yet');
  });

  it('opens links safely in a new tab', () => {
    const out = html();
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('renders an unlinked article as text, not as a dead link', () => {
    const out = renderPanel({ articles: [{ ...articles[0], link: null }] });
    expect(out).toContain('is-flat');
    expect(out).not.toContain('<a class="nw-item"');
  });

  it('badges a paywalled article', () => {
    const out = renderPanel({ articles: [{ ...articles[0], premium: true }] });
    expect(out).toContain('ESPN+');
  });

  it('routes the thumbnail through the image proxy', () => {
    const out = html();
    expect(out).toContain('/api/v1/plugins/image?url=');
    expect(out).not.toContain('src="https://a.espncdn.com');
  });

  it('escapes a hostile headline', () => {
    const out = renderPanel({ articles: [{ ...articles[0], headline: '<img src=x onerror=1>' }] });
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });

  it('shows an empty feed and a loading state without throwing', () => {
    expect(renderPanel({ articles: [] })).toContain('No news right now');
    expect(renderPanel({ loading: true })).toContain('spinner');
    expect(() => renderPanel(null)).not.toThrow();
  });
});
