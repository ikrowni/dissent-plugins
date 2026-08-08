// views/versus.js — the expanded fight: hero, tale of the tape, and whichever of the
// three state blocks applies.
//
// Render-only. Takes a parsed fight, its event, and the ESPN athlete join; returns an
// HTML string. No fetching, no DOM, no state.
import { esc } from '../core/ui.js';
import { fmtRecord, fmtHeight, fmtReach, fmtPlace } from '../core/format.js';
import { headshotUrl } from '../core/espn-athletes.js';
import {
  fightState, hasResult, liveClock, roundProgress, roundsFromRuleSet,
} from '../core/fight-state.js';
import { renderPbp } from './pbp.js';
import { parseTracking, actionCounts } from '../core/fight-timeline.js';
import { imageUrl } from '../../plugin-sdk.js';

/** Images MUST go through the proxy: the plugin CSP forbids third-party img origins. */
/** Images MUST go through the node proxy: the plugin CSP is
 *  `img-src data: blob: {asset} {core}` and blocks third-party hosts outright.
 *
 *  ⚠️ There is NO `window.Dissent` in this plugin's world — plugin-sdk.js is an ES
 *  module and `imageUrl` is one of its exports. An earlier version of this file
 *  probed `globalThis.Dissent?.imageUrl`, found nothing, and fell through to the raw
 *  espncdn URL, which the CSP then blocked: every headshot and flag rendered empty in
 *  production while the tests stayed green, because they asserted on the raw URL
 *  substring that survives in both forms. */

function nameplate(f, side, meta) {
  if (!f) return '';
  const flag = meta?.flag
    ? `<img class="vs-flag" src="${esc(imageUrl(meta.flag))}" alt="${esc(meta.country ?? '')}">`
    : '';
  return `<div class="vs-name vs-${esc(side)}">`
    + `<span class="vs-first">${esc(f.firstName ?? '')}</span>`
    + `<span class="vs-last">${esc(f.lastName ?? f.name ?? 'TBD')}</span>`
    + `<span class="vs-rec">${flag}<span class="num">${esc(fmtRecord(f.record))}</span></span>`
    + '</div>';
}

function cutout(f, side, meta) {
  const url = headshotUrl(meta?.espnId);
  if (!url) return '';
  return `<img class="vs-cut vs-cut-${esc(side)}" src="${esc(imageUrl(url))}" alt="">`;
}

function hero(fight, red, blue, event, athletes) {
  const mr = athletes?.get(red?.fighterId);
  const mb = athletes?.get(blue?.fighterId);
  return '<div class="vs-hero"><div class="vs-seam"></div>'
    + cutout(red, 'red', mr) + cutout(blue, 'blue', mb)
    + '<div class="vs-floor"></div>'
    + '<div class="vs-plate">'
      + `<span class="vs-event">${esc(event?.name ?? '')}</span>`
      + '<span class="vs-vs">VS</span>'
      + `<span class="vs-wc">${esc(fight.weightClass ?? '')}</span>`
      + `<span class="vs-rules">${esc(fight.ruleSet ?? '')}</span>`
    + '</div>'
    + nameplate(red, 'red', mr) + nameplate(blue, 'blue', mb)
    + '</div>';
}

/**
 * One row of the tale of the tape.
 *
 * ⚠️ THE BAR IS PROPORTIONAL TO THE VALUE, FROM ZERO. Do not "improve" it by
 * stretching the range.
 *
 * The first version floored the shorter bar at 55% and gave the longer one 100%, on
 * the theory that a zero-based bar could not show a few inches of reach. It could not
 * — but the cure was worse: 71" against 75" is a 5% difference and it drew one bar at
 * half and the other full, which reads as nearly double. The owner caught it on sight.
 * A chart that exaggerates to be readable is not readable, it is wrong.
 *
 * So the bars are honest and therefore nearly equal — which is the truth about two
 * fighters in the same division — and the ADVANTAGE CHIP carries the precision. The
 * chip is the thing a reader actually wants: not "how long is 75 inches" but "who is
 * longer, and by how much".
 */
