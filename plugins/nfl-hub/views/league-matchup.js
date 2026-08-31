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

import { esc, panel, stateMsg, noLeaguePane} from '../core/ui.js';
import { getScores, getSchedule, generateSchedule, getPlayoffs, startPlayoffs } from '../core/league-api.js';
import { loadIndex, getIndex, playerLabel } from '../core/player-index.js';
import { playerChip, positionColor, managerColor } from '../core/player-visuals.js';
// ⚠️ The avatar sits BESIDE `.team`, never inside it — that span carries the
// ellipsis that keeps a long franchise name from pushing the score off the card,
// and an image inside it would be what got clipped.
import { teamAvatar } from '../core/team-visuals.js';
import { eligiblePositions } from '../core/league/slots.js';
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

/**
 * The reader's own fixture list for the season.
 *
 * ⚠️ FILLS THE SPACE UNDER THE PAIRINGS WITH THE ONE THING NOT ALREADY ON
 * SCREEN. A league's week is four or five rows tall and the pane is a page
 * tall, so this tab was mostly empty — reported 2026-08-31. The candidates were
 * standings (the League tab owns those), this week's leaders (the same four
 * rows re-sorted) and the schedule. Only the schedule answers something the
 * rest of the tab cannot: who you play next, and when.
 *
 * ⚠️ NO RESULTS COLUMN, DELIBERATELY. This view loads scores for the CURRENT
 * week only, so a W/L column would be blank for every other week — and a blank
 * result reads as "nobody played", not as "not loaded here". Fetching a score
 * per week to fill it would be one request per week of the season on every
 * visit to this tab. The fixture is the honest half.
 */
function myFixtures() {
  const mine = (state.league?.myTeams ?? [])[0];
  if (!mine || !Array.isArray(state.schedule?.weeks)) return '';

  const rows = [];
  for (const w of state.schedule.weeks) {
    const m = (w.matchups ?? []).find(
      (x) => String(x.home) === String(mine) || String(x.away) === String(mine));
    if (!m) continue;
    const bye = m.bye || (!m.home || !m.away);
    const opp = String(m.home) === String(mine) ? m.away : m.home;
    const home = String(m.home) === String(mine);
    rows.push({ week: w.week, opp, home, bye });
  }
  if (rows.length === 0) return '';

  const now = Number(state.week);
  return `<div class="season-strip">
    <h4>Your season <span class="muted">${esc(teamName(mine))}</span></h4>
    <div class="fx-row">
      ${rows.map((r) => `
        <div class="fx ${r.week === now ? 'now' : ''} ${r.week < now ? 'past' : ''}">
          <span class="fx-wk">WK ${esc(String(r.week))}</span>
          ${r.bye
    ? '<span class="fx-opp muted">Bye</span>'
    : `<span class="fx-at">${r.home ? 'vs' : '@'}</span>
             <span class="fx-opp team-accent" style="--mgr:${esc(managerColor(r.opp))}">${esc(teamName(r.opp))}</span>`}
        </div>`).join('')}
    </div>
  </div>`;
}

/**
 * Is this an actual seeded postseason?
 *
 * 🔴 TRUTHINESS IS NOT ENOUGH, and trusting it cost a league its Matchups tab.
 * `getPlayoffs` answers null for a league with no bracket, but the SDK's
 * `invokeModule` unwraps with `inner?.data ?? inner` — and `??` reads a null
 * `data` as absent and falls back to the envelope. "There is no postseason"
 * therefore arrived as a truthy `{ok:true, data:null}`, this view took the
 * playoff branch in WEEK 1, and rendered an empty Playoffs pane over the
 * regular season — hiding the "Generate schedule" button a freshly drafted
 * league needs. Reported as "nothing shows up in Matchups".
 *
 * ⚠️ A SEEDED BRACKET ALWAYS HAS ROUNDS. That is the property worth checking
 * and it is true regardless of what the transport does, so this guard holds
 * even after the SDK is fixed — and would have held before it broke.
 */
function hasBracket(b) {
  return Boolean(b) && typeof b === 'object' && Array.isArray(b.rounds) && b.rounds.length > 0;
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
  // ⚠️ "The season has not started" is a claim ABOUT A LEAGUE. With none loaded it
  // is not true, merely plausible — and it contradicted the League tab, which was
  // correctly reporting the engine being off.
  if (!state.leagueId) return noLeaguePane('Matchups');
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
  if (hasBracket(state.bracket) || Number(state.week) >= playoffStart) {
    return bracketPane(playoffStart);
  }

  // ⚠️ Same reasoning as `hasBracket` — a schedule record always carries weeks,
  // and `getSchedule` returns null for a season with none, which reaches here as
  // the same truthy envelope.
  if (!state.schedule || !Array.isArray(state.schedule.weeks)) {
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
    body: `<div class="m-stagger">${pairs.map((m) => matchupCard(m)).join('')}</div>
           ${myFixtures()}`,
  });
}

