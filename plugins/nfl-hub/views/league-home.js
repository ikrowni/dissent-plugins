// views/league-home.js — the native league's landing surface.
//
// Pure render functions plus a small amount of state, matching the rest of the
// hub: the view owns what it is showing, app.js owns the DOM and the events.
//
// ⚠️ THIS IS THE NATIVE LEAGUE, not the Sleeper mirror. The existing
// views/fantasy*.js render a league that lives on Sleeper and can only be read;
// this one renders a league that lives here and can be played. They coexist
// because a native league is identified by its own `leagueId`.

import { esc, panel, stateMsg, tile } from '../core/ui.js';
import {
  listLeagues, getLeague, createLeague, joinLeague, getScores, getStandings,
  myTeam, canManage, setCurrentWeek,
} from '../core/league-api.js';
// ⚠️ The SAME scoring presets the module uses. Imported rather than duplicated:
// core/league/* is pure and shared by both halves of the plugin precisely so the
// client cannot disagree with the server about what "PPR" means.
import { PPR_SCORING, HALF_PPR_SCORING, STANDARD_SCORING } from '../core/league/scoring.js';
import { latestRecap } from '../core/league/recap.js';
import { getSchedule } from '../core/league-api.js';

const SCORING_PRESETS = {
  ppr: PPR_SCORING,
  half: HALF_PPR_SCORING,
  std: STANDARD_SCORING,
};

const state = {
  leagues: null,      // null = not loaded yet; [] = loaded and empty
  leagueId: null,
  league: null,
  scores: null,
  standings: null,
  schedule: null,     // for the weekly recap; absent early in a season
  weekScores: {},     // week -> stored score record, for the recap only
  error: null,
  busy: false,
};

export function reset() {
  Object.assign(state, {
    leagues: null, leagueId: null, league: null, scores: null, standings: null,
    error: null, busy: false,
  });
}

/** Exposed for the tests and for sibling views that need the selection. */
export function current() {
  return { leagueId: state.leagueId, league: state.league };
}

export function render() {
  if (state.error) return errorPane(state.error);
  if (state.leagues === null) return stateMsg('Loading your leagues…', { spinner: true });
  if (state.leagues.length === 0) return emptyPane();
  if (!state.league) return pickerPane(state.leagues);
  return leaguePane(state.league, state.scores, state.standings);
}

/**
 * ⚠️ An error is a PANE, not a toast. A failed call here usually means the
 * server module is unreachable or refused the caller, and both are states the
 * user has to act on — a message that fades away leaves an empty screen with no
 * explanation.
 */
function errorPane(message) {
  return panel({
    title: 'Fantasy League',
    body: `<p class="muted">${esc(message)}</p>
           <button class="btn" data-act="league-retry">Try again</button>`,
  });
}

function emptyPane() {
  return panel({
    title: 'Fantasy League',
    body: `
      <p class="muted">No league on this server yet.</p>
      <form data-act="league-create-form" class="stack">
        <label>League name
          <input name="name" value="Our League" maxlength="60" required>
        </label>
        <label>Teams
          <input name="numTeams" type="number" min="2" max="16" value="10">
        </label>
        <label>Scoring
          <select name="scoring">
            <option value="ppr" selected>PPR</option>
            <option value="half">Half PPR</option>
            <option value="std">Standard</option>
          </select>
        </label>
        <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>
          ${state.busy ? 'Creating…' : 'Create league'}
        </button>
      </form>`,
  });
}

function pickerPane(leagues) {
  const rows = leagues.map((l) => `
    <button class="row-btn" data-act="league-open" data-league="${esc(l.id)}">
      <span class="row-main">${esc(l.name)}</span>
      <span class="muted">${esc(String(l.format))} · ${l.teamCount} team${l.teamCount === 1 ? '' : 's'}
        ${l.myTeams.length ? '· <strong>your team</strong>' : ''}
        ${l.isCommissioner ? '· commissioner' : ''}</span>
    </button>`).join('');
  return panel({ title: 'Fantasy Leagues', body: `<div class="stack">${rows}</div>` });
}

