// views/game-scorebug.js — the Stadium hero scorebug.
//
// The single most expensive surface in the plugin, and the one the whole cinematic
// direction rests on. Everything here is painted once per render; the only moving
// parts are the CSS sweep (omitted from the markup entirely under reduce-motion, so
// it cannot composite at all) and the width transition on the win-probability bar.
import { esc } from '../core/ui.js';
import { fmtClock, ordinalDown, fmtPct } from '../core/format.js';
import { motion } from '../core/motion.js';

/** Latest win-probability split. The series is oldest-first, so take the last. */
export function wpSplit(winProb) {
  const last = (winProb ?? []).at(-1);
  if (!last) return null;
  return { home: Math.round(last.homePct), away: Math.round(last.awayPct) };
}

/**
 * Whose win probability is that?
 *
 * ⚠️ THE BAR USED TO READ "WIN PROBABILITY · 100%" AND NAME NOBODY. It printed
 * `max(home, away)` with no team beside it, so on the one screen where the number
 * matters most a reader could not tell whether the favourite was the side leading
 * on the scoreboard or the other one. Measured live on CAR 33 · ARI 30: the whole
 * strip's text content was exactly `Win probability100%`.
 *
 * ⚠️ A DEAD HEAT HAS NO LEADER. Printing one team at 50% would invent a favourite
 * out of a coin flip, so an exact tie says `Even` and names neither.
 */
export function wpLead(split, teams) {
  if (!split) return null;
  if (split.home === split.away) return { label: 'Even', pct: split.home, abbr: null };
  const homeAhead = split.home > split.away;
  return {
    abbr: (homeAhead ? teams?.home?.abbr : teams?.away?.abbr) ?? null,
    pct: homeAhead ? split.home : split.away,
    label: null,
  };
}

function half(side, which) {
  const c = side?.primary ?? '#12161f';
  const dir = which === 'l' ? '105deg' : '255deg';
  const fade = which === 'l' ? 'rgba(0,16,48,.25)' : 'rgba(48,0,8,.25)';
  return `<div class="hero-half ${which}" `
    + `style="background:linear-gradient(${dir},${esc(c)} 0%,${fade} 82%)"></div>`;
}

function side(s, label) {
  return '<div class="hero-side">'
    + `<img src="${esc(s?.logo)}" alt="${esc(s?.fullName ?? label)}">`
    + `<div class="abbr">${esc(s?.abbr ?? label)}</div>`
    + (s?.record ? `<div class="rec">${esc(s.record)}</div>` : '')
    + '</div>';
}

export function renderHero(game, {
  winProb = null,
  siblings = null,
  // Named `motion` by the caller; aliased because the imported motion module is
  // already in scope here.
  motion: motionOverride = null,
  /**
   * ⚠️ IS THIS THE FIRST PAINT, or a poll landing on a surface already on screen?
   *
   * Both callers of this hero re-render on a timer — Game Center every 20 s during
   * a live game, Around the League on the same cadence — and the whole hero is
   * rebuilt each time, so an entrance animation with no gate REPLAYS FOREVER.
   * Measured live before this existed: `heroLogo` on the two team crests went from
   * `finished` back to `running` on every refresh, i.e. both logos spring-scaled in
   * from 0.62 every twenty seconds for the length of a game.
   *
   * ⚠️ IT DEFAULTS TO TRUE. A caller that does not poll wants the entrance, and
   * making it opt-in would silently strip the arrival from every static use.
   */
  entrance = true,
} = {}) {
  if (!game) return '';
  const g = game;
  const allowMotion = motionOverride === null ? motion.enabled : motionOverride;

  const preGame = g.state === 'pre';
  const homeLead = (g.home?.score ?? 0) >= (g.away?.score ?? 0);
  const banner = [g.timeslot, g.broadcast, g.venue].filter(Boolean).map(esc).join(' · ');
  const wp = wpSplit(winProb);
  const lead = wpLead(wp, { home: g.home, away: g.away });

  const clockText = preGame
    ? 'Kickoff'
    : (fmtClock(g.period, g.clock) || 'Final');

  const dots = (siblings ?? []).length > 1
    ? `<div class="hero-dots">${siblings.map((s) => (
      `<button data-act="hero-dot" data-game="${esc(s.id)}"`
      + ` aria-current="${String(String(s.id) === String(g.id))}"`
      + ` aria-label="Show game ${esc(s.id)}"></button>`
    )).join('')}</div>`
    : '';

  return `<div class="hero${entrance ? ' is-first' : ''}">`
    + half(g.away, 'l') + half(g.home, 'r')
    + `<img class="hero-mark l" src="${esc(g.away?.logo)}" alt="" aria-hidden="true">`
    + `<img class="hero-mark r" src="${esc(g.home?.logo)}" alt="" aria-hidden="true">`
    + '<div class="hero-lights"></div><div class="hero-seam"></div>'
    + (allowMotion ? '<div class="sweep"></div>' : '')
    + '<div class="hero-fg">'
      + (banner ? `<div class="hero-banner">${banner}</div>` : '')
      + '<div class="hero-row">'
        + side(g.away, 'AWAY')
        + '<div class="hero-mid">'
          + `<div class="hero-q">${esc(clockText)}</div>`
          + '<div class="hero-scores">'
            + `<span class="hero-score num${!preGame && homeLead ? ' trail' : ''}"`
              + ` data-score="away">${esc(g.away?.score ?? 0)}</span>`
            + `<span class="hero-score num${!preGame && !homeLead ? ' trail' : ''}"`
              + ` data-score="home">${esc(g.home?.score ?? 0)}</span>`
          + '</div>'
          + (g.down && g.possessionAbbr
            ? `<div class="hero-pos">${esc(ordinalDown(g.down, g.distance))}`
              + ` · ${esc(g.possessionAbbr)} ball</div>`
            : '')
        + '</div>'
        + side(g.home, 'HOME')
      + '</div>'
    + '</div>'
    + dots
    + (wp
      ? '<div class="hero-wp"><span class="lbl">Win probability</span>'
        + '<span class="bar">'
          + `<i style="width:${wp.away}%;background:${esc(g.away?.primary ?? '#888')}"></i>`
          + `<i style="width:${wp.home}%;background:${esc(g.home?.primary ?? '#555')}"></i>`
        + '</span>'
        + '<span class="pct num">'
          + (lead?.abbr ? `<b>${esc(lead.abbr)}</b> ` : '')
          + `${esc(lead?.label ?? fmtPct(lead?.pct ?? 0))}</span></div>`
      : '')
    + '</div>';
}
