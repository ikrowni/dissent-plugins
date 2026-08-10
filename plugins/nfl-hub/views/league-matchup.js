// views/league-matchup.js — head-to-head for the week.
//
// ⚠️ THE PAIRINGS ARE DERIVED ON THE CLIENT, and that is a temporary shape worth
// naming. The module does not generate or store a schedule yet, so this calls the
// SAME pure `generateRegularSeason` the server would — deterministic from the
// team list, so both halves agree by construction.
//
// It stops being safe the moment a schedule is persisted or a commissioner can
// edit one: two sources of truth for "who plays whom" is exactly the kind of
// disagreement nobody notices until a playoff seed is wrong. When a schedule op
// lands, this must read it rather than recompute it.

import { esc, panel, stateMsg } from '../core/ui.js';
import { getScores } from '../core/league-api.js';
import { generateRegularSeason } from '../core/league/schedule.js';
import { loadIndex, playerLabel } from '../core/player-index.js';
import { describe } from './league-home.js';

const state = {
  leagueId: null,
  league: null,
  week: null,
  scores: null,
  loaded: false,
  error: null,
  expanded: null, // teamId whose lineup is open
};

export function reset() {
  Object.assign(state, {
    leagueId: null, league: null, week: null, scores: null,
    loaded: false, error: null, expanded: null,
  });
}

/**
 * The week's pairings.
 *
 * Team order comes from the league's own team map, which is insertion-ordered by
 * join. That is stable for a given league, which is what makes the derivation
 * reproducible.
 */
export function pairingsFor(league, week) {
  const teamIds = Object.keys(league?.teams ?? {});
  if (teamIds.length < 2 || !week) return [];
  const startWeek = league?.settings?.startWeek ?? 1;
  const playoffStart = league?.settings?.playoffWeekStart ?? 15;
  const weeks = Math.max(1, playoffStart - startWeek);
  const schedule = generateRegularSeason(teamIds, weeks, { startWeek });
  return schedule.find((w) => w.week === Number(week))?.matchups ?? [];
}

export function render() {
  if (state.error) {
    return panel({
      title: 'Matchups',
      body: `<p class="muted">${esc(state.error)}</p>
             <button class="btn" data-act="matchup-retry">Try again</button>`,
    });
  }
  if (!state.loaded) return stateMsg('Loading matchups…', { spinner: true });
  if (!state.week) {
    return panel({
      title: 'Matchups',
      body: '<p class="muted">The season has not started. A commissioner sets the current week.</p>',
    });
  }

  const pairs = pairingsFor(state.league, state.week);
  if (pairs.length === 0) {
    return panel({ title: 'Matchups', body: '<p class="muted">Not enough teams for a matchup yet.</p>' });
  }

  return panel({
    title: 'Matchups',
    right: `<span class="muted">Week ${esc(String(state.week))}</span>`,
    body: pairs.map((m) => matchupCard(m)).join(''),
  });
}

function matchupCard(m) {
  // A bye is a real outcome in an odd league, not an error — say so rather than
  // rendering half a card.
  if (m.bye || !m.away) {
    return `<div class="matchup bye">
      <div class="side">${esc(teamName(m.home))} <span class="muted">— bye</span></div>
    </div>`;
  }

  const home = teamScore(m.home);
  const away = teamScore(m.away);
  const decided = home !== null && away !== null;
  const homeWins = decided && home > away;
  const awayWins = decided && away > home;

  return `<div class="matchup">
    ${side(m.home, home, homeWins)}
    <div class="vs">vs</div>
    ${side(m.away, away, awayWins)}
  </div>
  ${state.expanded === m.home ? lineupTable(m.home) : ''}
  ${state.expanded === m.away ? lineupTable(m.away) : ''}`;
}

function side(teamId, points, winning) {
  return `<button class="side ${winning ? 'winning' : ''}" data-act="matchup-expand" data-team="${esc(teamId)}">
    <span class="team">${esc(teamName(teamId))}${isMine(teamId) ? ' <span class="muted">(you)</span>' : ''}</span>
    <span class="pts">${points === null ? '—' : points.toFixed(2)}</span>
  </button>`;
}

function lineupTable(teamId) {
  const rows = state.scores?.teams?.[teamId]?.rows ?? [];
  if (rows.length === 0) {
    return '<p class="muted">No lineup scored for this team yet.</p>';
  }
  return `<table class="tbl lineup-detail">
    <tbody>${rows.map((r) => `
      <tr>
        <td class="slot">${esc(r.slot)}</td>
        <td>${r.playerId ? esc(playerLabel(r.playerId)) : '<span class="muted">empty</span>'}</td>
        <td class="num">${Number(r.points ?? 0).toFixed(2)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

function teamScore(teamId) {
  const t = state.scores?.teams?.[String(teamId)];
  return t ? Number(t.total ?? 0) : null;
}

function teamName(teamId) {
  return state.league?.teams?.[String(teamId)]?.name ?? String(teamId);
}

function isMine(teamId) {
  return (state.league?.myTeams ?? []).includes(String(teamId));
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function load(app, { leagueId, league, week }) {
  Object.assign(state, { leagueId, league, week, loaded: false, error: null });
  app?.router?.refresh();
  try {
    await loadIndex();
    // Scores are optional: a week that has not been scored yet shows dashes
    // rather than an error, because "not scored yet" is a normal state.
    state.scores = week
      ? await getScores(leagueId, league?.season, week).catch(() => null)
      : null;
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.loaded = true;
    app?.router?.refresh();
  }
}

/** Toggle one team's lineup open. */
export function expand(app, teamId) {
  state.expanded = state.expanded === String(teamId) ? null : String(teamId);
  app?.router?.refresh();
}

export { state as _state };