function leaguePane(league, scores, standings) {
  const mine = myTeam(league);
  const teams = Object.values(league.teams ?? {});
  const week = league.currentWeek ?? null;
  const table = standingsTable(league, standings, scores);

  const joinCta = mine ? '' : `
    <form data-act="league-join-form" class="stack">
      <label>Team name <input name="teamName" maxlength="40" placeholder="Your team"></label>
      <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? 'Joining…' : 'Join this league'}
      </button>
    </form>`;

  return panel({
    title: esc(league.settings?.name ?? 'League'),
    right: league.isCommissioner ? '<span class="muted">commissioner</span>' : '',
    body: `
      <div class="tiles">
        ${tile('Format', esc(league.settings?.format ?? '—'))}
        ${tile('Teams', String(teams.length))}
        ${tile('Week', week === null ? 'preseason' : String(week))}
      </div>
      ${joinCta}
      ${recapPanel(league)}
      ${rosterCallout(league, teams.length)}
      ${commissionerStrip(league, week)}
      ${table}
      <div class="row-actions">
        <button class="btn" data-act="league-refresh">Refresh</button>
        ${mine ? '<button class="btn" data-act="league-goto-roster">My roster</button>' : ''}
        <button class="btn" data-act="league-goto-matchup">Matchups</button>
        <button class="btn" data-act="league-goto-draft">Draft</button>
      </div>`,
  });
}

/**
 * Last week's story.
 *
 * ⚠️ STANDINGS SAY WHO IS WINNING; THEY NEVER SAY WHAT HAPPENED. That somebody
 * put up the highest score of the season and still lost is the part people
 * actually talk about, and it is free — computed from the schedule and scores
 * the league already stores, with no extra fetch.
 *
 * ⚠️ Absent, not empty, when there is nothing to describe.
 */
function recapPanel(league) {
  const r = latestRecap(league.currentWeek, state.schedule?.weeks ?? [], (w) => state.weekScores[w] ?? null);
  if (!r) return '';
  const name = (t) => esc(league.teams?.[t]?.name ?? t);
  const pts = (n) => Number(n).toFixed(2);

  const items = [
    `<div class="rc-item"><span class="rc-label">Top score</span>
       <span class="rc-value">${name(r.best.teamId)} <b>${pts(r.best.points)}</b></span></div>`,
    `<div class="rc-item"><span class="rc-label">Closest game</span>
       <span class="rc-value">${name(r.nailBiter.winner ?? r.nailBiter.home)} by <b>${pts(r.nailBiter.margin)}</b></span></div>`,
    `<div class="rc-item"><span class="rc-label">Biggest win</span>
       <span class="rc-value">${name(r.blowout.winner ?? r.blowout.home)} by <b>${pts(r.blowout.margin)}</b></span></div>`,
  ];
  if (r.unlucky) {
    items.push(`<div class="rc-item unlucky"><span class="rc-label">Scored big, still lost</span>
      <span class="rc-value">${name(r.unlucky.teamId)} <b>${pts(r.unlucky.points)}</b></span></div>`);
  }

  return `<div class="recap m-rise">
    <h4>Week ${esc(String(r.week))} recap</h4>
    <div class="rc-grid m-stagger">${items.join('')}</div>
  </div>`;
}

/**
 * What this league is actually waiting for.
 *
 * ⚠️ AN EMPTY LEAGUE LOOKS BROKEN, and it is the state every new one starts in.
 * Every tab correctly says it has nothing to show, which together reads as a
 * dead feature rather than as "nobody has joined yet". Naming the missing thing
 * is the difference.
 */
function rosterCallout(league, teamCount) {
  if (teamCount >= 2) return '';
  return `<p class="notice">This league has ${teamCount === 0 ? 'no teams' : 'one team'} so far.
    A draft, a schedule and matchups all need at least two — invite people to the
    server and have them open this tab to join.</p>`;
}

