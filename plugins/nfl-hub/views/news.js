// views/news.js — headlines plus the week's odds board.
//
// The odds board is the only surface in the hub that costs one fetch per game: neither
// the scoreboard nor the cdn.espn.com variant carries inline odds (checked both, for
// completed and upcoming weeks, 2026-08-08). 16 requests of ~12 KB behind a 10-minute
// TTL is about 1.6 req/min, and it only happens when the user opens this view — which is
// exactly why it is not on a landing surface.
import { chip, panel, stateMsg, esc, errorPane} from '../core/ui.js';
import { fmtSpread, fmtMoneyline } from '../core/format.js';
import { cache, TTL } from '../core/cache.js';
import { urls, fetchNews, fetchScoreboard, fetchOdds } from '../core/espn-client.js';
import { parseNews, parseOdds } from '../core/espn-league.js';
import { parseScoreboard } from '../core/espn-game.js';
import { imageUrl } from '../../plugin-sdk.js';

const state = { loading: true, error: null, articles: [], games: [], odds: {} };

function newsItem(a) {
  const img = a.image
    ? `<img src="${esc(imageUrl(a.image))}" alt="" loading="lazy"`
      + ' style="width:96px;height:60px;object-fit:cover;border-radius:6px;flex:0 0 auto">'
    : '';
  const inner = `${img}<span><span style="font-weight:600">${esc(a.headline)}</span>`
    + (a.blurb
      ? `<br><span style="color:var(--text-3);font-size:12px">${esc(a.blurb)}</span>`
      : '')
    + '</span>';
  const body = a.link
    ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer"`
      + ` style="display:flex;gap:12px;color:inherit;text-decoration:none">${inner}</a>`
    : `<div style="display:flex;gap:12px">${inner}</div>`;
  return '<div class="news-item" style="padding:10px 0;border-bottom:1px solid var(--line)">'
    + `${body}</div>`;
}

export function oddsRow(g, o) {
  const dash = '—';
  return '<tr>'
    + `<td>${chip(g.away, { clickable: true, showRecord: false })} `
      + `${chip(g.home, { clickable: true, showRecord: false })}</td>`
    + `<td class="num">${esc(o ? fmtSpread(o.spread) : dash)}</td>`
    + `<td class="num">${esc(o?.total ?? dash)}</td>`
    + `<td class="num">${esc(o ? fmtMoneyline(o.awayMoneyline) : dash)}</td>`
    + `<td class="num">${esc(o ? fmtMoneyline(o.homeMoneyline) : dash)}</td>`
    + `<td class="num">${esc(o?.provider ?? dash)}</td>`
    + '</tr>';
}

export function renderNews(s = state) {
  if (s.loading) return stateMsg('Loading news…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load news.');

  let html = '';
  if (s.games?.length) {
    html += panel({
      title: 'Odds board',
      flush: true,
      body: '<table class="grid"><thead><tr><th>Game</th><th>Spread</th><th>Total</th>'
        + '<th>Away ML</th><th>Home ML</th><th>Book</th></tr></thead><tbody>'
        + s.games.map((g) => oddsRow(g, s.odds?.[g.id] ?? null)).join('')
        + '</tbody></table>',
    });
  }
  html += panel({
    title: 'Around the NFL',
    body: s.articles?.length
      ? s.articles.map(newsItem).join('')
      : stateMsg('No headlines right now.'),
  });
  return html;
}

export function render() { return renderNews(state); }

export async function enter() {
  const { app } = await import('../core/app.js');
  app.onAction = (act, el) => {
    if (act === 'team') { app.teamAbbr = el.dataset.team; app.router.go('team'); }
  };

  try {
    const [newsRaw, sbRaw] = await Promise.all([
      cache.get(urls.news(25), () => fetchNews(25), TTL.NEWS, { staleOnError: true })
        .catch(() => ({ articles: [] })),
      cache.get(urls.scoreboard({}), () => fetchScoreboard({}), TTL.SCOREBOARD_IDLE,
        { staleOnError: true }).catch(() => ({ events: [] })),
    ]);
    state.articles = parseNews(newsRaw);
    state.games = parseScoreboard(sbRaw).games;
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  } finally {
    state.loading = false;
  }
  app.router.refresh();

  // Odds fill in progressively — one request per game, each failing independently, so a
  // single missing line costs one row rather than the board.
  for (const g of state.games) {
    cache.get(urls.odds(g.id), () => fetchOdds(g.id), TTL.ODDS, { staleOnError: true })
      .then((raw) => {
        state.odds[g.id] = parseOdds(raw);
        if (app.router.current === 'news') app.router.refresh();
      })
      .catch(() => {});
  }
}
