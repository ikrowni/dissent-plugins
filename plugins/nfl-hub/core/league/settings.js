// core/league/settings.js — a native league's configuration.
//
// PURE. The one place that decides what a league IS: its format, its roster
// shape, its transaction rules and its playoff structure.
//
// ⚠️ THE KNOB LIST IS TAKEN FROM A REAL SLEEPER LEAGUE, not designed from
// scratch. Every field below exists because a recorded 12-team dynasty league
// actually carries it, which is how we avoid discovering a missing rule in
// week 9. Our names are our own (readable camelCase); `fromSleeperSettings`
// maps Sleeper's snake_case onto them so an existing league can seed a new one.

import { PPR_SCORING } from './scoring.js';
import { splitRosterPositions } from './slots.js';

/** League formats. Dynasty implies keeper; best ball is orthogonal to all three. */
export const FORMAT = Object.freeze({ REDRAFT: 'redraft', KEEPER: 'keeper', DYNASTY: 'dynasty' });

/** How waiver claims are ordered and paid for. */
export const WAIVER_TYPE = Object.freeze({
  ROLLING: 'rolling',       // priority moves to the back after a successful claim
  REVERSE_STANDINGS: 'reverse_standings', // priority re-derived from standings weekly
  FAAB: 'faab',             // blind bidding against a budget
});

/** The default league: 12-team PPR redraft, the most common shape by far. */
export const DEFAULT_SETTINGS = Object.freeze({
  name: 'New League',
  format: FORMAT.REDRAFT,
  bestBall: false,
  numTeams: 12,

  rosterPositions: Object.freeze([
    'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX',
    'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
  ]),
  scoring: PPR_SCORING,

  // Season shape
  startWeek: 1,
  playoffTeams: 6,
  playoffWeekStart: 15,
  // Re-seed the bracket each round rather than fixing it at the start.
  //
  // ⚠️ FALSE MATCHES SLEEPER, and we shipped the opposite until 2026-08-11.
  // Their default keeps a team on the side of the bracket it was seeded into;
  // re-seeding is the opt-in. Captured from the live settings screen —
  // "Default (teams stay on their initial side of the bracket) · Re-seed".
  //
  // ⚠️ NEW LEAGUES ONLY. `server/ops-playoffs.js` reads this as `!== false`, and
  // a league writes its settings at creation, so leagues already running keep
  // the rules they started under. That is correct — playoff rules must not move
  // under a season in progress. Do not "fix" this into a retroactive change.
  playoffReseed: false,
  // Run a second bracket for the teams that missed the cut, on the same weeks.
  // ⚠️ Only ever seeded WITH the championship side, from the one standings read.
  // A consolation bracket added later would be seeded from standings that
  // already include playoff weeks — a different table to the one it belongs to.
  playoffConsolation: true,
  // Play the league median as a second weekly result, Sleeper's league_average_match.
  medianMatchup: false,

  // Transactions
  waiverType: WAIVER_TYPE.FAAB,
  waiverBudget: 100,
  waiverClearDays: 2,
  waiverDayOfWeek: 3,
  tradeDeadlineWeek: 12,
  tradeReviewDays: 2,
  vetoVotesNeeded: 6,
  tradesEnabled: true,
  pickTradingEnabled: true,
  addsEnabled: true,

  // Roster extras
  // AutoSubs: 0 = off, otherwise how many substitutions a manager may designate
  // per week. Sleeper offers OFF/1/2/3 and defaults to OFF.
  //
  // ⚠️ Sleeper's companion toggle "Require AutoSub To Not Play Before Starter"
  // is DELIBERATELY ABSENT — it is a kickoff-time rule and this module has no
  // kickoff times (see core/league/autosubs.js and score-backoff.js). Adding the
  // toggle without the data would be a setting that silently does nothing.
  autoSubsPerWeek: 0,
  irSlots: 0,
  taxiSlots: 0,
  taxiYears: 0,
  maxKeepers: 0,

  // Draft
  draftRounds: 15,
  draftType: 'snake',
  pickTimerSeconds: 90,
});

/** Formats in which roster ownership persists across seasons. */
export function isMultiSeason(settings) {
  return settings?.format === FORMAT.DYNASTY || settings?.format === FORMAT.KEEPER;
}

/** Best ball leagues never ask anyone to set a lineup. */
export function requiresLineupSetting(settings) {
  return !settings?.bestBall;
}

/**
 * Fill a partial config with defaults.
 *
 * ⚠️ NEVER MUTATES ITS INPUT and never shares a reference with the defaults —
 * a league that edited its scoring map in place would otherwise silently edit
 * every other league seeded from the same frozen object.
 */
export function normalizeSettings(partial = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...partial };
  return {
    ...merged,
    rosterPositions: [...(partial.rosterPositions ?? DEFAULT_SETTINGS.rosterPositions)],
    scoring: { ...(partial.scoring ?? DEFAULT_SETTINGS.scoring) },
  };
}

/**
 * Check a config is internally coherent.
 *
 * Returns { valid, errors } rather than throwing: this drives a settings form,
 * where being invalid mid-edit is the normal state.
 *
 * ⚠️ These are the constraints that make a SEASON impossible if broken, not
 * matters of taste. A league may run 4 teams or 2 flex slots if it wants; it may
 * not run a playoff with more teams than exist.
 */