const inchDelta = (n) => `+${Number.isInteger(n) ? n : n.toFixed(1)}"`;

export function tapeRow(label, a, b, fmt, deltaFmt = inchDelta) {
  const av = Number(a) || 0;
  const bv = Number(b) || 0;
  const hi = Math.max(av, bv);
  const width = (v) => (hi > 0 ? (v / hi) * 100 : 0);
  const diff = Math.abs(av - bv);
  const chip = diff > 0 ? `<span class="vs-adv">${esc(deltaFmt(diff))}</span>` : '';

  const side = (cls, val, v, lead) => '<div class="vs-side vs-' + cls + '">'
    + `<span class="vs-val num">${esc(fmt(val))}</span>`
    + `<span class="vs-bar${lead ? ' is-lead' : ''}">`
      + `<i style="width:${width(v).toFixed(1)}%"></i></span>`
    + (lead ? chip : '')
    + '</div>';

  return '<div class="vs-row">'
    + side('red', a, av, av > bv)
    + `<div class="vs-label">${esc(label)}</div>`
    + side('blue', b, bv, bv > av)
    + '</div>';
}

function textRow(label, a, b) {
  return '<div class="vs-row is-text">'
    + `<div class="vs-side vs-red"><span class="vs-val">${esc(a || '—')}</span></div>`
    + `<div class="vs-label">${esc(label)}</div>`
    + `<div class="vs-side vs-blue"><span class="vs-val">${esc(b || '—')}</span></div>`
    + '</div>';
}

/**
 * Only height and reach get bars. Age is not an advantage — a longer bar for "older"
 * reads as better — and both fighters make the same weight by definition, so those are
 * text rows.
 */
function tape(red, blue) {
  if (!red || !blue) return '';
  return '<div class="vs-tape"><h4>Tale of the tape</h4>'
    + tapeRow('Height', red.height, blue.height, fmtHeight)
    + tapeRow('Reach', red.reach, blue.reach, fmtReach)
    + textRow('Age', red.age, blue.age)
    + textRow('Stance', red.stance, blue.stance)
    + textRow('Weigh-in', red.weighIn ? `${red.weighIn} lb` : '',
                          blue.weighIn ? `${blue.weighIn} lb` : '')
    + textRow('Fighting out of', fmtPlace(red.fightingOutOf), fmtPlace(blue.fightingOutOf))
    + '</div>';
}

function chips(fight) {
  const bits = [
    ['Referee', fight.referee], ['Broadcast', fight.broadcaster],
    ['Format', fight.ruleSet], ['Division', fight.weightClass],
  ].filter(([, v]) => v);
  if (!bits.length) return '';
  return `<div class="vs-chips">${bits.map(([k, v]) => (
    `<span class="vs-chip"><span class="k">${esc(k)}</span><b>${esc(v)}</b></span>`
  )).join('')}</div>`;
}

/** Per-fighter tracked-action table, centre-anchored like the tape. */
function counts(events, red, blue) {
  const c = actionCounts(events);
  const r = c[red?.fighterId];
  const b = c[blue?.fighterId];
  if (!r && !b) return '';
  const zero = { takedowns: 0, takedownAttempts: 0, knockdowns: 0,
    submissionAttempts: 0, reversals: 0 };
  const R = r ?? zero;
  const B = b ?? zero;
  // takedownAttempts counts ATTEMPTS ONLY, so "landed of total" adds the two.
  const rows = [
    ['Takedowns', `${R.takedowns}/${R.takedowns + R.takedownAttempts}`,
                  `${B.takedowns}/${B.takedowns + B.takedownAttempts}`],
    ['Knockdowns', R.knockdowns, B.knockdowns],
    ['Submission attempts', R.submissionAttempts, B.submissionAttempts],
    ['Reversals', R.reversals, B.reversals],
  ];
  return '<div class="vs-counts">'
    + '<div class="vs-crow is-head">'
      + `<span class="n">${esc(red?.lastName ?? '')}</span>`
      + '<span class="k">Tracked actions</span>'
      + `<span class="n">${esc(blue?.lastName ?? '')}</span>`
    + '</div>'
    + rows.map(([k, a, b2]) => (
      `<div class="vs-crow"><span class="n num">${esc(a)}</span>`
      + `<span class="k">${esc(k)}</span>`
      + `<span class="n num">${esc(b2)}</span></div>`
    )).join('')
    + '<p class="vs-note">Tracked actions from the event feed — not official '
    + 'statistics. No strike data exists in any source this plugin can reach.</p>'
    + '</div>';
}

