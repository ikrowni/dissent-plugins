// views/news.js — the week's lines, then the wire.
//
// The odds board is the only surface in the hub that costs one fetch per game: neither
// the scoreboard nor the cdn.espn.com variant carries inline odds (checked both, for
// completed and upcoming weeks, 2026-08-08). 16 requests of ~12 KB behind a 10-minute
// TTL is about 1.6 req/min, and it only happens when the user opens this view — which is
// exactly why it is not on a landing surface.
import { chip, panel, stateMsg, esc, errorPane} from '../core/ui.js';
import { fmtSpread, fmtMoneyline, fmtAgo } from '../core/format.js';
import { teamColor } from '../core/player-visuals.js';
import { cache, TTL } from '../core/cache.js';
import { urls, fetchNews, fetchScoreboard, fetchOdds } from '../core/espn-client.js';
import { parseNews, parseOdds } from '../core/espn-league.js';
import { parseScoreboard } from '../core/espn-game.js';
import { imageUrl } from '../../plugin-sdk.js';

const state = {
  loading: true, error: null, articles: [], games: [], odds: {},
  /**
   * ⚠️ THIS VIEW RE-RENDERS ONCE PER GAME. enter() fires an odds request for every
   * game and refreshes the router as each one lands, so a full week is up to
   * SIXTEEN renders in a burst of a few seconds. An ungated entrance animation
   * would restart sixteen times over.
   *
   * The first paint sets this; every render after it is an update. Same gate as
   * views/game.js, for a different reason — that one polls on a timer, this one
   * fills in.
   */
  settled: false,
  /**
   * The one game whose odds just landed, so its row can flash. Set immediately
   * before the refresh it belongs to and cleared immediately after — a render is
   * synchronous, so exactly one render ever sees it.
   */
  fresh: null,
};

/**
 * The line, WITH ITS SUBJECT.
 *
 * ⚠️ THE BOARD USED TO PRINT A SPREAD BELONGING TO NOBODY, AND WITH THE OPPOSITE
 * SIGN. Measured live on the Hall of Fame game: ESPN's payload says
 * `spread: 1.5, details: "CAR -1.5", awayTeamOdds.favorite: true` — Carolina
 * favoured by a point and a half. The board rendered `fmtSpread(1.5)` = **"+1.5"**
 * in a column headed "Spread", next to a cell naming both teams. So it showed the
 * inverse of how that line is quoted anywhere else, attached to neither club.
 *
 * ⚠️ THE SIGN IS THE SOURCE, NOT `homeFavorite`. ESPN's `spread` is home-relative:
 * negative means the home side gives points, positive means it gets them. The
 * explicit `favorite` flag looks more authoritative but is not — it lives under
 * `homeTeamOdds`, so a payload missing that object yields `homeFavorite: false`,
 * which is indistinguishable from "the away team is favoured" and would name the
 * wrong club. A missing spread just fails to parse and we say nothing.
 *
 * Verified against both directions of real data: the DAL@PHI fixture is
 * `-7.5 / homeFav / "PHI -7.5"`, the live preseason game is
 * `+1.5 / awayFav / "CAR -1.5"`.
 */
export function oddsLine(o, teams) {
  const n = Number(o?.spread);
  if (!o || o.spread === null || o.spread === undefined || !Number.isFinite(n)) return null;
  // A pick'em has no favourite; naming one would invent the whole line.
  if (n === 0) return { abbr: null, text: 'PK' };
  const abbr = (n < 0 ? teams?.home?.abbr : teams?.away?.abbr) ?? null;
  return { abbr, text: fmtSpread(-Math.abs(n)) };
}

/** One game's line. A row, not a table cell, so the favourite can own a colour. */
export function oddsRow(g, o, { fresh = false } = {}) {
  const dash = '—';
  const line = oddsLine(o, g);
  const tc = line?.abbr ? ` style="--fav:${esc(teamColor(line.abbr))}"` : '';
  return `<div class="wr-odds${fresh ? ' is-new' : ''}"${tc}>`
    + '<span class="wr-teams">'
      + `${chip(g.away, { clickable: true, showRecord: false })}`
      + '<span class="wr-at">at</span>'
      + `${chip(g.home, { clickable: true, showRecord: false })}</span>`
    // ⚠️ THE LINE IS THE HEADLINE OF THE ROW. It is what an odds board is read for,
    // and it used to be one of six equally-weighted columns.
    + '<span class="wr-line">'
      + (line
        ? `${line.abbr ? `<b>${esc(line.abbr)}</b>` : ''}<span>${esc(line.text)}</span>`
        : `<span class="wr-none">${dash}</span>`)
    + '</span>'
    + `<span class="wr-ou"><i>O/U</i>${esc(o?.total ?? dash)}</span>`
    + '<span class="wr-ml">'
      + `<span><i>${esc(g.away?.abbr ?? 'AWAY')}</i>${esc(o ? fmtMoneyline(o.awayMoneyline) : dash)}</span>`
      + `<span><i>${esc(g.home?.abbr ?? 'HOME')}</i>${esc(o ? fmtMoneyline(o.homeMoneyline) : dash)}</span>`
    + '</span>'
    + `<span class="wr-book">${esc(o?.provider ?? dash)}</span>`
    + '</div>';
}