/**
 * Commissioner: start the season, or move it.
 *
 * ⚠️ THE WEEK IS WHAT UNLOCKS EVERYTHING. Scoring, waivers, matchups and the
 * roster are all keyed on it, and until it is set every one of those tabs
 * correctly reports that it has nothing — with no control anywhere to change
 * that. The op existed from the beginning; nothing ever called it.
 *
 * ⚠️ Auto-advance only moves a season already in progress: it refuses while the
 * live NFL state is preseason, and it never moves backwards. So the first week
 * is always a person's decision.
 */
function commissionerStrip(league, week) {
  if (!league.isCommissioner) return '';
  const start = league.settings?.startWeek ?? 1;
  return `<div class="row-actions season-strip">
    ${week === null
    ? `<button class="btn primary" data-act="league-start-season" data-week="${start}" ${state.busy ? 'disabled' : ''}>
         ${state.busy ? 'Starting…' : `Start the season at week ${start}`}
       </button>`
    : `<label class="inline">Week
         <input type="number" min="1" max="22" value="${week}" data-act="league-week-input">
       </label>
       <button class="btn" data-act="league-set-week" ${state.busy ? 'disabled' : ''}>Set week</button>`}
  </div>`;
}

/**
 * The league table.
 *
 * ⚠️ RECORDS COME FROM THE MODULE. Before any week is scored there is no table
 * to show, so this falls back to a roster/points listing rather than printing a
 * column of 0-0 that looks like a played season.
 *
 * ⚠️ The playoff line is drawn from the league's OWN playoffTeams setting, and
 * only once records exist. Drawing it over an all-zero table would show a cut
 * decided by nothing.
 */
