// views/league-home.js — the native league's landing surface.
//
// Pure render functions plus a small amount of state, matching the rest of the
// hub: the view owns what it is showing, app.js owns the DOM and the events.
//
// ⚠️ THIS IS THE LEAGUE. A Sleeper mirror used to render a league that lived
// elsewhere and could only be read; it was removed on 2026-08-12, unused on every
// install. This one lives here and can be played.

import { esc, panel, stateMsg, tile } from '../core/ui.js';
import { managerColor } from '../core/player-visuals.js';
import { teamMark, banner, imageIdsOf } from '../core/team-visuals.js';
import { resolve as resolveImages } from '../core/team-images.js';
import {
  listLeagues, getLeague, createLeague, joinLeague, getScores, getStandings,
  myTeam, canManage, setCurrentWeek, updateSettings,
} from '../core/league-api.js';
// ⚠️ The SAME scoring presets the module uses. Imported rather than duplicated:
// core/league/* is pure and shared by both halves of the plugin precisely so the
// client cannot disagree with the server about what "PPR" means.
import { PPR_SCORING, HALF_PPR_SCORING, STANDARD_SCORING } from '../core/league/scoring.js';
import {
  WAIVER_TYPE, MAX_BENCH_SLOTS, MAX_IR_SLOTS, MAX_DRAFT_ROUNDS, activeRosterSize,
} from '../core/league/settings.js';
import { splitRosterPositions } from '../core/league/slots.js';
import {
  toLocalInputValue, fromLocalInputValue, formatDraftTime,
} from '../core/draft-schedule.js';
import { latestRecap } from '../core/league/recap.js';
import { toScoredWeeks, toRosters, hasEnoughForPower } from '../core/league/power-adapter.js';
import { powerRankings } from '../core/power.js';
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
  // ⚠️ Kept apart from `error`, which blanks the whole tab. A refused settings
  // save must leave the form you are standing in on screen.
  setErr: null,
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
      ${banner(league.bannerFileId, { className: 'tm-banner-league' })}
      <div class="tiles">
        ${tile('Format', esc(league.settings?.format ?? '—'))}
        ${tile('Teams', String(teams.length))}
        ${tile('Week', week === null ? 'preseason' : String(week))}
      </div>
      ${joinCta}
      ${recapPanel(league)}
      ${powerPanel(league)}
      ${draftDayCallout(league)}
      ${scheduleCallout(league, teams.length)}
      ${rosterCallout(league, teams.length)}
      ${commissionerStrip(league, week)}
      ${settingsPane(league)}
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
 * Power rankings: who is actually best, regardless of who they drew.
 *
 * ⚠️ HEAD-TO-HEAD RECORD IS A NOISY SIGNAL. A team can sit 4-1 having drawn the
 * weakest opponent every week. ALL-PLAY asks the schedule-free question — if
 * everyone played everyone, what would the record be — and LUCK is the gap
 * between that and reality. It is the single most argued-over number in a
 * fantasy league and we already had the maths.
 *
 * ⚠️ NO EFFICIENCY COLUMN. powerRankings reports it from `potentialPoints`,
 * which the native league cannot compute — a stored week holds only the
 * starters' points, so the bench scores needed for a best-possible lineup are
 * absent. Printing 0% would be a confident lie.
 */