export function validateSettings(settings) {
  const s = normalizeSettings(settings);
  const errors = [];

  if (!s.name?.trim()) errors.push('league needs a name');
  if (!Object.values(FORMAT).includes(s.format)) errors.push(`unknown format: ${s.format}`);
  if (!Object.values(WAIVER_TYPE).includes(s.waiverType)) {
    errors.push(`unknown waiver type: ${s.waiverType}`);
  }

  if (!Number.isInteger(s.numTeams) || s.numTeams < 2) {
    errors.push('a league needs at least 2 teams');
  }
  // Odd team counts are legal but need a bye or a median matchup each week.
  if (s.numTeams % 2 === 1 && !s.medianMatchup) {
    errors.push('an odd number of teams needs medianMatchup enabled, or someone sits out every week');
  }

  const { starters } = splitRosterPositions(s.rosterPositions);
  if (starters.length === 0) errors.push('a roster needs at least one starting slot');

  if (s.playoffTeams > s.numTeams) {
    errors.push(`playoffTeams (${s.playoffTeams}) exceeds numTeams (${s.numTeams})`);
  }
  if (s.playoffTeams < 2) errors.push('a playoff needs at least 2 teams');
  if (s.playoffWeekStart <= s.startWeek) {
    errors.push('the playoffs must start after the season does');
  }
  if (s.tradeDeadlineWeek >= s.playoffWeekStart) {
    errors.push('the trade deadline must fall before the playoffs start');
  }

  if (s.waiverType === WAIVER_TYPE.FAAB && s.waiverBudget <= 0) {
    errors.push('a FAAB league needs a waiver budget above 0');
  }
  if (s.vetoVotesNeeded > s.numTeams) {
    errors.push(`vetoVotesNeeded (${s.vetoVotesNeeded}) exceeds numTeams (${s.numTeams})`);
  }

  // ⚠️ Keeper and taxi rules on a redraft league are silently meaningless, which
  // is worse than an error — a commissioner sets maxKeepers and wonders all
  // preseason why nobody can keep anyone.
  if (!isMultiSeason(s) && s.maxKeepers > 0) {
    errors.push('maxKeepers has no meaning in a redraft league — set format to keeper or dynasty');
  }
  if (s.format !== FORMAT.DYNASTY && s.taxiSlots > 0) {
    errors.push('taxi squads exist only in dynasty leagues');
  }
  // Deliberately NOT flagged: best ball with waivers, odd roster shapes, tiny
  // leagues. They are unusual, not impossible, and inventing a rule Sleeper does
  // not have would block a commissioner from a league they are entitled to run.

  return { valid: errors.length === 0, errors };
}

/**
 * Map a Sleeper league's `settings` + `scoring_settings` + `roster_positions`
 * onto a native config, so an existing league can seed a new one.
 *
 * ⚠️ SLEEPER'S NUMERIC ENUMS ARE NOT GUESSES — they are read from a recorded
 * league: `type` 0/1/2 is redraft/keeper/dynasty, and `waiver_type` 2 is FAAB.
 * Anything unrecognised falls back to the default rather than inventing meaning.
 */
export function fromSleeperSettings(sleeperLeague) {
  const s = sleeperLeague?.settings ?? {};
  const format = { 0: FORMAT.REDRAFT, 1: FORMAT.KEEPER, 2: FORMAT.DYNASTY }[s.type] ?? FORMAT.REDRAFT;
  const waiverType = { 0: WAIVER_TYPE.ROLLING, 1: WAIVER_TYPE.REVERSE_STANDINGS, 2: WAIVER_TYPE.FAAB }[s.waiver_type]
    ?? DEFAULT_SETTINGS.waiverType;

  return normalizeSettings({
    name: sleeperLeague?.name ?? DEFAULT_SETTINGS.name,
    format,
    bestBall: Boolean(s.best_ball),
    numTeams: s.num_teams ?? DEFAULT_SETTINGS.numTeams,
    rosterPositions: sleeperLeague?.roster_positions ?? DEFAULT_SETTINGS.rosterPositions,
    scoring: sleeperLeague?.scoring_settings ?? DEFAULT_SETTINGS.scoring,

    startWeek: s.start_week ?? DEFAULT_SETTINGS.startWeek,
    playoffTeams: s.playoff_teams ?? DEFAULT_SETTINGS.playoffTeams,
    playoffWeekStart: s.playoff_week_start ?? DEFAULT_SETTINGS.playoffWeekStart,
    medianMatchup: Boolean(s.league_average_match),

    waiverType,
    waiverBudget: s.waiver_budget ?? DEFAULT_SETTINGS.waiverBudget,
    waiverClearDays: s.waiver_clear_days ?? DEFAULT_SETTINGS.waiverClearDays,
    waiverDayOfWeek: s.waiver_day_of_week ?? DEFAULT_SETTINGS.waiverDayOfWeek,
    tradeDeadlineWeek: s.trade_deadline ?? DEFAULT_SETTINGS.tradeDeadlineWeek,
    tradeReviewDays: s.trade_review_days ?? DEFAULT_SETTINGS.tradeReviewDays,
    vetoVotesNeeded: s.veto_votes_needed ?? DEFAULT_SETTINGS.vetoVotesNeeded,
    tradesEnabled: !s.disable_trades,
    pickTradingEnabled: Boolean(s.pick_trading),
    addsEnabled: !s.disable_adds,

    irSlots: s.reserve_slots ?? 0,
    taxiSlots: s.taxi_slots ?? 0,
    taxiYears: s.taxi_years ?? 0,
    maxKeepers: s.max_keepers ?? 0,
    draftRounds: s.draft_rounds ?? DEFAULT_SETTINGS.draftRounds,
  });
}
