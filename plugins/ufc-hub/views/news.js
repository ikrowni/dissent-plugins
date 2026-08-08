// views/news.js — the news feed, with anything about the current card lifted to the top.
//
// ⚠️ The heading says MMA, not UFC, and that is deliberate: ESPN's "ufc/news" endpoint
// returns the whole sport. The top article on the measured day was about the PFL. See
// core/ufc-news.js.
import { esc, panel, stateMsg } from '../core/ui.js';
import { relativeTime } from '../core/ufc-news.js';
import { imageUrl } from '../../plugin-sdk.js';

function item(a, names) {
  // Naming the match is what makes the section honest — see cardAthleteNames.
  const who = (a.athleteIds ?? [])
    .map((id) => names?.[id]).filter(Boolean);
  const mentions = who.length
    ? `<span class="nw-who">${esc(who.slice(0, 3).join(', '))}</span>` : '';
  const img = a.image
    ? `<img class="nw-img" src="${esc(imageUrl(a.image))}" alt="" loading="lazy">`
    : '<span class="nw-img is-empty"></span>';

  const body = '<span class="nw-body">'
    + `<span class="nw-head">${esc(a.headline)}</span>`
    + (a.description ? `<span class="nw-desc">${esc(a.description)}</span>` : '')
    + '<span class="nw-meta">'
      + (a.published ? `<span>${esc(relativeTime(a.published))}</span>` : '')
      // Sending someone to a paywall without saying so is rude; say so.
      + (a.premium ? '<span class="nw-premium">ESPN+</span>' : '')
      + mentions
    + '</span>'
    + '</span>';

  // An article with no link is not a link. rel=noopener because target=_blank hands the
  // opened page a reference to this window otherwise.
  return a.link
    ? `<a class="nw-item" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">`
      + `${img}${body}</a>`
    : `<div class="nw-item is-flat">${img}${body}</div>`;
}

/**
 * @param s { articles, cardArticles, eventName, loading }
 */
export function renderPanel(s) {
  if (s?.loading) return panel({ title: 'News', body: stateMsg('Loading news…', { spinner: true }) });

  const all = s?.articles ?? [];
  if (!all.length) {
    return panel({ title: 'News', body: stateMsg('No news right now.') });
  }

  const card = s?.cardArticles ?? [];
  // ⚠️ Empty is the NORMAL case here, not an error. Across all of August 2026 only two
  // of eight cards had any matching article; a Fight Night had none. Say what the
  // section means so an empty one does not read as broken.
  // ⚠️ "Mentions", not "About". The match is a category tag, and a pound-for-pound
  // rankings round-up carries a dozen of them — it mentions a fighter on the card
  // without being about the fight at all. Claiming otherwise would be a small lie the
  // reader can see through immediately.
  const cardBlock = '<section class="nw-sec">'
    + `<h3>Mentions fighters on this card${s?.eventName ? `: ${esc(s.eventName)}` : ''}</h3>`
    + (card.length
      ? card.map((a) => item(a, s?.names)).join('')
      : '<p class="nw-none">Nothing written about these fighters yet. '
        + 'ESPN mostly covers headliners and champions.</p>')
    + '</section>';

  const rest = all.filter((a) => !card.includes(a));
  const restBlock = '<section class="nw-sec"><h3>Latest MMA news</h3>'
    + rest.map((a) => item(a, null)).join('')
    + '</section>';

  return panel({ title: 'News', body: cardBlock + restBlock, flush: true });
}