function powerPanel(league) {
  const scored = toScoredWeeks(state.weekScores);
  // ⚠️ Two weeks minimum. After one, all-play is just that week's scoreboard
  // restated, and calling it a power ranking would be theatre.
  if (!hasEnoughForPower(scored)) return '';

  const rows = powerRankings(toRosters(state.standings?.standings ?? []), scored);
  if (rows.length === 0) return '';

  const name = (t) => esc(league.teams?.[t]?.name ?? t);
  const luckClass = (n) => (n > 0.5 ? 'lucky' : n < -0.5 ? 'unlucky' : '');
  const luckWord = (n) => (n > 0.5 ? `+${n.toFixed(1)}` : n.toFixed(1));

  return `<div class="power m-rise">
    <h4>Power rankings <span class="tiny">· all-play over ${scored.length} week${scored.length === 1 ? '' : 's'}</span></h4>
    <table class="tbl m-stagger">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">All-play</th><th class="num">Luck</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr data-team="${esc(r.rosterId)}"
          class="team-accent ${(league.myTeams ?? []).includes(r.rosterId) ? 'mine' : ''}"
          style="--mgr:${esc(managerColor(r.rosterId))}">
          <td class="num"><span class="seed-badge">${r.rank}</span></td>
          <td>${name(r.rosterId)}</td>
          <td class="num">${r.allPlay.wins}-${r.allPlay.losses}${r.allPlay.ties ? `-${r.allPlay.ties}` : ''}
            <span class="tiny">${(r.allPlayPct * 100).toFixed(0)}%</span></td>
          <td class="num ${luckClass(r.luck)}">${luckWord(r.luck)}</td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="tiny">Luck is real wins minus what an all-play record predicts. Positive means
    the schedule has been kind.</p>
  </div>`;
}

/**
 * When the draft is, on the landing surface.
 *
 * ⚠️ HERE AS WELL AS ON THE DRAFT TAB, deliberately. "What time is the draft?"
 * is asked by people who have not opened the Draft tab and have no reason to —
 * answering it only there means answering it only for those who already looked.
 *
 * Rendered in the READER'S timezone, named on screen. It disappears once the
 * time has passed rather than sitting there as a stale claim; the draft board
 * still reports it, because that is where somebody would go to ask why.
 */
function draftDayCallout(league) {
  const when = formatDraftTime(league?.settings?.draftScheduledAt);
  if (!when || when.past) return '';
  return `<p class="notice">Draft day: <strong>${esc(when.absolute)}</strong> — ${esc(when.relative)}.</p>`;
}

/**
 * A season with teams, a week, and no schedule.
 *
 * ⚠️ SAME REASONING AS `rosterCallout`: naming the missing thing is the
 * difference between a league that looks broken and one that is waiting. A
 * league whose draft has just finished has every reason to expect matchups, and
 * without a schedule the Matchups tab, the standings and the weekly recap are
 * all correctly empty — which together read as a dead feature.
 *
 * Reported exactly that way on 2026-08-31: "we finished our draft but nothing
 * shows up in Matchups". The schedule genuinely had not been generated, and
 * nothing anywhere said so on the surface people actually land on.
 *
 * ⚠️ POINTS AT THE BUTTON RATHER THAN DUPLICATING IT. `schedule:generate`
 * freezes the team order for the whole season, so exactly one place should own
 * that action — views/league-matchup.js, which already explains what it does.
 */