function standingsTable(league, standings, scores) {
  const teams = Object.values(league.teams ?? {});
  if (teams.length === 0) return '<p class="muted">No teams yet.</p>';

  const rows = standings?.standings ?? [];
  const played = (standings?.weeks ?? 0) > 0;
  const cut = played ? (league.settings?.playoffTeams ?? 0) : 0;

  if (!played) {
    return `<table class="tbl">
      <thead><tr><th>Team</th><th class="num">Roster</th><th class="num">Points</th></tr></thead>
      <tbody>${teams.map((t) => `
        <tr>
          <td>${esc(t.name)}${league.myTeams.includes(t.id) ? ' <span class="you">you</span>' : ''}</td>
          <td class="num">${(league.assets?.rosters?.[t.id]?.players ?? []).length}</td>
          <td class="num">${scores?.teams?.[t.id]?.total === undefined ? '—' : scores.teams[t.id].total.toFixed(2)}</td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="muted">Records appear once a week has been scored.</p>`;
  }

  // ⚠️ The bar is scaled to the LEADER, not to zero. Every team in a fantasy
  // league scores hundreds of points, so bars from zero are all nearly full and
  // say nothing; scaled to the best total, the gap is the story.
  const topPF = Math.max(...rows.map((r) => r.pointsFor), 1);

  return `<table class="tbl standings">
    <thead><tr>
      <th class="num">#</th><th>Team</th><th class="num">W-L-T</th>
      <th class="num">PF</th><th class="num">PA</th>
    </tr></thead>
    <tbody>${rows.map((r) => {
    const name = league.teams?.[r.teamId]?.name ?? r.teamId;
    const isMine = (league.myTeams ?? []).includes(r.teamId);
    // The line sits AFTER the last qualifying seed, not on it.
    const lastIn = cut > 0 && r.seed === cut;
    const inPlayoffs = cut > 0 && r.seed <= cut;
    const pct = Math.round((r.pointsFor / topPF) * 100);
    return `<tr class="${isMine ? 'mine' : ''} ${lastIn ? 'playoff-cut' : ''}">
        <td class="num"><span class="seed-badge${inPlayoffs ? ' in' : ''}">${r.seed}</span></td>
        <td>
          <span class="std-team">${esc(name)}${isMine ? ' <span class="you">you</span>' : ''}</span>
          <span class="std-bar"><span class="std-bar-fill" style="width:${pct}%"></span></span>
        </td>
        <td class="num">${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}</td>
        <td class="num">${r.pointsFor.toFixed(2)}</td>
        <td class="num">${r.pointsAgainst.toFixed(2)}</td>
      </tr>`;
  }).join('')}</tbody>
  </table>
  <p class="muted">After ${standings.weeks} scored week${standings.weeks === 1 ? '' : 's'}${cut ? ` · top ${cut} make the playoffs` : ''}.</p>`;
}

// ── Data loading ─────────────────────────────────────────────────────────────

export async function load(app) {
  try {
    state.error = null;
    state.leagues = await listLeagues();
    // One league is the common case; opening it straight away saves a click that
    // only ever has one answer.
    if (state.leagues.length === 1) await open(app, state.leagues[0].id);
  } catch (err) {
    state.error = describe(err);
  }
  app?.router?.refresh();
}

export async function open(app, leagueId) {
  try {
    state.error = null;
    state.leagueId = leagueId;
    state.league = await getLeague(leagueId);
    const week = state.league.currentWeek ?? null;
    // Scores are optional: a league in preseason has none, and failing to load
    // them must not blank the whole pane.
    state.scores = week
      ? await getScores(leagueId, state.league.season, week).catch(() => null)
      : null;
    // Standings are optional in the same way: a league with no scored week has
    // none, and failing to load them must not blank the pane.
    state.standings = await getStandings(leagueId, state.league.season).catch(() => null);
    // ⚠️ Recap inputs are OPTIONAL and must never blank the pane. A league with
    // no schedule or no scored week simply has no story yet.
    state.schedule = await getSchedule(leagueId, state.league.season).catch(() => null);
    state.weekScores = {};
    if (week) {
      // Only the last two weeks: latestRecap walks backwards and stops at the
      // first week with results, so fetching the whole season would be waste.
      for (const w of [week, week - 1].filter((n) => n >= 1)) {
        const rec = await getScores(leagueId, state.league.season, w).catch(() => null);
        if (rec) state.weekScores[w] = rec;
      }
    }
  } catch (err) {
    state.error = describe(err);
  }
  app?.router?.refresh();
}

export async function create(app, form) {
  const scoringChoice = String(form.scoring ?? 'ppr');
  state.busy = true;
  app?.router?.refresh();
  try {
    const created = await createLeague({
      name: String(form.name ?? 'Our League').slice(0, 60),
      numTeams: Number(form.numTeams) || 10,
      scoring: SCORING_PRESETS[scoringChoice] ?? PPR_SCORING,
    });
    state.leagues = await listLeagues();
    await open(app, created.leagueId);
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

/**
 * Commissioner: set the league's current week.
 *
 * ⚠️ Reads the input at click time rather than tracking every keystroke — the
 * hub re-renders the whole view on each refresh, so a controlled number field
 * would lose focus between digits.
 */
export async function setWeek(app, week) {
  const n = Number(week);
  if (!Number.isInteger(n) || n < 1) {
    state.error = 'Week must be a whole number of 1 or more.';
    app?.router?.refresh();
    return;
  }
  state.busy = true;
  state.error = null;
  app?.router?.refresh();
  try {
    await setCurrentWeek(state.leagueId, n);
    await open(app, state.leagueId);
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

export async function join(app, teamName) {
  state.busy = true;
  app?.router?.refresh();
  try {
    await joinLeague(state.leagueId, teamName);
    await open(app, state.leagueId);
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

/**
 * ⚠️ Show the module's OWN message. Its refusals are written for a person —
 * "you do not manage team t1", "this league is full" — and replacing them with a
 * generic failure throws away the only explanation the user will get.
 */
export function describe(err) {
  const msg = String(err?.message ?? err ?? '').trim();
  if (!msg) return 'Something went wrong.';
  if (/no server module|runtime unavailable|not enabled/i.test(msg)) {
    return 'The league engine is not running on this server yet. A server admin needs to enable it in plugin settings.';
  }
  return msg;
}

export { state as _state, canManage };
