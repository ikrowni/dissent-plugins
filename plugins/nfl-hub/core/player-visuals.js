// core/player-visuals.js — how a fantasy player is pictured, everywhere.
//
// One module so the draft board, the roster, the waiver wire and a matchup all
// name and picture a player identically. A player who looks like two different
// people across two tabs is a bug nobody files and everybody notices.
//
// ⚠️ A HEADSHOT IS A BONUS, NOT THE DESIGN. Only **19% of active players** carry
// an ESPN id in the index (394 of 1977, measured 2026-08-10) — the rest have no
// portrait available at any price. A headshot-first layout is therefore broken
// for four players in five, which is exactly the sort of thing that looks
// wonderful in a screenshot of Patrick Mahomes and awful in practice.
//
// So the reliable visual is the one every active player has: their TEAM, as a
// colour and a logo, plus a monogram. The portrait upgrades it when it exists
// and nothing shifts when it does not — same box, same size, no layout jump.

import { esc, legibleColor } from './ui.js';
import { TEAMS, logoPath, normalizeAbbr } from './config.js';
import { urls } from './espn-client.js';
import { imageUrl } from '../../plugin-sdk.js';

/**
 * Fantasy position colours.
 *
 * ⚠️ These are a CATEGORICAL scale, not decoration: on a draft board they are
 * the only thing that lets somebody see the shape of a roster at a glance. They
 * are deliberately far apart in hue and all legible on the near-black surface.
 */
export const POSITION_COLORS = Object.freeze({
  QB: '#f2557d',
  RB: '#3fc4a0',
  WR: '#4aa8ff',
  TE: '#f0913a',
  K: '#b98cf0',
  DEF: '#8d97ab',
  DL: '#8d97ab',
  LB: '#8d97ab',
  DB: '#8d97ab',
});

export function positionColor(pos) {
  return POSITION_COLORS[String(pos ?? '').toUpperCase()] ?? 'var(--text-3)';
}

/** A player's team colour, lifted to stay legible on the dark surface. */
export function teamColor(abbr) {
  const t = TEAMS[normalizeAbbr(abbr ?? '')];
  return t ? legibleColor(t.primary, 0.3) : 'var(--text-3)';
}

/**
 * Initials for the monogram.
 *
 * ⚠️ FIRST AND LAST, never the first two letters of a surname — "Ja'Marr Chase"
 * has to read JC, not JA, or every player from one family tree looks identical.
 */
export function initials(name) {
  const parts = String(name ?? '').replace(/[^A-Za-z' .-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * The portrait: a real headshot when one exists, a team-coloured monogram when
 * it does not.
 *
 * ⚠️ BOTH RENDER AT THE SAME SIZE so a list of players does not jump around as
 * portraits resolve. The monogram is not a placeholder waiting to be replaced —
 * for most players it IS the final state.
 *
 * ⚠️ The headshot goes through `imageUrl()` (the node's image proxy). A direct
 * espncdn load is a CSP violation AND leaks every viewer's IP to ESPN.
 */
export function avatar(player, { size = 40 } = {}) {
  const name = player?.n ?? '';
  const color = player?.t ? teamColor(player.t) : positionColor(player?.p);
  const box = `width:${size}px;height:${size}px`;

  if (player?.e) {
    return `<span class="pv-avatar" style="${box};--pv-ring:${esc(color)}">
      <img src="${esc(imageUrl(urls.headshot(player.e, size * 2)))}" alt="" loading="lazy"
           onerror="this.remove()">
      <span class="pv-mono" style="color:${esc(color)}">${esc(initials(name))}</span>
    </span>`;
  }
  return `<span class="pv-avatar pv-avatar-mono" style="${box};--pv-ring:${esc(color)}">
    <span class="pv-mono" style="color:${esc(color)}">${esc(initials(name))}</span>
  </span>`;
}

/** The small team logo that sits beside a name. Every active player has one. */
export function teamMark(abbr) {
  if (!abbr) return '<span class="pv-team pv-team-none">FA</span>';
  return `<span class="pv-team"><img src="${esc(logoPath(abbr))}" alt="" loading="lazy">`
    + `<span>${esc(normalizeAbbr(abbr))}</span></span>`;
}

/** The position pill, coloured by the categorical scale. */
export function positionPill(pos) {
  const p = String(pos ?? '').toUpperCase();
  if (!p) return '';
  return `<span class="pv-pos" style="--pv-pos:${esc(positionColor(p))}">${esc(p)}</span>`;
}

/**
 * The unit every list repeats: portrait, name, position, team.
 *
 * `player` is an index record — `{ n, p, t, e }` — not an id, so a caller that
 * already has the record does not look it up twice.
 */
export function playerChip(player, { size = 40, sub = null, compact = false } = {}) {
  if (!player) return '<span class="pv-chip pv-chip-unknown">—</span>';
  return `<span class="pv-chip${compact ? ' compact' : ''}">
    ${avatar(player, { size })}
    <span class="pv-id">
      <span class="pv-name">${esc(player.n ?? 'Unknown')}</span>
      <span class="pv-meta">${positionPill(player.p)}${teamMark(player.t)}${
  sub ? `<span class="pv-sub">${esc(sub)}</span>` : ''}</span>
    </span>
  </span>`;
}

/**
 * A bye-week or status note, when there is one worth showing.
 *
 * Kept separate from playerChip because not every surface has room, and a
 * truncated third line is worse than no third line.
 */
export function playerNote(player) {
  if (!player) return '';
  if (!player.t) return 'Free agent';
  const t = TEAMS[normalizeAbbr(player.t)];
  return t ? `${t.city} ${t.name}` : normalizeAbbr(player.t);
}