function liveBlock(fight, event) {
  const lc = liveClock(event);
  const total = roundsFromRuleSet(fight.ruleSet);
  const strip = roundProgress(lc?.round ?? 1, total)
    .map((s) => `<i class="is-${esc(s)}"></i>`).join('');
  return '<div class="vs-livebar">'
    + '<span class="vs-pulse"></span><span class="vs-livelbl">Live</span>'
    + `<span class="vs-clock num">R${esc(lc?.round ?? '')}`
    + (lc?.clock ? `<small> · ${esc(lc.clock)}</small>` : '') + '</span>'
    + `<span class="vs-rounds">${strip}</span>`
    + '</div>';
}

function resultBlock(fight) {
  const r = fight.result;
  const winner = (fight.fighters ?? []).find((f) => f.outcome === 'Win');
  const cards = (r.scores ?? []).map((s) => {
    const by = Object.fromEntries((s.fighters ?? []).map((x) => [x.fighterId, x.score]));
    const a = by[fight.red?.fighterId];
    const b = by[fight.blue?.fighterId];
    return '<div class="vs-card">'
      + `<span class="j">${esc(s.judge)}</span>`
      + `<span class="sc"><b class="${a > b ? 'hi' : 'lo'}">${esc(a ?? '—')}</b>`
      + `<i>–</i><b class="${b > a ? 'hi' : 'lo'}">${esc(b ?? '—')}</b></span>`
      + '</div>';
  }).join('');

  return '<div class="vs-result">'
    + '<div class="vs-banner">'
      + (winner ? `<span class="w">${esc(winner.lastName ?? winner.name)} wins</span>` : '')
      + `<span class="m"><b>${esc(r.method ?? '')}</b>`
      + (r.endingRound ? ` · R${esc(r.endingRound)}` : '')
      + (r.endingTime ? ` ${esc(r.endingTime)}` : '') + '</span>'
      + (r.fightOfTheNight ? '<span class="fotn">Fight of the night</span>' : '')
    + '</div>'
    + (cards ? `<div class="vs-cards">${cards}</div>` : '')
    + '</div>';
}

export function renderVersus(fight, event, athletes) {
  if (!fight) return '';
  const red = fight.red;
  const blue = fight.blue;
  const st = fightState(fight, event);
  const events = parseTracking(fight.tracking);
  const names = Object.fromEntries(
    (fight.fighters ?? []).map((f) => [f.fighterId, f.lastName ?? f.name]),
  );
  const corners = {};
  if (red?.fighterId != null) corners[red.fighterId] = 'red';
  if (blue?.fighterId != null) corners[blue.fighterId] = 'blue';

  return '<div class="vs">'
    + hero(fight, red, blue, event, athletes)
    + tape(red, blue)
    + chips(fight)
    + (st === 'in' ? liveBlock(fight, event) : '')
    + (st === 'post' && hasResult(fight) ? resultBlock(fight) : '')
    + counts(events, red, blue)
    + (events.length
      ? `<div class="vs-pbp">${renderPbp(events, names, {
          corners,
          newestFirst: st === 'in',
          liveRound: st === 'in' ? liveClock(event)?.round : undefined,
        })}</div>`
      : '')
    + '</div>';
}
