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
import { loadRanking, byeWeekFor } from '../core/draft-ranking.js';
import { loadWeekProjections, projectedThisWeek } from '../core/weekly-projections.js';

const state = {
  leagueId: null,
  league: null,
  week: null,      // the LEAGUE's current week — what "live" means
  // ⚠️ SEPARATE FROM `week`, and the separation is the point. Browsing to week 6
  // must not make the hub think the season has moved; `week` is the league's
  // state and belongs to the commissioner, `viewWeek` is where this reader is
  // looking. Collapsing them made every other tab follow the browse.
  viewWeek: null,
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
    leagueId: null, league: null, week: null, viewWeek: null, scores: null, schedule: null,
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

/** Which week this reader is looking at — the league's current one by default. */
export function viewedWeek() {
  return Number(state.viewWeek ?? state.week);
}

/** The weeks the stored schedule actually contains, in order. */
function scheduledWeeks() {
  return (state.schedule?.weeks ?? []).map((w) => Number(w.week)).sort((a, b) => a - b);
}

/**
 * Step back and forth through the season.
 *
 * 🔴 THIS TAB SHOWED ONE WEEK AND ONLY ONE. It rendered the league's current
 * week with no way to reach any other, so a finished week was unreachable the
 * moment the commissioner advanced the season — you could not check what a
 * result had been, and in a league that had not started you could not look
 * ahead at all. The schedule holds every week; nothing surfaced them.
 *
 * ⚠️ BOUNDED BY THE SCHEDULE, not by 1..18. A league's season is
 * `startWeek` to `playoffWeekStart - 1`, so stepping past either end offers a
 * week the stored record has no pairings for — which renders as "week N is not
 * in the schedule" and reads as a broken button.
 */
function weekNav(shown) {
  const weeks = scheduledWeeks();
  if (weeks.length === 0) return `<span class="muted">Week ${esc(String(shown))}</span>`;
  const i = weeks.indexOf(Number(shown));
  const prev = i > 0 ? weeks[i - 1] : null;
  const next = i > -1 && i < weeks.length - 1 ? weeks[i + 1] : null;
  const live = Number(shown) === Number(state.week);

  return `<span class="wk-nav">
    <button class="btn tiny" data-act="matchup-week" data-week="${esc(String(prev ?? ''))}"
            ${prev === null || state.busy ? 'disabled' : ''} title="Previous week">‹</button>
    <span class="wk-label">Week ${esc(String(shown))}${live ? '' : ' <span class="muted">· not live</span>'}</span>
    <button class="btn tiny" data-act="matchup-week" data-week="${esc(String(next ?? ''))}"
            ${next === null || state.busy ? 'disabled' : ''} title="Next week">›</button>
    ${live ? '' : `<button class="btn tiny" data-act="matchup-week" data-week="${esc(String(state.week))}">Today</button>`}
  </span>`;
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
function myFixtures(shown) {
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

  const now = Number(shown ?? state.week);
  return `<div class="season-strip">
    <h4>Your season <span class="muted">${esc(teamName(mine))}</span></h4>
    <div class="fx-row">
      ${rows.map((r) => `
        <button class="fx ${r.week === now ? 'now' : ''} ${r.week < now ? 'past' : ''}"
                data-act="matchup-week" data-week="${esc(String(r.week))}">
          <span class="fx-wk">WK ${esc(String(r.week))}</span>
          ${r.bye
    ? '<span class="fx-opp muted">Bye</span>'
    : `<span class="fx-at">${r.home ? 'vs' : '@'}</span>
             <span class="fx-opp team-accent" style="--mgr:${esc(managerColor(r.opp))}">${esc(teamName(r.opp))}</span>`}
        </button>`).join('')}
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
  const shown = viewedWeek();

  // ⚠️ The bracket takes over from week `playoffWeekStart` onward. Showing the
  // regular-season pairing for a playoff week would name an opponent the team is
  // not actually playing.
  const playoffStart = state.league?.settings?.playoffWeekStart ?? 15;
  if (hasBracket(state.bracket) || Number(shown) >= playoffStart) {
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

  const pairs = pairingsFor(state.schedule, shown);
  if (pairs.length === 0) {
    return panel({
      title: 'Matchups',
      body: `<p class="muted">Week ${esc(String(shown))} is not in the schedule
             (weeks ${esc(String(state.schedule.startWeek))}–${esc(String(state.schedule.startWeek + (state.schedule.weeks?.length ?? 0) - 1))}).</p>`,
    });
  }

  return panel({
    title: 'Matchups',
    right: weekNav(shown),
    body: `<div class="m-stagger">${pairs.map((m) => matchupCard(m)).join('')}</div>
           ${myFixtures(shown)}`,
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
  const shown = viewedWeek();
  return `<table class="tbl lineup-detail">
    <thead><tr>
      <th></th><th>Player</th>
      <th class="num" title="The week this player's NFL team does not play">Bye</th>
      <th class="num" title="Projected points for this week, scored with this league's own rules">Proj</th>
      <th class="num" title="Points actually scored this week">Pts</th>
    </tr></thead>
    <tbody>${rows.map((r) => {
    const p = r.playerId ? playerOf(r.playerId) : null;
    const hue = positionColor(eligiblePositions(r.slot).length > 1 ? 'RB' : r.slot);
    // ⚠️ For the VIEWED week, not the league's current one — browsing back to
    // week 6 must show week 6's projection beside week 6's actual score.
    const proj = r.playerId ? projectedThisWeek(r.playerId, {
      season: state.league?.season, week: shown, scoring: state.league?.settings?.scoring,
    }) : null;
    const bye = byeWeekFor(p?.t);
    // ⚠️ A BYE IN THE WEEK BEING VIEWED IS THE POINT OF THE COLUMN. It is the
    // one thing that explains a 0.00 without the manager having done anything
    // wrong, and it is flagged against the VIEWED week rather than the league's
    // current one — otherwise browsing back to week 6 marks nobody.
    const onBye = bye !== null && Number(bye) === Number(shown);
    return `<tr class="${onBye ? 'row-bye' : ''}">
        <td class="slot" style="color:${esc(hue)}">${esc(r.slot)}</td>
        <td>${r.playerId
    ? (p ? playerChip(p, { size: 30, compact: true }) : esc(playerLabel(r.playerId)))
    : '<span class="muted">empty</span>'}</td>
        <td class="num bye ${onBye ? 'on-bye' : ''}">${bye === null ? '<span class="muted">—</span>' : esc(String(bye))}</td>
        <td class="num proj">${proj === null ? '<span class="muted">—</span>' : esc(proj.toFixed(1))}</td>
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
    // Feeds the Proj and Bye columns only; both already render "—" without it.
    loadRanking().then(() => app?.router?.refresh()).catch(() => {});
    // Both are optional: a season with no schedule, and a week nobody has
    // scored, are normal states rather than failures.
    state.schedule = await getSchedule(leagueId, league?.season).catch(() => null);
    // ⚠️ Reading the bracket ADVANCES it — a round is decided when its week is
    // scored, and this read is what resolves that.
    state.bracket = await getPlayoffs(leagueId, league?.season).catch(() => null);
    state.viewWeek = week;
    if (week) {
      loadWeekProjections(league?.season, week).then(() => app?.router?.refresh()).catch(() => {});
    }
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

/**
 * Look at a different week.
 *
 * ⚠️ SCORES ARE PER WEEK, so browsing has to fetch. The pairings come from the
 * stored schedule and are already in hand, which is why the board redraws
 * immediately and the scores fill in — rather than the whole tab blanking on a
 * spinner every time somebody steps back one week.
 *
 * ⚠️ Any open lineup is closed. It belongs to a matchup in the week being left,
 * and `state.expanded` is keyed on a home-team id that may not even play in the
 * week being entered — so leaving it set opens a pane under an unrelated game.
 */
export async function showWeek(app, week) {
  const n = Number(week);
  if (!Number.isInteger(n) || n < 1) return;
  state.viewWeek = n;
  state.expanded = null;
  state.busy = true;
  app?.router?.refresh();
  try {
    // Both are per-week and both follow the browse.
    loadWeekProjections(state.league?.season, n).then(() => app?.router?.refresh()).catch(() => {});
    state.scores = await getScores(state.leagueId, state.league?.season, n).catch(() => null);
  } finally {
    state.busy = false;
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
