// core/player-visuals.js — how a fantasy player is pictured, everywhere.
//
// One module so the draft board, the roster, the waiver wire and a matchup all
// name and picture a player identically. A player who looks like two different
// people across two tabs is a bug nobody files and everybody notices.
//
// ⚠️ A HEADSHOT IS STILL A BONUS, NOT THE DESIGN. It used to be far worse —
// Sleeper carries an ESPN id for only ~23% of active players, so a headshot-first
// layout was broken for four in five. build-player-index.mjs now fills the gaps
// from ESPN's own rosters and coverage is ~95%, but the remaining 5% are real
// people who will appear on real rosters.
//
// So the reliable visual stays the one EVERY active player has: their team, as a
// colour and a logo, plus a monogram. The portrait upgrades it when it exists and
// nothing shifts when it does not — same box, same size, no layout jump. Do not
// let the good coverage tempt this into assuming a portrait exists.

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

/**
 * The positions the real world uses, folded into the buckets the scale above owns.
 *
 * ⚠️ WITHOUT THIS THE SCALE IS MISSING FROM MOST OF THE LEADERS BOARD. Measured
 * against the live leaders payload on 2026-08-11: ten distinct positions appear
 * across the sixteen categories and `POSITION_COLORS` names only five of them, so
 * `DE`, `PK`, `S`, `CB` and `P` all fell through to the unknown grey. That left
 * kickoff yards, total points, punt yards and passes defended entirely colourless,
 * and took the colour off two thirds of sacks and of interceptions.
 *
 * ⚠️ IT IS NOT ONLY AN NFL-SIDE FIX. An IDP fantasy league lists players as DE, DT,
 * CB and S as well, so the draft board and the roster had the identical hole.
 *
 * ⚠️ FOLDING, NOT INVENTING. Every value here is a key `POSITION_COLORS` already
 * has, so nothing gains a hue the hub did not own — DL, LB and DB share one colour
 * today, and if that ever splits this table already records which is which.
 *
 * ⚠️ A PUNTER IS NOT A KICKER, and mapping `P` onto `K` says they are. It is
 * deliberate: they are the one kicking-specialists group, the pill beside the
 * colour still reads `P`, and the alternative is punt yards being the only
 * category on the board with no colour at all.
 */
export const POSITION_GROUP = Object.freeze({
  HB: 'RB', FB: 'RB',
  PK: 'K', P: 'K', LS: 'K',
  DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL',
  ILB: 'LB', OLB: 'LB', MLB: 'LB',
  CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB',
  DST: 'DEF',
});

export function positionColor(pos) {
  const p = String(pos ?? '').toUpperCase();
  // ⚠️ Unknown stays grey rather than being guessed at — an offensive lineman has
  // no bucket here and should not borrow one. Same reasoning as injuryMap().
  return POSITION_COLORS[POSITION_GROUP[p] ?? p] ?? 'var(--text-3)';
}

/** A player's team colour, lifted to stay legible on the dark surface. */
export function teamColor(abbr) {
  const t = TEAMS[normalizeAbbr(abbr ?? '')];
  return t ? legibleColor(t.primary, 0.3) : 'var(--text-3)';
}

/**
 * The hero's duotone colour for a FANTASY team.
 *
 * ⚠️ A LEAGUE TEAM HAS NO COLOUR. `server/ops-league.js` stores it as
 * `{ id, name, ownerId, coOwners }` and nothing else — so `teamColor()`, which reads
 * the NFL team table, cannot answer this. Adding a colour field is a signed-module
 * change; this derives one instead, deterministically, from the id.
 *
 * ⚠️ THE ID, NOT THE NAME. Managers rename teams mid-season, and a hero that changes
 * colour when somebody edits their name reads as a bug.
 *
 * Twelve hues, far apart, all legible on the near-black surface — the same brief as
 * POSITION_COLORS, but they must never collide with it: position colour is the
 * board's primary encoding and a team must not look like a position.
 *
 * ⚠️ TWELVE BECAUSE A STANDARD LEAGUE IS TWELVE. The draft hero shows one team at a
 * time, so a repeat there is invisible; the standings table shows every team at once.
 * At eight hues pigeonhole FORCED at least four collisions in a 12-team league.
 *
 * ⚠️ IT IS STILL NOT COLLISION-FREE, AND THE NUMBERS ARE NOT CLOSE. This is a hash,
 * not an allocator: twelve ids into twelve buckets yields about EIGHT distinct
 * colours, measured, which is exactly what the birthday paradox predicts. Roughly a
 * third of a full league shares a hue with somebody. Do not read this as an
 * identifier.
 *
 * That is accepted deliberately. Assigning by index would guarantee uniqueness, but
 * a team's colour would shift whenever the league gained or lost a team, and would
 * disagree with the draft hero's. Identity that survives a roster change is worth
 * more than distinctness here, because the team NAME is always adjacent — this is an
 * accent, not a legend. If it ever needs to be a legend, that is an allocator and it
 * belongs to the deferred full redesign, not to a parity pass.
 */
export const MANAGER_PALETTE = Object.freeze([
  '#2f6fd0', '#8b1c2b', '#1f8a70', '#7a4bb8',
  '#c1731c', '#2a7f9e', '#a3357a', '#4d6b2f',
  '#4a56c4', '#2f8a45', '#8a7a1e', '#b04a2e',
]);

/** The colourless case, stated once. */
export const NEUTRAL_DUOTONE = '#243044';

export function managerColor(teamId) {
  const id = String(teamId ?? '');
  if (!id) return NEUTRAL_DUOTONE;
  // FNV-1a, 32-bit. Cheap, well-spread, and identical in every JS engine — the
  // hero must be the same colour for every manager watching the same draft.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return MANAGER_PALETTE[h % MANAGER_PALETTE.length];
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
  // ⚠️ CLICKABLE ONLY WITH AN ESPN ID, because the player page is keyed on one.
  // A chip that looks tappable and does nothing is worse than a plain one, and
  // ~5% of active players still have no id at all.
  const open = player.e
    ? ` role="button" tabindex="0" data-act="player-open" data-espn="${esc(String(player.e))}"`
    : '';
  return `<span class="pv-chip${compact ? ' compact' : ''}${player.e ? ' pv-open' : ''}"${open}>
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
