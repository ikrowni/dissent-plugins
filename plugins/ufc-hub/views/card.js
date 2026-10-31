// views/card.js — the fight card: one collapsed row per bout, expanding into the
// versus screen.
//
// Render-only: takes an already-parsed event and returns an HTML string. No fetching,
// no state, no DOM nodes. `core/app.js` owns the open/closed state and the listener.
import { esc, panel, stateMsg } from '../core/ui.js';
import { cardSegments } from '../core/ufc-cloudfront.js';
import { fmtRecord, fmtDateTime } from '../core/format.js';
import { headshotUrl } from '../core/espn-athletes.js';
import { fightState, hasResult } from '../core/fight-state.js';
import { renderVersus } from './versus.js';
import { imageUrl } from '../../plugin-sdk.js';
import { pct, american } from '../core/polymarket.js';

/** Images MUST go through the node proxy: the plugin CSP is
 *  `img-src data: blob: {asset} {core}` and blocks third-party hosts outright.
 *
 *  ⚠️ There is NO `window.Dissent` in this plugin's world — plugin-sdk.js is an ES
 *  module and `imageUrl` is one of its exports. An earlier version of this file
 *  probed `globalThis.Dissent?.imageUrl`, found nothing, and fell through to the raw
 *  espncdn URL, which the CSP then blocked: every headshot and flag rendered empty in
 *  production while the tests stayed green, because they asserted on the raw URL
 *  substring that survives in both forms. */

function corner(f, side, fight, athletes) {
  if (!f) return '<div class="corner"><span class="fname">TBD</span></div>';
  // Only a decided fight has an outcome, so an upcoming card never marks a winner.
  const decided = hasResult(fight);
  const won = decided && f.outcome === 'Win';
  const lost = decided && Boolean(f.outcome) && f.outcome !== 'Win';
  const meta = athletes?.get(f.fighterId);
  const url = headshotUrl(meta?.espnId);
  const mug = url
    ? `<span class="mug"><img src="${esc(imageUrl(url))}" alt="" loading="lazy"></span>`
    : '<span class="mug is-empty"></span>';
  const flag = meta?.flag
    ? `<img class="flag" src="${esc(imageUrl(meta.flag))}" alt="${esc(meta.country ?? '')}">`
    : '';

  // ⚠️ The FIRST NAME IS NOT DECORATION. This card carries both Ty Miller and Juliana
  // Miller; a row showing only the last name renders two different people identically.
  return `<div class="corner corner-${esc(side)}${won ? ' is-win' : ''}${lost ? ' is-loss' : ''}">`
    + mug
    + '<span class="who">'
      + (f.firstName ? `<span class="ffirst">${esc(f.firstName)}</span>` : '')
      + `<button class="fname" data-act="fighter" data-fighter="${esc(f.fighterId ?? '')}">`
        + `${esc(f.lastName || f.name)}</button>`
      + (f.nickName ? `<span class="fnick">“${esc(f.nickName)}”</span>` : '')
      + `<span class="frec">${flag}<span class="num">${esc(fmtRecord(f.record))}</span></span>`
    + '</span>'
    + '</div>';
}

/**
 * The implied-probability bar.
 *
 * ⚠️ Polymarket does NOT price every fight — Johns vs Vazquez had no market on the
 * measured card — so this renders nothing at all rather than a 50/50 that looks like
 * data. A missing market is normal, not an error.
 */
function oddsBar(fight, odds) {
  const m = odds?.get(fight.fightId);
  if (!m) return '';
  const r = m.byFighter?.[fight.red?.fighterId];
  const b = m.byFighter?.[fight.blue?.fighterId];
  if (r == null || b == null) return '';
  const rp = pct(r);
  const bp = pct(b);
  return '<div class="fodds">'
    + `<span class="fo-side fo-red"><b class="num">${esc(rp)}%</b>`
      + `<i class="num">${esc(american(r) ?? '')}</i></span>`
    + '<span class="fo-track">'
      + `<i class="fo-red" style="width:${esc(rp)}%"></i>`
      + `<i class="fo-blue" style="width:${esc(100 - rp)}%"></i>`
    + '</span>'
    + `<span class="fo-side fo-blue"><b class="num">${esc(bp)}%</b>`
      + `<i class="num">${esc(american(b) ?? '')}</i></span>`
    + '</div>';
}

export function fightRow(fight, event, athletes, openFight, odds, artwork) {
  const st = fightState(fight, event);
  const open = openFight != null && openFight === fight.fightId;
  const r = fight.result;
  // ⚠️ hasResult, NOT `fight.result` — see core/fight-state.js. 1.0.0 tested the
  // object's existence and rendered an empty result line on every scheduled bout.
  const outcome = hasResult(fight)
    ? `<div class="fresult">${esc(r.method ?? '')}`
      + (r.endingRound ? ` · <b>R${esc(r.endingRound)}</b>` : '')
      + (r.endingTime ? ` ${esc(r.endingTime)}` : '')
      + (r.fightOfTheNight ? ' <span class="fotn">FOTN</span>' : '')
      + '</div>'
    : '';

  return `<div class="fight-row${st === 'in' ? ' is-live' : ''}"`
    + ` data-act="fight" data-fight="${esc(fight.fightId ?? '')}"`
    + ` role="button" tabindex="0" aria-expanded="${open}">`
    + '<div class="fhead">'
      + corner(fight.red, 'red', fight, athletes)
      + '<div class="fmid">'
        + `<span class="fwc">${esc(fight.weightClass ?? '')}</span>`
        + '<span class="fvs">VS</span>'
        + (st === 'in'
          ? '<span class="pill live">Live</span>'
          : `<span class="frd">${esc(String(fight.ruleSet ?? '').replace(/\s*\(.*\)/, ''))}</span>`)
      + '</div>'
      + corner(fight.blue, 'blue', fight, athletes)
    + '</div>'
    + oddsBar(fight, odds)
    + outcome
    + '<span class="chev"></span>'
    + `<div class="fbody">${open ? renderVersus(fight, event, athletes, odds?.get(fight.fightId), artwork) : ''}</div>`
    + '</div>';
}

export function renderPanel(s) {
  const event = s?.event;
  if (!event) return stateMsg('No event selected.');
  if (!event.fights?.length) return stateMsg('No fights on this card yet.');

  const athletes = s.athletes ?? new Map();
  const odds = s.odds ?? new Map();
  const artwork = s.artwork ?? null;
  const segs = cardSegments(event.fights);
  const body = segs.map((seg) => (
    `<section class="seg"><div class="seg-head"><h3>${esc(seg.label)}</h3>`
    + (seg.broadcaster ? `<span class="seg-bc">${esc(seg.broadcaster)}</span>` : '')
    + (seg.startTime ? `<span class="seg-time">${esc(fmtDateTime(seg.startTime))}</span>` : '')
    + '</div>'
    + seg.fights.map((f) => fightRow(f, event, athletes, s.openFight, odds, artwork)).join('')
    + '</section>'
  )).join('');

  // Location is { City, State, Country, TriCode, VenueId, Venue } — measured 2026-08-08.
  const where = event.location?.Venue ?? event.location?.City ?? '';
  return panel({ title: event.name, right: `<span class="kicker">${esc(where)}</span>`, body });
}