function scheduleCallout(league, teamCount) {
  if (teamCount < 2) return '';              // rosterCallout covers this
  if (league?.currentWeek == null) return ''; // commissionerStrip covers this
  if (Array.isArray(state.schedule?.weeks)) return '';

  // ⚠️ Only classes that EXIST. `btn-link` was written here first and no
  // stylesheet defines it — it would have rendered as a raw browser button in
  // the middle of a sentence. `.notice` + `.row-actions` + `.btn` are the
  // vocabulary the rest of this view already uses.
  return `<p class="notice">This season has no schedule yet, so Matchups and the standings
    stay empty until one is generated.${league?.isCommissioner
    ? ''
    : ' A commissioner generates it from the Matchups tab.'}</p>
    ${league?.isCommissioner
    ? `<div class="row-actions">
         <button class="btn" data-act="lg-tab" data-tab="matchup">Generate the schedule</button>
       </div>`
    : ''}`;
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
/**
 * The commissioner's settings form.
 *
 * ⚠️ `league:settings` HAS EXISTED AND WORKED SINCE THE ENGINE SHIPPED, AND
 * NOTHING COULD REACH IT. The op takes the whole settings object, is
 * commissioner-gated, normalised and validated — and `updateSettings` in
 * core/league-api.js had no caller, so a commissioner could not change their
 * league's NAME, let alone its rules. Exactly the shape `fromSleeperSettings` was
 * in: a tested capability nobody could use.
 *
 * ⚠️ `numTeams` IS STILL DELIBERATELY ABSENT. Changing it under a generated
 * schedule is a migration, not a settings change, and nothing here can perform
 * one.
 *
 * ⚠️ ROSTER SHAPE AND DRAFT SETUP ARE OFFERED, AND ARE NOT THE SAME RISK. They
 * were absent for the same reason as `numTeams` and it cost a league its draft:
 * a commissioner could not add a bench spot or an IR slot, could not change the
 * number of rounds, and — because a draft snapshots these when it is built —
 * had no way to make any edit reach a draft already prepared. The board sat on
 * "15 rounds" with only a Start button.
 *
 * What makes these safe to offer is that the node refuses the unsafe direction
 * rather than this form hiding the safe one: `guardRosterShapeChange` blocks a
 * shrink that would strand a rostered player and freezes the shape entirely
 * while a draft is running. Growing a bench before a draft — the actual use —
 * was never dangerous.
 *
 * ⚠️ COUNTS ARE POSTED, NOT `rosterPositions`. Rebuilding the array here would
 * mean rebuilding it from whatever starters this render happened to hold, and a
 * stale render re-orders the starting slots — which re-labels every saved
 * lineup, since a lineup is indexed against that list.
 *
 * The rest are rules a commissioner legitimately tunes, and the module refuses
 * any combination that does not hold together.
 */
function settingsPane(league) {
  if (!league.isCommissioner) return '';
  const st = league.settings ?? {};
  const opt = (v, cur, label) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  const shape = splitRosterPositions(st.rosterPositions);
  const capacity = activeRosterSize(st);
  // ⚠️ ELIGIBLE VOTERS, NOT TEAMS. A party to a trade cannot veto its own, so a
  // two-team trade is judged by everyone else — which is what makes the shipped
  // default of 6 mean UNANIMITY in an 8-team league. That was invisible: this
  // control did not exist, so nobody could see the number, let alone that it
  // was every eligible team.
  const teamCount = Object.keys(league.teams ?? {}).length;
  const vetoEligible = Math.max(0, teamCount - 2);
  const needed = Number(st.vetoVotesNeeded ?? 6);
  const vetoNote = vetoEligible > 0 && needed >= vetoEligible
    ? `<strong>At ${needed} that is every one of them</strong> — today a trade can only be blocked unanimously.`
    : '';
  // ⚠️ Named because saving is not enough. A draft already built keeps the
  // rounds it was built with, so a commissioner who changes them here and never
  // rebuilds sees the old number on the board and no reason why.
  const draftNote = 'A draft that is already set up keeps the settings it was built with — '
    + 'rebuild it from the Draft tab for a change here to reach the board.';
  return panel({
    title: 'League settings',
    right: '<span class="muted">commissioner</span>',
    body: `
      ${state.setErr ? `<p class="imp-bad">${esc(state.setErr)}</p>` : ''}
      <form data-act="league-settings-form" class="lg-set">
        <label>League name
          <input name="name" value="${esc(st.name ?? '')}" maxlength="60" required>
        </label>
        <label>Scoring
          <select name="scoring">
            ${opt('keep', '', 'Leave as it is')}
            ${opt('ppr', '', 'PPR')}${opt('half', '', 'Half PPR')}${opt('std', '', 'Standard')}
          </select>
        </label>
        <label>Playoff teams
          <input name="playoffTeams" type="number" min="2" max="16" value="${esc(st.playoffTeams ?? 6)}">
        </label>
        <label>Playoffs start week
          <input name="playoffWeekStart" type="number" min="2" max="22" value="${esc(st.playoffWeekStart ?? 15)}">
        </label>
        <label>Trade deadline week
          <input name="tradeDeadlineWeek" type="number" min="1" max="22" value="${esc(st.tradeDeadlineWeek ?? 12)}">
        </label>
        <label>Waivers
          <select name="waiverType">
            ${opt(WAIVER_TYPE.FAAB, st.waiverType, 'FAAB bidding')}
            ${opt(WAIVER_TYPE.ROLLING, st.waiverType, 'Rolling priority')}
            ${opt(WAIVER_TYPE.REVERSE_STANDINGS, st.waiverType, 'Reverse standings')}
          </select>
        </label>
        <label>FAAB budget
          <input name="waiverBudget" type="number" min="1" max="1000" value="${esc(st.waiverBudget ?? 100)}">
        </label>
        <label>AutoSubs per week
          <select name="autoSubsPerWeek">
            ${[0, 1, 2, 3].map((n) => opt(n, st.autoSubsPerWeek ?? 0, n === 0 ? 'Off' : String(n))).join('')}
          </select>
        </label>
        <fieldset class="lg-set-group">
          <legend>Roster</legend>
          <label>Bench spots
            <input name="benchSlots" type="number" min="0" max="${MAX_BENCH_SLOTS}" value="${esc(shape.bench)}">
          </label>
          <label>IR slots
            <input name="irSlots" type="number" min="0" max="${MAX_IR_SLOTS}" value="${esc(st.irSlots ?? shape.ir ?? 0)}">
          </label>
          <p class="tiny">${shape.starters.length} starting spot${shape.starters.length === 1 ? '' : 's'}
            + ${shape.bench} bench = <strong>${capacity}</strong> players per team.
            IR sits on top of that and does not count against it — a player only
            reaches it carrying a season-length reserve designation.</p>
        </fieldset>

        <fieldset class="lg-set-group">
          <legend>Draft</legend>
          <label>Rounds
            <input name="draftRounds" type="number" min="1" max="${MAX_DRAFT_ROUNDS}" value="${esc(st.draftRounds ?? 15)}">
          </label>
          <label>Pick clock (seconds)
            <input name="pickTimerSeconds" type="number" min="0" max="3600" value="${esc(st.pickTimerSeconds ?? 90)}">
          </label>
          <label>Draft day
            <input name="draftScheduledAt" type="datetime-local"
                   value="${esc(toLocalInputValue(st.draftScheduledAt))}">
          </label>
          <label>Draft order
            <select name="draftType">
              ${opt('snake', st.draftType ?? 'snake', 'Snake')}
              ${opt('linear', st.draftType ?? 'snake', 'Linear')}
            </select>
          </label>
          <p class="tiny">Rounds cannot exceed the ${capacity} roster spots — a longer draft
            hands every team more players than they may hold. 0 seconds means no pick clock.
            Draft day is shown to everyone in their own timezone; leave it empty for no set
            time. It does not start the draft — you still press Start.
            ${draftNote}</p>
        </fieldset>

        <fieldset class="lg-set-group">
          <legend>Trades</legend>
          <label>Review period (days)
            <input name="tradeReviewDays" type="number" min="0" max="14" value="${esc(st.tradeReviewDays ?? 2)}">
          </label>
          <label>Votes needed to veto
            <input name="vetoVotesNeeded" type="number" min="1" max="${Math.max(1, teamCount - 2)}"
                   value="${esc(st.vetoVotesNeeded ?? 6)}">
          </label>
          <p class="tiny">A trade the parties have accepted sits in review, and any team NOT in
            it may vote to veto — so ${vetoEligible} of your ${teamCount} teams can vote on a
            two-team trade. ${vetoNote} 0 review days executes trades immediately and no vote
            is taken.</p>
        </fieldset>

        <label class="inline"><input type="checkbox" name="tradesEnabled"${st.tradesEnabled !== false ? ' checked' : ''}> Trades allowed</label>
        <label class="inline"><input type="checkbox" name="addsEnabled"${st.addsEnabled !== false ? ' checked' : ''}> Free-agent adds allowed</label>
        <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>
          ${state.busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>
`,
  });
}

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
        <tr data-team="${esc(t.id)}" class="team-accent" style="--mgr:${esc(managerColor(t.id))}">
          <td>${teamMark(t, { extra: league.myTeams.includes(t.id) ? ' <span class="you">you</span>' : '' })}</td>
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
    // ⚠️ The standings row is keyed on `teamId` and the TEAM RECORD is what
    // carries the avatar, so it is looked up rather than reconstructed — a team
    // that has been renamed since the week was scored still shows its real name
    // and its real picture.
    const team = league.teams?.[r.teamId] ?? { id: r.teamId, name: r.teamId };
    const isMine = (league.myTeams ?? []).includes(r.teamId);
    // The line sits AFTER the last qualifying seed, not on it.
    const lastIn = cut > 0 && r.seed === cut;
    const inPlayoffs = cut > 0 && r.seed <= cut;
    const pct = Math.round((r.pointsFor / topPF) * 100);
    return `<tr data-team="${esc(r.teamId)}"
        class="team-accent ${isMine ? 'mine' : ''} ${lastIn ? 'playoff-cut' : ''}"
        style="--mgr:${esc(managerColor(r.teamId))}">
        <td class="num"><span class="seed-badge${inPlayoffs ? ' in' : ''}">${r.seed}</span></td>
        <td>
          <span class="std-team">${teamMark(team, { extra: isMine ? ' <span class="you">you</span>' : '' })}</span>
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
    // ⚠️ STARTED HERE, AWAITED AT THE END. The module stores a file id and the
    // node has to be asked for a signed URL per id, which is a round trip the
    // render cannot make — so it happens during load, overlapping the score
    // fetches below rather than adding its latency to them.
    //
    // ⚠️ NEVER REJECTS, by construction (core/team-images.js). A deleted banner
    // must not blank a league.
    const images = resolveImages(imageIdsOf(state.league));
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
      // ⚠️ EVERY week, not just the last two: power rankings need the whole
      // season's scores, and one score record is a few hundred bytes. Fetched in
      // PARALLEL — sequentially this would be seventeen round trips on tab load.
      const start = state.league.settings?.startWeek ?? 1;
      const weeks = [];
      for (let w = start; w <= week; w += 1) weeks.push(w);
      const records = await Promise.all(weeks.map((w) => getScores(leagueId, state.league.season, w)
        .then((rec) => [w, rec]).catch(() => [w, null])));
      for (const [w, rec] of records) if (rec) state.weekScores[w] = rec;
    }
    await images;
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
 * Save the commissioner's settings.
 *
 * ⚠️ ONLY WHAT THE FORM OFFERS IS SENT, merged server-side onto the league's
 * existing settings. Posting the whole object back would let a stale render
 * overwrite a field somebody else changed between load and save, and would send
 * `numTeams` — which this form deliberately does not expose.
 *
 * ⚠️ "Leave as it is" IS NOT A SCORING PRESET. Sending PPR because the select
 * happened to default to it would silently rewrite a custom scoring map that the
 * form has no way to display.
 */
export async function saveSettings(app, form) {
  const next = {
    name: String(form.name ?? '').slice(0, 60),
    playoffTeams: Number(form.playoffTeams),
    playoffWeekStart: Number(form.playoffWeekStart),
    tradeDeadlineWeek: Number(form.tradeDeadlineWeek),
    waiverType: String(form.waiverType),
    waiverBudget: Number(form.waiverBudget),
    autoSubsPerWeek: Number(form.autoSubsPerWeek),
    // ⚠️ COUNTS, not `rosterPositions` — the node derives the slot list from
    // the league's own starters. See settingsPane for why posting the array is
    // the thing that quietly re-labels every lineup.
    benchSlots: Number(form.benchSlots),
    irSlots: Number(form.irSlots),
    draftRounds: Number(form.draftRounds),
    pickTimerSeconds: Number(form.pickTimerSeconds),
    draftType: String(form.draftType),
    tradeReviewDays: Number(form.tradeReviewDays),
    vetoVotesNeeded: Number(form.vetoVotesNeeded),
    // ⚠️ A datetime-local field is the COMMISSIONER'S wall clock. Converted to
    // an absolute instant here so every other manager reads the same moment in
    // their own zone; an empty field clears the schedule rather than storing 0.
    draftScheduledAt: fromLocalInputValue(form.draftScheduledAt),
    // ⚠️ An unchecked checkbox is ABSENT from FormData, not `false`.
    tradesEnabled: Boolean(form.tradesEnabled),
    addsEnabled: Boolean(form.addsEnabled),
  };
  const preset = SCORING_PRESETS[String(form.scoring ?? 'keep')];
  if (preset) next.scoring = preset;

  state.busy = true;
  state.setErr = null;
  app?.router?.refresh();
  try {
    await updateSettings(state.leagueId, next);
    await open(app, state.leagueId);
  } catch (err) {
    state.setErr = describe(err);
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
