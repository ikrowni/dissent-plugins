// views/league-matchup.js — head-to-head for the week.
//
// ⚠️ THE PAIRINGS COME FROM THE SERVER'S STORED SCHEDULE. They used to be derived
// here from the same pure generator, which agreed by construction — right up
// until a team joined, because the generator's input is the team list. A late
// joiner would have silently changed who played whom in weeks already played,
// and every standing computed from those results with it.
//
// So there is now ONE source of truth: `schedule:generate` freezes the team
// order into a stored record, and this view reads it. A league with no schedule
// says so rather than inventing one.

import { esc, panel, stateMsg } from '../core/ui.js';
import { getScores, getSchedule, generateSchedule } from '../core/league-api.js';
import { loadIndex, playerLabel } from '../core/player-index.js';
import { describe } from './league-home.js';

const state = {
  leagueId: null,
  league: null,
  week: null,
  scores: null,
  schedule: null,  // the stored record, or null when none has been generated
  loaded: false,
  error: null,
  busy: false,
  expanded: null,  // teamId whose lineup is open
};

export function reset() {
  Object.assign(state, {
    leagueId: null, league: null, week: null, scores: null, schedule: null,
    loaded: false, error: null, busy: false, expanded: null,
  });
}

/**
 * The week's pairings, read from the stored schedule.
 *
 * ⚠️ NEVER COMPUTED HERE. An absent schedule returns nothing and the view says
 * so — inventing pairings would put a second answer to "who plays whom" in
 * circulation, and the two only diverge once somebody joins, which is long after
 * anyone would think to look.
 */
export function pairingsFor(schedule, week) {
  if (!schedule || !week) return [];
  return (schedule.weeks ?? []).find((w) => w.week === Number(week))?.matchups ?? [];
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

  if (!state.schedule) {
    return panel({
      title: 'Matchups',
      body: `<p class="muted">No schedule has been generated for this season yet.</p>
        ${state.league?.isCommissioner
    ? `<button class="btn primary" data-act="matchup-generate" ${state.busy ? 'disabled' : ''}>
         ${state.busy ? 'Generating…' : 'Generate schedule'}
       </button>`
    : '<p class="muted">A commissioner needs to generate it.</p>'}`,
    });
  }

  const pairs = pairingsFor(state.schedule, state.week);
  if (pairs.length === 0) {
    return panel({
      title: 'Matchups',
      body: `<p class="muted">Week ${esc(String(state.week))} is not in the schedule
             (weeks ${esc(String(state.schedule.startWeek))}–${esc(String(state.schedule.startWeek + (state.schedule.weeks?.length ?? 0) - 1))}).</p>`,
    });
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
    // Both are optional: a season with no schedule, and a week nobody has
    // scored, are normal states rather than failures.
    state.schedule = await getSchedule(leagueId, league?.season).catch(() => null);
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

/** Commissioner: create the season's schedule. */
export async function generate(app) {
  state.busy = true;
  state.error = null;
  app?.router?.refresh();
  try {
    await generateSchedule(state.leagueId, { season: state.league?.season });
    state.schedule = await getSchedule(state.leagueId, state.league?.season);
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

/** Toggle one team's lineup open. */
export function expand(app, teamId) {
  state.expanded = state.expanded === String(teamId) ? null : String(teamId);
  app?.router?.refresh();
}

export { state as _state };
