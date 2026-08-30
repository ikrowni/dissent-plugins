// core/league/settings.js — a native league's configuration.
//
// PURE. The one place that decides what a league IS: its format, its roster
// shape, its transaction rules and its playoff structure.
//
// ⚠️ THE KNOB LIST IS TAKEN FROM A REAL SLEEPER LEAGUE, not designed from
// scratch. Every field below exists because a recorded 12-team dynasty league
// actually carries it, which is how we avoid discovering a missing rule in
// week 9. Our names are our own (readable camelCase); the Sleeper field they came
// from is recorded near the bottom of this file, because the parity programme
// still reads Sleeper's settings screens even though nothing imports from them.

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

/**
 * Ceilings on the roster shape.
 *
 * ⚠️ These bound a TYPO, not a taste. A league may legitimately run a deep
 * bench; none can run 4,000 of them, and an unbounded number reaches
 * `generateOrder` as a rounds count and builds a draft nobody can load.
 */
export const MAX_BENCH_SLOTS = 40;
export const MAX_IR_SLOTS = 10;
export const MAX_TAXI_SLOTS = 10;
export const MAX_DRAFT_ROUNDS = 40;

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
  // How long each playoff round runs: 'one' | 'two_week_championship' | 'two'.
  // Sleeper's three options, captured from the live settings screen.
  playoffRoundFormat: 'one',
  // Play the league median as a second weekly result, Sleeper's league_average_match.
  medianMatchup: false,

  // Transactions
  waiverType: WAIVER_TYPE.FAAB,
  waiverBudget: 100,
  // How many days a dropped player sits on waivers before clearing to free
  // agency. 0 disables the wire entirely and every drop lands in free agency.
  //
  // ⚠️ WAS A DEAD SETTING until 2026-08-11 — declared, mapped from Sleeper,
  // consumed nowhere. `core/league/waiver-wire.js` now reads it, which is also
  // what made Sleeper's 24-Hour Rule expressible: that rule is an EXCEPTION to
  // drop-to-waivers, and an exception needs a rule to except.
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
  // Max ACTIVE players per position, e.g. { QB: 4 }. Empty means uncapped,
  // which is the default and by far the common case. IR and taxi are exempt —
  // see overPositionLimit in rosters.js for why.
  positionLimits: {},
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
  const positions = [...(partial.rosterPositions ?? DEFAULT_SETTINGS.rosterPositions)];

  // ⚠️ `irSlots` AND the 'IR' entries in `rosterPositions` BOTH described the
  // same thing, and nothing kept them equal. The roster screen counted the
  // array (views/league-roster.js) while the server enforced the number
  // (ops-league.js placeOnIr, rosters.js validateRosters) — so a commissioner
  // who set irSlots without adding 'IR' got a league where the node allowed a
  // player onto IR and the roster page had nowhere to draw him. He was held,
  // uncounted against the active roster, and invisible. Same story for taxi.
  //
  // The number is the source of truth and the array is derived from it, with
  // one exception: a caller who passes `rosterPositions` and NOT the number is
  // describing the shape with the array, so the number follows it instead.
  const ir = reserveCount(partial, positions, 'irSlots', 'IR', merged);
  const taxi = reserveCount(partial, positions, 'taxiSlots', 'TAXI', merged);

  return {
    ...merged,
    irSlots: ir,
    taxiSlots: taxi,
    rosterPositions: setReserve(setReserve(positions, 'IR', ir), 'TAXI', taxi),
    scoring: { ...(partial.scoring ?? DEFAULT_SETTINGS.scoring) },
    // ⚠️ Copied for the same reason as `scoring`: a league editing its limits in
    // place would otherwise edit every league seeded from the frozen default.
    positionLimits: { ...(partial.positionLimits ?? DEFAULT_SETTINGS.positionLimits) },
  };
}

