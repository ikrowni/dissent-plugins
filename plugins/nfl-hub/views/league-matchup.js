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
import { getScores, getSchedule, generateSchedule, getPlayoffs, startPlayoffs } from '../core/league-api.js';
import { loadIndex, playerLabel } from '../core/player-index.js';
import { describe } from './league-home.js';

const state = {
  leagueId: null,
  league: null,
  week: null,
  scores: null,
  schedule: null,  // the stored record, or null when none has been generated
  bracket: null,   // the postseason, or null before it starts
  loaded: false,
  error: null,
  busy: false,
  expanded: null,  // teamId whose lineup is open
};

export function reset() {
  Object.assign(state, {
    leagueId: null, league: null, week: null, scores: null, schedule: null,
    bracket: null, loaded: false, error: null, busy: false, expanded: null,
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

  // ⚠️ The bracket takes over from week `playoffWeekStart` onward. Showing the
  // regular-season pairing for a playoff week would name an opponent the team is
  // not actually playing.
  const playoffStart = state.league?.settings?.playoffWeekStart ?? 15;
  if (state.bracket || Number(state.week) >= playoffStart) {
    return bracketPane(playoffStart);
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

/** The postseason. */
function bracketPane(playoffStart) {
  if (!state.bracket) {
    return panel({
      title: 'Playoffs',
      body: `<p class="muted">The postseason starts in week ${esc(String(playoffStart))} and has not been seeded yet.</p>
        ${state.league?.isCommissioner
    ? `<button class="btn primary" data-act="matchup-start-playoffs" ${state.busy ? 'disabled' : ''}>
         ${state.busy ? 'Seeding…' : 'Seed the bracket'}
       </button>`
    : '<p class="muted">A commissioner needs to seed it.</p>'}`,
    });
  }

  const b = state.bracket;
  const champ = b.champion;
  return panel({
    title: 'Playoffs',
    right: champ ? `<span class="champion">🏆 ${esc(teamName(champ.teamId))}</span>` : '',
    body: `
      ${b.byes?.length ? `<p class="muted">Bye: ${b.byes.map((s) => esc(teamName(s.teamId))).join(', ')}</p>` : ''}
      ${b.rounds.map((r) => `
        <h4>${roundName(r.round, b.rounds.length)} <span class="muted">· week ${esc(String(r.week))}</span></h4>
        ${r.games.map((g) => bracketGame(g)).join('')}
      `).join('')}
      ${champ ? `<p class="champion-line">${esc(teamName(champ.teamId))} wins the league.</p>` : ''}`,
  });
}

/**
 * ⚠️ Named from the END, not the start. "Round 2 of 3" tells a manager nothing;
 * "Semi-final" tells them exactly where they are.
 */
function roundName(round, total) {
  const fromEnd = total - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-final';
  if (fromEnd === 2) return 'Quarter-final';
  return `Round ${round}`;
}

function bracketGame(g) {
  const decided = Boolean(g.winner);
  const won = (t) => decided && g.winner.teamId === t.teamId;
  const seat = (t) => `<span class="side ${won(t) ? 'winning' : ''}">
      <span class="seed">#${t.seed}</span>
      <span class="team">${esc(teamName(t.teamId))}${isMine(t.teamId) ? ' <span class="muted">(you)</span>' : ''}</span>
    </span>`;
  return `<div class="matchup bracket-game">
    ${seat(g.home)}<div class="vs">vs</div>${seat(g.away)}
    ${g.tie ? '<span class="muted">tie — higher seed advances</span>' : ''}
  </div>`;
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
    // ⚠️ Reading the bracket ADVANCES it — a round is decided when its week is
    // scored, and this read is what resolves that.
    state.bracket = await getPlayoffs(leagueId, league?.season).catch(() => null);
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

/** Commissioner: seed the postseason from the final standings. */
export async function seedPlayoffs(app) {
  state.busy = true;
  state.error = null;
  app?.router?.refresh();
  try {
    await startPlayoffs(state.leagueId, { season: state.league?.season });
    state.bracket = await getPlayoffs(state.leagueId, state.league?.season);
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
