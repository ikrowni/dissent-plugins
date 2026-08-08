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

const proxied = (url) => (
  url && typeof globalThis.Dissent?.imageUrl === 'function'
    ? globalThis.Dissent.imageUrl(url) : url
);

function corner(f, side, fight, athletes) {
  if (!f) return '<div class="corner"><span class="fname">TBD</span></div>';
  // Only a decided fight has an outcome, so an upcoming card never marks a winner.
  const decided = hasResult(fight);
  const won = decided && f.outcome === 'Win';
  const lost = decided && Boolean(f.outcome) && f.outcome !== 'Win';
  const meta = athletes?.get(f.fighterId);
  const url = headshotUrl(meta?.espnId);
  const mug = url
    ? `<span class="mug"><img src="${esc(proxied(url))}" alt="" loading="lazy"></span>`
    : '<span class="mug is-empty"></span>';
  const flag = meta?.flag
    ? `<img class="flag" src="${esc(proxied(meta.flag))}" alt="${esc(meta.country ?? '')}">`
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

export function fightRow(fight, event, athletes, openFight) {
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
    + outcome
    + '<span class="chev"></span>'
    + `<div class="fbody">${open ? renderVersus(fight, event, athletes) : ''}</div>`
    + '</div>';
}

export function renderPanel(s) {
  const event = s?.event;
  if (!event) return stateMsg('No event selected.');
  if (!event.fights?.length) return stateMsg('No fights on this card yet.');

  const athletes = s.athletes ?? new Map();
  const segs = cardSegments(event.fights);
  const body = segs.map((seg) => (
    `<section class="seg"><div class="seg-head"><h3>${esc(seg.label)}</h3>`
    + (seg.broadcaster ? `<span class="seg-bc">${esc(seg.broadcaster)}</span>` : '')
    + (seg.startTime ? `<span class="seg-time">${esc(fmtDateTime(seg.startTime))}</span>` : '')
    + '</div>'
    + seg.fights.map((f) => fightRow(f, event, athletes, s.openFight)).join('')
    + '</section>'
  )).join('');

  // Location is { City, State, Country, TriCode, VenueId, Venue } — measured 2026-08-08.
  const where = event.location?.Venue ?? event.location?.City ?? '';
  return panel({ title: event.name, right: `<span class="kicker">${esc(where)}</span>`, body });
}