/** The postseason. */
function bracketPane(playoffStart) {
  if (!hasBracket(state.bracket)) {
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
    body: bracketSide(b, {
      champLine: (name) => `${name} wins the league.`,
    }) + consolationSection(b.consolation),
  });
}

/**
 * The teams that missed the cut, playing their own bracket on the same weeks.
 *
 * ⚠️ ABSENT AND EMPTY ARE DIFFERENT. A league that does not run a consolation
 * bracket gets no section at all; one that does but has not played yet gets the
 * section with its pairings. Collapsing the two would tell half the league their
 * season is simply over.
 */
function consolationSection(c) {
  if (!c || !(c.rounds ?? []).length) return '';
  return `<div class="consolation">
    <h3>Consolation bracket</h3>
    <p class="muted">The teams that missed the playoffs, playing the same weeks.</p>
    ${bracketSide(c, {
    champLine: (name) => `${name} takes the consolation bracket.`,
    prefix: 'Consolation ',
  })}
  </div>`;
}

/** One side of the postseason: byes, rounds, and its own closing line. */
function bracketSide(s, { champLine, prefix = '' }) {
  const rounds = s.rounds ?? [];
  const champ = s.champion;
  return `
    ${s.byes?.length ? `<p class="muted">Bye: ${s.byes.map((x) => esc(teamName(x.teamId))).join(', ')}</p>` : ''}
    ${rounds.map((r) => `
      <h4>${esc(roundName(r.round, rounds.length, prefix))} <span class="muted">· week ${esc(String(r.week))}</span></h4>
      ${r.games.map((g) => bracketGame(g)).join('')}
    `).join('')}
    ${champ ? `<p class="champion-line">${esc(champLine(teamName(champ.teamId)))}</p>` : ''}`;
}

/**
 * ⚠️ Named from the END, not the start. "Round 2 of 3" tells a manager nothing;
 * "Semi-final" tells them exactly where they are.
 */
function roundName(round, total, prefix = '') {
  const fromEnd = total - round;
  if (fromEnd === 0) return `${prefix}${prefix ? 'final' : 'Final'}`;
  if (fromEnd === 1) return `${prefix}${prefix ? 'semi-final' : 'Semi-final'}`;
  if (fromEnd === 2) return `${prefix}${prefix ? 'quarter-final' : 'Quarter-final'}`;
  return `${prefix}${prefix ? 'round' : 'Round'} ${round}`;
}

function bracketGame(g) {
  const decided = Boolean(g.winner);
  const won = (t) => decided && g.winner.teamId === t.teamId;
  // ⚠️ Consolation teams carry BOTH a local seed (1..n, which is what pairs and
  // reseeds them) and the overall finish. Printing the local one would label the
  // seventh-best team in the league "#1", which reads as a bracket somebody has
  // mixed up rather than as the also-rans' ladder.
  // ⚠️ THE SAME `.side` COMPONENT AS THE REGULAR-SEASON CARD, so it takes the same
  // accent. Accenting only the matchup card left a colour stripe on one and none
  // on the playoff game rendered directly below it.
  const seat = (t) => `<span class="side team-accent ${won(t) ? 'winning' : ''}"
      style="--mgr:${esc(managerColor(t.teamId))}">
      <span class="seed">#${esc(String(t.overallSeed ?? t.seed))}</span>
      ${teamAvatar(teamOf(t.teamId), { size: 20 })}
      <span class="team">${esc(teamName(t.teamId))}${isMine(t.teamId) ? ' <span class="you">you</span>' : ''}</span>
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
      <div class="side team-accent" style="--mgr:${esc(managerColor(m.home))}">${teamAvatar(teamOf(m.home), { size: 22 })}<span class="team">${esc(teamName(m.home))}</span> <span class="muted">— bye</span></div>
    </div>`;
  }

  const home = teamScore(m.home);
  const away = teamScore(m.away);
  const decided = home !== null && away !== null;
  const homeWins = decided && home > away;
  const awayWins = decided && away > home;

  const best = Math.max(home ?? 0, away ?? 0) || null;
  return `<div class="matchup">
    ${side(m.home, home, homeWins, best)}
    <div class="vs">vs</div>
    ${side(m.away, away, awayWins, best)}
  </div>
  ${state.expanded === String(m.home) ? lineupsFor(m) : ''}`;
}

