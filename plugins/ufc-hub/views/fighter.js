// views/fighter.js — one fighter's profile.
//
// Two sources, and the split matters:
//   CloudFront  physicals, record, stance, born, fighting out of — always present
//   ufc.com     CAREER statistics — scraped, so it may be absent, and the view must
//               render fully without it
//
// ⚠️ WORDING. These are CAREER statistics and are labelled as such. The per-fight
// counts in views/versus.js are "tracked actions" because no source carries per-fight
// strike data. Do not let either label drift onto the other view.
import { esc, stateMsg } from '../core/ui.js';
import { fmtRecord, fmtHeight, fmtReach, fmtPlace } from '../core/format.js';
import { headshotUrl } from '../core/espn-athletes.js';
import { imageUrl } from '../../plugin-sdk.js';
import { hasAthleteStats } from '../core/ufc-athlete.js';

function bio(f) {
  const rows = [
    ['Record', fmtRecord(f.record)],
    ['Age', f.age],
    ['Height', fmtHeight(f.height)],
    ['Reach', fmtReach(f.reach)],
    ['Stance', f.stance],
    ['Fighting out of', fmtPlace(f.fightingOutOf)],
    ['Born', fmtPlace(f.born)],
  ].filter(([, v]) => v != null && v !== '' && v !== '—');
  return `<div class="fp-bio">${rows.map(([k, v]) => (
    `<div class="fp-row"><span class="fp-k">${esc(k)}</span>`
    + `<span class="fp-v">${esc(v)}</span></div>`
  )).join('')}</div>`;
}

function careerStats(s) {
  if (!hasAthleteStats(s)) return '';
  const donut = (label, v) => (v == null ? ''
    : `<div class="fp-donut"><span class="fp-pct num">${esc(v)}%</span>`
      + `<span class="fp-dl">${esc(label)}</span></div>`);
  const stat = (k, v) => `<div class="fp-stat"><span class="fp-sv num">${esc(v)}</span>`
    + `<span class="fp-sk">${esc(k)}</span></div>`;
  const bar = (b) => `<div class="fp-bar"><span class="fp-bk">${esc(b.label)}</span>`
    + `<span class="fp-bv">${esc(b.value)}</span></div>`;

  return '<div class="fp-career"><h4>Career statistics</h4>'
    + '<div class="fp-donuts">'
      + donut('Striking accuracy', s.accuracy.striking)
      + donut('Takedown accuracy', s.accuracy.takedown)
    + '</div>'
    + `<div class="fp-stats">${Object.entries(s.stats).map(([k, v]) => stat(k, v)).join('')}</div>`
    + (s.position.length
      ? `<h5>Significant strikes by position</h5><div class="fp-bars">${s.position.map(bar).join('')}</div>`
      : '')
    + (s.finishes.length
      ? `<h5>How the wins came</h5><div class="fp-bars">${s.finishes.map(bar).join('')}</div>`
      : '')
    + '<p class="vs-note">Career statistics published by ufc.com.</p>'
    + '</div>';
}

export function renderFighter(fighter, athletes, opts = {}) {
  const f = fighter?.base;
  if (!f) return '';
  const meta = athletes?.get(f.fighterId);
  const url = headshotUrl(meta?.espnId);
  const flag = meta?.flag
    ? `<img class="flag" src="${esc(imageUrl(meta.flag))}" alt="${esc(meta.country ?? '')}">`
    : '';

  return '<section class="fp">'
    + '<div class="fp-head">'
      + '<button class="fp-back" data-act="close-fighter">Back to the card</button>'
      + (url ? `<span class="fp-mug"><img src="${esc(imageUrl(url))}" alt=""></span>` : '')
      + '<div class="fp-id">'
        + `<span class="fp-first">${esc(f.firstName ?? '')}</span>`
        + `<h2 class="fp-last">${esc(f.lastName ?? f.name ?? '')}</h2>`
        + (f.nickName ? `<span class="fp-nick">&ldquo;${esc(f.nickName)}&rdquo;</span>` : '')
        + `<span class="fp-rec">${flag}<span class="num">${esc(fmtRecord(f.record))}</span></span>`
      + '</div>'
    + '</div>'
    + bio(f)
    + (opts.loading
      ? stateMsg('Loading career statistics…', { spinner: true })
      : careerStats(fighter.stats))
    + '</section>';
}