/** Which of the two descriptions of a reserve compartment wins — see above. */
function reserveCount(partial, positions, field, token, merged) {
  const describedByArray = partial.rosterPositions !== undefined && partial[field] === undefined;
  const n = describedByArray
    ? positions.filter((x) => x === token).length
    : Number(merged[field] ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Rewrite a slot list to hold exactly `n` of one reserve token.
 *
 * ⚠️ STARTING SLOTS AND BENCH KEEP THEIR ORDER. Only the named token is
 * stripped and re-appended, because a lineup is indexed against the starters
 * and re-ordering them would silently re-label every starting slot.
 */
function setReserve(positions, token, n) {
  const kept = positions.filter((x) => x !== token);
  return [...kept, ...Array.from({ length: n }, () => token)];
}

/**
 * Set a league's roster shape from counts rather than from a hand-built array.
 *
 * This is what a settings form should call: "ten bench spots and one IR" is the
 * question a commissioner is actually answering, and building the array by hand
 * at each call site is how the starters get re-ordered by accident.
 *
 * ⚠️ STARTERS ARE NEVER TOUCHED. Passing `bench` undefined leaves the bench
 * alone, so a caller changing only IR cannot silently resize the bench.
 */
export function setRosterShape(settings, { bench, ir, taxi } = {}) {
  const s = normalizeSettings(settings);
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.trunc(Number(v))));

  let positions = [...s.rosterPositions];
  if (bench !== undefined && Number.isFinite(Number(bench))) {
    positions = setReserve(positions, 'BN', clamp(bench, MAX_BENCH_SLOTS));
    // 'BN' was re-appended after IR/TAXI; put the reserves back at the end so
    // the list still reads starters → bench → reserves.
    positions = setReserve(setReserve(positions, 'IR', countOf(s.rosterPositions, 'IR')),
      'TAXI', countOf(s.rosterPositions, 'TAXI'));
  }

  const next = { ...s, rosterPositions: positions };
  if (ir !== undefined && Number.isFinite(Number(ir))) next.irSlots = clamp(ir, MAX_IR_SLOTS);
  if (taxi !== undefined && Number.isFinite(Number(taxi))) next.taxiSlots = clamp(taxi, MAX_TAXI_SLOTS);
  return normalizeSettings(next);
}

const countOf = (list, token) => (list ?? []).filter((x) => x === token).length;