/**
 * The lead story, given the room a lead story gets.
 *
 * ⚠️ TWENTY-FIVE IDENTICAL ROWS IS NOT A FEED. Measured live: twenty of the
 * twenty-five headlines were the same syndicated template ("2026 <club> training
 * camp: Latest intel, updates") with the same blurb, at the same weight, so the
 * one piece of real news sat in the list looking exactly like the rest of it.
 */
function leadItem(a, now) {
  const img = a.image
    ? `<img class="wr-lead-img" src="${esc(imageUrl(a.image))}" alt="" loading="lazy"`
      + ' onerror="this.remove()">'
    : '';
  const meta = [fmtAgo(a.published, now), a.byline].filter(Boolean).join(' · ');
  const inner = img
    + '<span class="wr-lead-txt">'
      + `<span class="wr-lead-head">${esc(a.headline)}</span>`
      + (a.blurb ? `<span class="wr-lead-blurb">${esc(a.blurb)}</span>` : '')
      + (meta ? `<span class="wr-meta">${esc(meta)}</span>` : '')
    + '</span>';
  return `<div class="wr-lead">${link(a, inner, 'wr-lead-a')}</div>`;
}

function newsItem(a, now) {
  const img = a.image
    ? `<img class="wr-thumb" src="${esc(imageUrl(a.image))}" alt="" loading="lazy"`
      + ' onerror="this.remove()">'
    : '';
  const meta = [fmtAgo(a.published, now), a.byline].filter(Boolean).join(' · ');
  const inner = img
    + '<span class="wr-txt">'
      + `<span class="wr-head">${esc(a.headline)}</span>`
      + (meta ? `<span class="wr-meta">${esc(meta)}</span>` : '')
    + '</span>';
  return `<div class="wr-item">${link(a, inner, 'wr-a')}</div>`;
}

/** ⚠️ `rel="noopener noreferrer"` is not optional — these open on espn.com. */
function link(a, inner, cls) {
  if (!a.link) return `<div class="${cls}">${inner}</div>`;
  return `<a class="${cls}" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">`
    + `${inner}</a>`;
}

export function renderNews(s = state, now = Date.now()) {
  if (s.loading) return stateMsg('Loading news…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load news.');

  const first = !s.settled;
  const games = s.games ?? [];
  const articles = s.articles ?? [];
  const [lead, ...rest] = articles;

  // ⚠️ THE LINES GO ON THE STAGE, THE WIRE DOES NOT. The board is the decision
  // surface — it is why somebody opens a tab called "News & Odds" with a game
  // starting — and it was the only thing here built from workhorse chrome alone.
  // The feed is for reading and reads better quiet. Same rule as every pass
  // before it.
  let html = '';
  if (games.length) {
    html += `<div class="stage wr-stage${first ? ' is-first' : ''}">`
      + '<div class="stage-head"><h3>The week\'s lines</h3>'
        + `<span class="stage-sub">${games.length} game${games.length === 1 ? '' : 's'}</span></div>`
      + `<div class="wr-board">${games
        .map((g) => oddsRow(g, s.odds?.[g.id] ?? null, { fresh: s.fresh === g.id }))
        .join('')}</div>`
      + '</div>';
  }

  html += panel({
    title: 'Around the NFL',
    right: articles.length
      ? `<span class="kicker">${articles.length} stor${articles.length === 1 ? 'y' : 'ies'}</span>`
      : '',
    body: articles.length
      ? `<div class="wr-wire${first ? ' is-first' : ''}">`
        + leadItem(lead, now)
        + (rest.length ? `<div class="wr-list">${rest.map((a) => newsItem(a, now)).join('')}</div>` : '')
        + '</div>'
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
  // ⚠️ AFTER the paint. That render is the arrival; the sixteen below are not.
  state.settled = true;

  // Odds fill in progressively — one request per game, each failing independently, so a
  // single missing line costs one row rather than the board.
  for (const g of state.games) {
    cache.get(urls.odds(g.id), () => fetchOdds(g.id), TTL.ODDS, { staleOnError: true })
      .then((raw) => {
        state.odds[g.id] = parseOdds(raw);
        if (app.router.current !== 'news') return;
        // ⚠️ SET, RENDER, CLEAR — all synchronous, so exactly one render sees it and
        // the flash lands on the row that actually changed rather than on all of
        // them. This is the "animate change, not arrival" half of the motion
        // budget; the entrance half is `settled` above.
        state.fresh = g.id;
        app.router.refresh();
        state.fresh = null;
      })
      .catch(() => {});
  }
}

export function leave() {
  // Coming back is a genuine arrival, so the board gets its entrance again.
  state.settled = false;
  state.fresh = null;
}
