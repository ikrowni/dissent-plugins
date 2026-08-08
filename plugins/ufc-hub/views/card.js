// views/card.js — the fight card, grouped by segment.
//
// Render-only: takes an already-parsed event and returns an HTML string. No fetching, no
// state, no DOM nodes.
import { esc, panel, stateMsg, badge } from '../core/ui.js';
import { cardSegments } from '../core/ufc-cloudfront.js';
import { fmtRecord, fmtDateTime } from '../core/format.js';

function corner(f, side, fight) {
  if (!f) return '<div class="corner"><span class="fname">TBD</span></div>';
  // Only a completed fight has an outcome, so an upcoming card never marks a winner.
  const won = Boolean(fight.result) && f.outcome === 'Win';
  return `<div class="corner corner-${esc(side)}${won ? ' is-win' : ''}">`
    + `<button class="fname" data-act="fighter" data-fighter="${esc(f.fighterId ?? '')}">`
      + `${esc(f.name)}</button>`
    + (f.nickName ? `<span class="fnick">“${esc(f.nickName)}”</span>` : '')
    + `<span class="frec">${esc(fmtRecord(f.record))}</span>`
    + '</div>';
}

export function fightRow(fight, event) {
  const live = event?.liveFightId && event.liveFightId === fight.fightId;
  const r = fight.result;
  const outcome = r
    ? `<div class="fresult">${esc(r.method ?? '')}`
      + (r.endingRound ? ` · <b>R${esc(r.endingRound)}</b>` : '')
      + (r.endingTime ? ` ${esc(r.endingTime)}` : '')
      + (r.fightOfTheNight ? ' <span class="fotn">FOTN</span>' : '')
      + '</div>'
    : '';

  return `<div class="fight-row${live ? ' is-live' : ''}" data-fight="${esc(fight.fightId ?? '')}">`
    + `<div class="fmeta"><span class="fwc">${esc(fight.weightClass ?? '')}</span>`
      + (live ? badge('in') : '')
    + '</div>'
    + '<div class="fcorners">'
      + corner(fight.red, 'red', fight)
      + '<span class="fvs">vs</span>'
      + corner(fight.blue, 'blue', fight)
    + '</div>'
    + outcome
    + (fight.referee ? `<div class="fref">Referee ${esc(fight.referee)}</div>` : '')
    + '</div>';
}

export function renderPanel(s) {
  const event = s?.event;
  if (!event) return stateMsg('No event selected.');
  if (!event.fights?.length) return stateMsg('No fights on this card yet.');

  const segs = cardSegments(event.fights);
  const body = segs.map((seg) => (
    `<section class="seg"><div class="seg-head"><h3>${esc(seg.label)}</h3>`
    + (seg.broadcaster ? `<span class="seg-bc">${esc(seg.broadcaster)}</span>` : '')
    + (seg.startTime ? `<span class="seg-time">${esc(fmtDateTime(seg.startTime))}</span>` : '')
    + '</div>'
    + seg.fights.map((f) => fightRow(f, event)).join('')
    + '</section>'
  )).join('');

  // Location is { City, State, Country, TriCode, VenueId, Venue } — measured 2026-08-08.
  const where = event.location?.Venue ?? event.location?.City ?? '';
  return panel({
    title: event.name,
    right: `<span class="kicker">${esc(where)}</span>`,
    body,
  });
}