function side(teamId, points, winning, best = null) {
  // ⚠️ Scaled to the HIGHER of the two scores, not to zero. Both teams always
  // score a large number, so a bar from zero is always nearly full and says
  // nothing; against the leader it answers "by how much".
  const pct = points === null || !best ? 0 : Math.max(2, Math.round((points / best) * 100));
  return `<button class="side team-accent ${winning ? 'winning' : ''}"
    style="--mgr:${esc(managerColor(teamId))}"
    data-act="matchup-expand" data-team="${esc(teamId)}">
    ${teamAvatar(teamOf(teamId), { size: 22 })}
    <span class="team">${esc(teamName(teamId))}${isMine(teamId) ? ' <span class="you">you</span>' : ''}</span>
    <span class="pts">${points === null ? '—' : points.toFixed(2)}</span>
    ${points === null ? '' : `<span class="mu-bar"><span class="mu-bar-fill" style="width:${pct}%"></span></span>`}
  </button>`;
}

/**
 * Both lineups, side by side, because comparing them IS the screen.
 *
 * 🔴 THIS USED TO RENDER ONE SIDE. `state.expanded` held a single teamId and the
 * card asked `expanded === m.home ? … : ''` beside `expanded === m.away ? … : ''`
 * — two tests of one value, so only ever one could be true. Expanding a matchup
 * showed the side you clicked and nothing to compare it against, which is how it
 * was reported on 2026-08-31: "it's not showing each person's team setup".
 *
 * Keyed on the HOME team, so either side opens and closes the same pane. Keying
 * on the clicked team means clicking the opponent of an open matchup re-opens
 * the pane it is already showing, which reads as a dead click.
 */
function lineupsFor(m) {
  const col = (teamId) => `<div class="lineup-col">
    <div class="lineup-head team-accent" style="--mgr:${esc(managerColor(teamId))}">
      ${teamAvatar(teamOf(teamId), { size: 20 })}
      <span class="team">${esc(teamName(teamId))}</span>
    </div>
    ${lineupTable(teamId)}
  </div>`;
  return `<div class="lineups">${col(m.home)}${col(m.away)}</div>`;
}

function lineupTable(teamId) {
  const rows = state.scores?.teams?.[teamId]?.rows ?? [];
  if (rows.length === 0) {
    return '<p class="muted">No lineup scored for this team yet.</p>';
  }
  // ⚠️ THE SAME CHIP AND THE SAME SLOT COLOUR AS My Roster. This table used to
  // render `playerLabel()` as a bare string — "Pat One (QB · KC)" — and leave the
  // slot flat, so the one screen where you compare two lineups side by side was
  // also the one screen where a player looked like a different object. The slot
  // colour rule is `eligiblePositions().length > 1 ? 'RB' : slot`, matching
  // views/league-roster.js exactly: a flexish slot takes RB's hue, because
  // colouring by the literal slot name finds no position and renders uncoloured.
  const playerOf = (id) => getIndex()?.[String(id)] ?? null;
  return `<table class="tbl lineup-detail">
    <tbody>${rows.map((r) => {
    const p = r.playerId ? playerOf(r.playerId) : null;
    const hue = positionColor(eligiblePositions(r.slot).length > 1 ? 'RB' : r.slot);
    return `<tr>
        <td class="slot" style="color:${esc(hue)}">${esc(r.slot)}</td>
        <td>${r.playerId
    ? (p ? playerChip(p, { size: 30, compact: true }) : esc(playerLabel(r.playerId)))
    : '<span class="muted">empty</span>'}</td>
        <td class="num">${Number(r.points ?? 0).toFixed(2)}</td>
      </tr>`;
  }).join('')}</tbody>
  </table>`;
}

function teamScore(teamId) {
  const t = state.scores?.teams?.[String(teamId)];
  return t ? Number(t.total ?? 0) : null;
}

function teamName(teamId) {
  return state.league?.teams?.[String(teamId)]?.name ?? String(teamId);
}

/**
 * The team RECORD, which is what carries the avatar.
 *
 * ⚠️ Falls back to a record shaped like a team rather than to null, so
 * `teamAvatar` still draws the monogram and the manager colour for a team that a
 * stale schedule references and the current league payload does not.
 */
function teamOf(teamId) {
  const id = String(teamId);
  return state.league?.teams?.[id] ?? { id, name: id };
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

/**
 * Toggle a MATCHUP's lineups open — both of them, from either side.
 *
 * The pairing's home team is the canonical key, so the away button toggles the
 * same pane rather than a second one. A team with no pairing (no schedule loaded
 * yet) falls back to its own id, which simply opens nothing extra.
 */
export function expand(app, teamId) {
  const key = matchupKeyFor(String(teamId));
  state.expanded = state.expanded === key ? null : key;
  app?.router?.refresh();
}

function matchupKeyFor(teamId) {
  const m = pairingsFor(state.schedule, state.week)
    .find((p) => String(p.home) === teamId || String(p.away) === teamId);
  return m ? String(m.home) : teamId;
}

export { state as _state };