/** How many players a team may hold, IR and taxi excluded — they are extra. */
export function activeRosterSize(settings) {
  const { starters, bench } = splitRosterPositions(settings?.rosterPositions);
  return starters.length + bench;
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

  // Roster shape and the draft that fills it.
  const { bench, ir: irInList } = splitRosterPositions(s.rosterPositions);
  if (bench > MAX_BENCH_SLOTS) errors.push(`at most ${MAX_BENCH_SLOTS} bench slots`);
  if (!Number.isInteger(s.irSlots) || s.irSlots < 0 || s.irSlots > MAX_IR_SLOTS) {
    errors.push(`irSlots must be a whole number from 0 to ${MAX_IR_SLOTS}`);
  }
  if (!Number.isInteger(s.taxiSlots) || s.taxiSlots < 0 || s.taxiSlots > MAX_TAXI_SLOTS) {
    errors.push(`taxiSlots must be a whole number from 0 to ${MAX_TAXI_SLOTS}`);
  }
  // normalizeSettings derives the list from the numbers, so a disagreement here
  // means something bypassed it — worth failing loudly rather than picking one.
  if (irInList !== s.irSlots) {
    errors.push(`rosterPositions carries ${irInList} IR slots but irSlots says ${s.irSlots}`);
  }

  if (!Number.isInteger(s.draftRounds) || s.draftRounds < 1 || s.draftRounds > MAX_DRAFT_ROUNDS) {
    errors.push(`draftRounds must be a whole number from 1 to ${MAX_DRAFT_ROUNDS}`);
  }
  // ⚠️ A draft longer than the roster hands every team more players than they
  // may hold, and `validateRosters` then reports every single team as illegal —
  // a league-wide error whose cause is one setting nobody looked at.
  const capacity = activeRosterSize(s);
  if (s.draftRounds > capacity) {
    errors.push(`${s.draftRounds} draft rounds fills more players than the ${capacity} roster spots — add bench slots or draft fewer rounds`);
  }
  if (!Number.isInteger(s.pickTimerSeconds) || s.pickTimerSeconds < 0) {
    errors.push('pickTimerSeconds must be 0 (no clock) or a whole number of seconds');
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
 * ⚠️ `fromSleeperSettings` USED TO LIVE HERE, and it is gone deliberately.
 *
 * It mapped a Sleeper league's `settings` onto ours so one could seed another. It
 * was wired to a "bring your Sleeper league across" button on 2026-08-12 and both
 * were removed hours later by the same product decision: **Sleeper is where this
 * hub gets its DATA — stat lines and the week — and is never something a user is
 * asked to touch.** Everything a manager can do on Sleeper is meant to be doable
 * here, natively. A missing rule is a feature to build, not a thing to import.
 *
 * ⚠️ IT WAS ALSO BROKEN THE ENTIRE TIME IT EXISTED, which is the better reason not
 * to keep dead mappers around. It had no caller, so its output had never once been
 * run through `validateSettings` — and when it finally was, EVERY real league came
 * back invalid. **A mapper with no caller has never been checked against the thing
 * it maps into.**
 *
 * The field knowledge it encoded is kept, because the parity programme still needs
 * to read Sleeper's own settings screens and know what they mean:
 *
 *   settings.type          0 redraft · 1 keeper · 2 dynasty
 *   settings.waiver_type   0 rolling · 1 reverse standings · 2 FAAB
 *   league_average_match   our `medianMatchup`
 *   reserve_slots/taxi_*   our `irSlots` / `taxiSlots` / `taxiYears`
 *   disable_trades/adds    inverted into our `tradesEnabled` / `addsEnabled`
 *   roster_positions       our `rosterPositions`, same strings
 *   scoring_settings       our `scoring`, same keys
 *
 * ⚠️ TWO TRAPS IN THAT PAYLOAD, both measured on live leagues and both worth
 * knowing before anyone reads Sleeper's settings again:
 *   · `max_keepers: 1` is shipped on REDRAFT leagues, where it means nothing.
 *   · `veto_votes_needed` is often ABSENT, so a default of 6 can exceed the team
 *     count of a small league and make a veto unreachable.
 */

/**
 * May this settings change be applied to a league in THIS state?
 *
 * ⚠️ SEPARATE FROM `validateSettings`, AND THE DIFFERENCE IS THE WHOLE POINT.
 * `validateSettings` asks whether a config is internally coherent — a question
 * about the config alone. This asks whether moving from one coherent config to
 * another is safe given what the league already holds, which needs the rosters
 * and the draft. A ten-man bench is perfectly valid and still catastrophic to
 * impose on a league whose teams hold twelve players.
 *
 * ⚠️ GROWING IS ALWAYS ALLOWED. Adding bench spots or an IR slot before a draft
 * is the ordinary use and must never be blocked. Only shrinking is gated, and
 * only when something would actually be stranded.
 *
 * ⚠️ A SHRINK DOES NOT "UN-DRAFT" ANYONE. Nothing here decides who leaves a
 * roster, so allowing it would simply make every affected team permanently
 * illegal and leave `validateRosters` reporting a league-wide error whose cause
 * was one number in a form.
 *
 * `draftStatus` is the draft's own status or null when none exists.
 */
export function canApplySettings(before, next, { rosters = {}, draftStatus = null } = {}) {
  const a = normalizeSettings(before ?? {});
  const b = normalizeSettings(next ?? {});

  const structural = a.rosterPositions.join() !== b.rosterPositions.join()
    || a.draftRounds !== b.draftRounds
    || a.draftType !== b.draftType
    || a.pickTimerSeconds !== b.pickTimerSeconds;
  if (!structural) return { ok: true, error: null };

  // ⚠️ A RUNNING DRAFT IS FROZEN ENTIRELY. `rounds`, `type` and the clock are
  // baked into the board by `createDraft`, so changing them mid-draft moves the
  // label and not the board — a setting that appears to work and does nothing.
  if (draftStatus === 'active' || draftStatus === 'paused') {
    return {
      ok: false,
      error: `the draft is ${draftStatus} — finish it before changing the roster or draft settings`,
    };
  }

  const capacity = activeRosterSize(b);
  for (const [teamId, roster] of Object.entries(rosters ?? {})) {
    const held = (roster?.players ?? []).length;
    if (held > capacity) {
      return {
        ok: false,
        error: `team ${teamId} already holds ${held} players — ${capacity} roster spot${capacity === 1 ? '' : 's'} would strand ${held - capacity}`,
      };
    }
    const onIr = (roster?.ir ?? []).length;
    if (onIr > b.irSlots) {
      return {
        ok: false,
        error: `team ${teamId} has ${onIr} on IR — ${b.irSlots} IR slot${b.irSlots === 1 ? '' : 's'} would strand ${onIr - b.irSlots}`,
      };
    }
    const onTaxi = (roster?.taxi ?? []).length;
    if (onTaxi > b.taxiSlots) {
      return {
        ok: false,
        error: `team ${teamId} has ${onTaxi} on taxi — ${b.taxiSlots} would strand ${onTaxi - b.taxiSlots}`,
      };
    }
  }

  return { ok: true, error: null };
}
