// server/main.js
var import_server_sdk4 = require("@dissent/plugin-kit/server-sdk");

// server/auth.js
var SCHEDULED = Object.freeze({ userId: null, scheduled: true });
function principal(callerFn) {
  const c = callerFn();
  return {
    userId: c?.user_id ?? null,
    scheduled: (c?.trigger ?? "invoke") === "schedule"
  };
}
function teamsOf(teams, userId) {
  if (!userId) return [];
  return Object.entries(teams ?? {}).filter(([, t]) => t.ownerId === userId || (t.coOwners ?? []).includes(userId)).map(([id]) => id);
}
function controlsTeam(teams, userId, teamId) {
  if (!userId) return false;
  const t = teams?.[String(teamId)];
  if (!t) return false;
  return t.ownerId === userId || (t.coOwners ?? []).includes(userId);
}
function isCommissioner(meta, userId) {
  if (!userId) return false;
  return (meta?.commissioners ?? []).includes(userId);
}
function requireUser(p) {
  if (p.scheduled) return "this operation cannot run on a schedule";
  if (!p.userId) return "not authenticated";
  return null;
}
function requireTeamControl(p, teams, meta, teamId) {
  const err = requireUser(p);
  if (err) return err;
  if (isCommissioner(meta, p.userId)) return null;
  if (!controlsTeam(teams, p.userId, teamId)) return `you do not manage team ${teamId}`;
  return null;
}
function requireTeamOwner(p, teams, meta, teamId) {
  const err = requireUser(p);
  if (err) return err;
  if (isCommissioner(meta, p.userId)) return null;
  const t = teams?.[String(teamId)];
  if (!t) return `no such team: ${teamId}`;
  if (t.ownerId !== p.userId) return `only the owner of team ${teamId} can do that`;
  return null;
}
function requireCommissioner(p, meta) {
  const err = requireUser(p);
  if (err) return err;
  if (!isCommissioner(meta, p.userId)) return "commissioner only";
  return null;
}
function requireScheduled(p) {
  return p.scheduled ? null : "this operation runs on a schedule, not on request";
}

// server/main.js
var import_server_sdk5 = require("@dissent/plugin-kit/server-sdk");

// server/store.js
var import_server_sdk = require("@dissent/plugin-kit/server-sdk");
var KEY = {
  index: () => "fl:index",
  meta: (lg) => `fl:${lg}:meta`,
  teams: (lg) => `fl:${lg}:teams`,
  assets: (lg) => `fl:${lg}:assets`,
  draft: (lg) => `fl:${lg}:draft`,
  schedule: (lg, season) => `fl:${lg}:sched:${season}`,
  waivers: (lg, season, week) => `fl:${lg}:waivers:${season}:w${week}`,
  trade: (lg, id) => `fl:${lg}:trade:${id}`,
  tradeIndex: (lg) => `fl:${lg}:trades`,
  lineup: (lg, season, week, team) => `fl:${lg}:lineup:${season}:w${week}:${team}`,
  // AutoSub designations, alongside the lineup they modify. Same shape of key
  // and the same one-writer-per-key property, so a plain write is correct here
  // exactly as it is for a lineup.
  autosubs: (lg, season, week, team) => `fl:${lg}:autosub:${season}:w${week}:${team}`,
  scores: (lg, season, week) => `fl:${lg}:scores:${season}:w${week}`,
  bracket: (lg, season) => `fl:${lg}:bracket:${season}`,
  // ⚠️ ONE record for the whole league, written by EVERY team — so it is
  // contended and listed below. A per-team key would avoid that, but then
  // "who wants this player" would need a read per team on every roster render.
  tradeBlock: (lg) => `fl:${lg}:tradeblock`,
  audit: (lg, chunk) => `fl:${lg}:audit:${chunk}`
};
function read(key, fallback = null) {
  const v = import_server_sdk.storage.get(key);
  return v === null || v === void 0 ? fallback : v;
}
function mutate(key, fn, fallback = null) {
  return import_server_sdk.storage.swap(key, fn, { fallback });
}
function writeUncontended(key, value) {
  return import_server_sdk.storage.set(key, value);
}
function leagueIndex() {
  return read(KEY.index(), []);
}
function loadLeague(lg) {
  return {
    id: lg,
    meta: read(KEY.meta(lg), null),
    teams: read(KEY.teams(lg), {}),
    assets: read(KEY.assets(lg), { rosters: {}, budgets: {}, pickOwnership: [] })
  };
}

// core/league/team-identity.js
var MAX_TEAM_NAME = 60;
var FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalizeTeamName(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}
function nameKey(name) {
  return normalizeTeamName(name).toLowerCase();
}
function nameTaken(teams, name, exceptTeamId = null) {
  const want = nameKey(name);
  if (!want) return null;
  for (const [id, team] of Object.entries(teams ?? {})) {
    if (String(id) === String(exceptTeamId)) continue;
    if (nameKey(team?.name) === want) return String(id);
  }
  return null;
}
function checkTeamName(raw) {
  const name = normalizeTeamName(raw);
  if (!name) return { ok: false, error: "a team name cannot be empty" };
  if (name.length > MAX_TEAM_NAME) {
    return {
      ok: false,
      error: `a team name is at most ${MAX_TEAM_NAME} characters (that one is ${name.length})`
    };
  }
  return { ok: true, name };
}
function checkFileId(value, label = "image") {
  const v = String(value ?? "").trim();
  if (v === "") return { ok: true, fileId: "" };
  if (!FILE_ID_RE.test(v)) {
    return {
      ok: false,
      error: `${label} must be a file id from an upload to this server, not "${v.slice(0, 60)}"`
    };
  }
  return { ok: true, fileId: v.toLowerCase() };
}

// core/league/scoring.js
function scoreStatLine(stats, settings) {
  if (!stats || !settings) return 0;
  let total = 0;
  for (const key of Object.keys(stats)) {
    const weight = settings[key];
    if (typeof weight !== "number") continue;
    const value = Number(stats[key]);
    if (!Number.isFinite(value)) continue;
    total += value * weight;
  }
  return Math.round(total * 100) / 100;
}
var PPR_SCORING = Object.freeze({
  // Passing
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  pass_2pt: 2,
  // Rushing
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  // Receiving
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  // Fumbles
  fum: 0,
  fum_lost: -2,
  fum_rec: 2,
  fum_rec_td: 6,
  // Kicking
  fgm_0_19: 3,
  fgm_20_29: 3,
  fgm_30_39: 3,
  fgm_40_49: 4,
  fgm_50p: 5,
  fgmiss: -1,
  xpm: 1,
  xpmiss: -1,
  // Defense / special teams
  sack: 1,
  int: 2,
  safe: 2,
  def_td: 6,
  blk_kick: 2,
  ff: 1,
  def_st_ff: 1,
  def_st_fum_rec: 1,
  def_st_td: 6,
  st_ff: 1,
  st_fum_rec: 1,
  st_td: 6,
  // Points allowed — tiers, applied via the payload's own indicator fields
  pts_allow_0: 10,
  pts_allow_1_6: 7,
  pts_allow_7_13: 4,
  pts_allow_14_20: 1,
  pts_allow_21_27: 0,
  pts_allow_28_34: -1,
  pts_allow_35p: -4
});
var HALF_PPR_SCORING = Object.freeze({ ...PPR_SCORING, rec: 0.5 });
var STANDARD_SCORING = Object.freeze({ ...PPR_SCORING, rec: 0 });

// core/league/slots.js
var ELIGIBILITY = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  // Flex family. Each is a distinct set — they are not interchangeable.
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  // Individual defensive players. Present so an IDP league is expressible; no
  // league is required to use them.
  DL: ["DL", "DE", "DT"],
  LB: ["LB"],
  DB: ["DB", "CB", "S"],
  IDP_FLEX: ["DL", "DE", "DT", "LB", "DB", "CB", "S"]
};
var NON_SCORING_SLOTS = Object.freeze(["BN", "IR", "TAXI"]);
var KNOWN_SLOTS = Object.freeze([...Object.keys(ELIGIBILITY), ...NON_SCORING_SLOTS]);
function slotAccepts(slot, position) {
  if (!slot || !position) return false;
  if (NON_SCORING_SLOTS.includes(slot)) return true;
  const allowed = ELIGIBILITY[slot];
  if (!allowed) return false;
  return allowed.includes(position);
}
var IR_ELIGIBLE_STATUSES = Object.freeze(["IR", "PUP", "NFI", "NA", "COV", "DNR", "SUS"]);
function irEligible(status, { allowed = IR_ELIGIBLE_STATUSES } = {}) {
  const s = String(status ?? "").trim().toUpperCase();
  if (!s) return false;
  const list = Array.isArray(allowed) && allowed.length ? allowed : IR_ELIGIBLE_STATUSES;
  return list.some((a) => String(a).trim().toUpperCase() === s);
}
function splitRosterPositions(rosterPositions) {
  const all = Array.isArray(rosterPositions) ? rosterPositions : [];
  return {
    starters: all.filter((p) => !NON_SCORING_SLOTS.includes(p)),
    bench: all.filter((p) => p === "BN").length,
    ir: all.filter((p) => p === "IR").length,
    taxi: all.filter((p) => p === "TAXI").length
  };
}
function validateLineup(lineup, starterSlots, positionOf, { allowEmpty = true } = {}) {
  const errors = [];
  const slots = Array.isArray(starterSlots) ? starterSlots : [];
  const row = Array.isArray(lineup) ? lineup : [];
  if (row.length > slots.length) {
    errors.push(`lineup has ${row.length} entries for ${slots.length} starting slots`);
  }
  const seen = /* @__PURE__ */ new Map();
  slots.forEach((slot, i) => {
    const id = row[i];
    if (!id || id === "0") {
      if (!allowEmpty) errors.push(`slot ${i + 1} (${slot}) is empty`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`player ${id} is in slot ${seen.get(id) + 1} and slot ${i + 1}`);
      return;
    }
    seen.set(id, i);
    const position = positionOf?.(id) ?? null;
    if (!position) {
      errors.push(`player ${id} has no known position`);
      return;
    }
    if (!slotAccepts(slot, position)) {
      errors.push(`${position} is not eligible for slot ${i + 1} (${slot})`);
    }
  });
  return { valid: errors.length === 0, errors };
}

// core/league/settings.js
var FORMAT = Object.freeze({ REDRAFT: "redraft", KEEPER: "keeper", DYNASTY: "dynasty" });
var WAIVER_TYPE = Object.freeze({
  ROLLING: "rolling",
  // priority moves to the back after a successful claim
  REVERSE_STANDINGS: "reverse_standings",
  // priority re-derived from standings weekly
  FAAB: "faab"
  // blind bidding against a budget
});
var MAX_BENCH_SLOTS = 40;
var MAX_IR_SLOTS = 10;
var MAX_TAXI_SLOTS = 10;
var MAX_DRAFT_ROUNDS = 40;
function defaultVetoVotes(numTeams) {
  const n = Number(numTeams);
  if (!Number.isFinite(n) || n < 3) return 1;
  const eligible = Math.max(1, n - 2);
  return Math.max(1, Math.min(eligible, Math.max(2, Math.round(n / 3))));
}
var DEFAULT_SETTINGS = Object.freeze({
  name: "New League",
  format: FORMAT.REDRAFT,
  bestBall: false,
  numTeams: 12,
  rosterPositions: Object.freeze([
    "QB",
    "RB",
    "RB",
    "WR",
    "WR",
    "WR",
    "TE",
    "FLEX",
    "K",
    "DEF",
    "BN",
    "BN",
    "BN",
    "BN",
    "BN",
    "BN"
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
  playoffRoundFormat: "one",
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
  // ⚠️ A STATIC FALLBACK ONLY. `normalizeSettings` derives this from the team
  // count whenever a caller does not supply one — see `defaultVetoVotes`. This
  // value is what a 12-team league gets, which is the shape of DEFAULT_SETTINGS.
  vetoVotesNeeded: 4,
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
  draftType: "snake",
  pickTimerSeconds: 90,
  // When the draft is scheduled to happen, epoch milliseconds, or null for
  // "not scheduled yet".
  //
  // ⚠️ UTC MILLISECONDS, NEVER A LOCAL STRING OR AN HOUR. A league's managers
  // are in different timezones — that is why the feature was asked for — so any
  // representation without an absolute instant means the draft happens at a
  // different moment for each of them. Readers convert to their own zone.
  //
  // ⚠️ ADVISORY ONLY: nothing starts a draft at this time. The commissioner
  // still presses Start. Auto-starting on a clock would need the scheduler, and
  // the scheduler floor is five minutes — see the deadline-on-read note in
  // core/league/draft.js for why that cannot drive a draft.
  draftScheduledAt: null
});
function isMultiSeason(settings) {
  return settings?.format === FORMAT.DYNASTY || settings?.format === FORMAT.KEEPER;
}
function normalizeSettings(partial = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...partial };
  const positions = [...partial.rosterPositions ?? DEFAULT_SETTINGS.rosterPositions];
  if (partial.vetoVotesNeeded === void 0) {
    merged.vetoVotesNeeded = defaultVetoVotes(merged.numTeams);
  }
  const ir = reserveCount(partial, positions, "irSlots", "IR", merged);
  const taxi = reserveCount(partial, positions, "taxiSlots", "TAXI", merged);
  return {
    ...merged,
    irSlots: ir,
    taxiSlots: taxi,
    rosterPositions: setReserve(setReserve(positions, "IR", ir), "TAXI", taxi),
    scoring: { ...partial.scoring ?? DEFAULT_SETTINGS.scoring },
    // ⚠️ Copied for the same reason as `scoring`: a league editing its limits in
    // place would otherwise edit every league seeded from the frozen default.
    positionLimits: { ...partial.positionLimits ?? DEFAULT_SETTINGS.positionLimits }
  };
}
function reserveCount(partial, positions, field, token, merged) {
  const describedByArray = partial.rosterPositions !== void 0 && partial[field] === void 0;
  const n = describedByArray ? positions.filter((x) => x === token).length : Number(merged[field] ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
function setReserve(positions, token, n) {
  const kept = positions.filter((x) => x !== token);
  return [...kept, ...Array.from({ length: n }, () => token)];
}
function setRosterShape(settings, { bench, ir, taxi } = {}) {
  const s = normalizeSettings(settings);
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.trunc(Number(v))));
  let positions = [...s.rosterPositions];
  if (bench !== void 0 && Number.isFinite(Number(bench))) {
    positions = setReserve(positions, "BN", clamp(bench, MAX_BENCH_SLOTS));
    positions = setReserve(
      setReserve(positions, "IR", countOf(s.rosterPositions, "IR")),
      "TAXI",
      countOf(s.rosterPositions, "TAXI")
    );
  }
  const next = { ...s, rosterPositions: positions };
  if (ir !== void 0 && Number.isFinite(Number(ir))) next.irSlots = clamp(ir, MAX_IR_SLOTS);
  if (taxi !== void 0 && Number.isFinite(Number(taxi))) next.taxiSlots = clamp(taxi, MAX_TAXI_SLOTS);
  return normalizeSettings(next);
}
var countOf = (list, token) => (list ?? []).filter((x) => x === token).length;
function activeRosterSize(settings) {
  const { starters, bench } = splitRosterPositions(settings?.rosterPositions);
  return starters.length + bench;
}
function validateSettings(settings) {
  const s = normalizeSettings(settings);
  const errors = [];
  if (!s.name?.trim()) errors.push("league needs a name");
  if (!Object.values(FORMAT).includes(s.format)) errors.push(`unknown format: ${s.format}`);
  if (!Object.values(WAIVER_TYPE).includes(s.waiverType)) {
    errors.push(`unknown waiver type: ${s.waiverType}`);
  }
  if (!Number.isInteger(s.numTeams) || s.numTeams < 2) {
    errors.push("a league needs at least 2 teams");
  }
  if (s.numTeams % 2 === 1 && !s.medianMatchup) {
    errors.push("an odd number of teams needs medianMatchup enabled, or someone sits out every week");
  }
  const { starters } = splitRosterPositions(s.rosterPositions);
  if (starters.length === 0) errors.push("a roster needs at least one starting slot");
  if (s.playoffTeams > s.numTeams) {
    errors.push(`playoffTeams (${s.playoffTeams}) exceeds numTeams (${s.numTeams})`);
  }
  if (s.playoffTeams < 2) errors.push("a playoff needs at least 2 teams");
  if (s.playoffWeekStart <= s.startWeek) {
    errors.push("the playoffs must start after the season does");
  }
  if (s.tradeDeadlineWeek >= s.playoffWeekStart) {
    errors.push("the trade deadline must fall before the playoffs start");
  }
  if (s.waiverType === WAIVER_TYPE.FAAB && s.waiverBudget <= 0) {
    errors.push("a FAAB league needs a waiver budget above 0");
  }
  const vetoEligible = s.numTeams - 2;
  if (s.vetoVotesNeeded > vetoEligible) {
    errors.push(`vetoVotesNeeded (${s.vetoVotesNeeded}) exceeds the ${vetoEligible} teams eligible to vote on a two-team trade`);
  }
  if (!Number.isInteger(s.vetoVotesNeeded) || s.vetoVotesNeeded < 1) {
    errors.push("vetoVotesNeeded must be a whole number of at least 1");
  }
  if (!Number.isInteger(s.tradeReviewDays) || s.tradeReviewDays < 0) {
    errors.push("tradeReviewDays must be 0 (execute immediately) or a whole number of days");
  }
  const { bench, ir: irInList } = splitRosterPositions(s.rosterPositions);
  if (bench > MAX_BENCH_SLOTS) errors.push(`at most ${MAX_BENCH_SLOTS} bench slots`);
  if (!Number.isInteger(s.irSlots) || s.irSlots < 0 || s.irSlots > MAX_IR_SLOTS) {
    errors.push(`irSlots must be a whole number from 0 to ${MAX_IR_SLOTS}`);
  }
  if (!Number.isInteger(s.taxiSlots) || s.taxiSlots < 0 || s.taxiSlots > MAX_TAXI_SLOTS) {
    errors.push(`taxiSlots must be a whole number from 0 to ${MAX_TAXI_SLOTS}`);
  }
  if (irInList !== s.irSlots) {
    errors.push(`rosterPositions carries ${irInList} IR slots but irSlots says ${s.irSlots}`);
  }
  if (!Number.isInteger(s.draftRounds) || s.draftRounds < 1 || s.draftRounds > MAX_DRAFT_ROUNDS) {
    errors.push(`draftRounds must be a whole number from 1 to ${MAX_DRAFT_ROUNDS}`);
  }
  const capacity = activeRosterSize(s);
  if (s.draftRounds > capacity) {
    errors.push(`${s.draftRounds} draft rounds fills more players than the ${capacity} roster spots \u2014 add bench slots or draft fewer rounds`);
  }
  if (!Number.isInteger(s.pickTimerSeconds) || s.pickTimerSeconds < 0) {
    errors.push("pickTimerSeconds must be 0 (no clock) or a whole number of seconds");
  }
  if (s.draftScheduledAt !== null && s.draftScheduledAt !== void 0) {
    const t = s.draftScheduledAt;
    if (!Number.isFinite(t) || t < Date.UTC(2e3, 0, 1) || t > Date.UTC(2100, 0, 1)) {
      errors.push("draftScheduledAt must be a timestamp in milliseconds, or null");
    }
  }
  if (!isMultiSeason(s) && s.maxKeepers > 0) {
    errors.push("maxKeepers has no meaning in a redraft league \u2014 set format to keeper or dynasty");
  }
  if (s.format !== FORMAT.DYNASTY && s.taxiSlots > 0) {
    errors.push("taxi squads exist only in dynasty leagues");
  }
  return { valid: errors.length === 0, errors };
}
function canApplySettings(before, next, { rosters = {}, draftStatus = null } = {}) {
  const a = normalizeSettings(before ?? {});
  const b = normalizeSettings(next ?? {});
  const structural = a.rosterPositions.join() !== b.rosterPositions.join() || a.draftRounds !== b.draftRounds || a.draftType !== b.draftType || a.pickTimerSeconds !== b.pickTimerSeconds;
  if (!structural) return { ok: true, error: null };
  if (draftStatus === "active" || draftStatus === "paused") {
    return {
      ok: false,
      error: `the draft is ${draftStatus} \u2014 finish it before changing the roster or draft settings`
    };
  }
  const capacity = activeRosterSize(b);
  for (const [teamId, roster] of Object.entries(rosters ?? {})) {
    const held = (roster?.players ?? []).length;
    if (held > capacity) {
      return {
        ok: false,
        error: `team ${teamId} already holds ${held} players \u2014 ${capacity} roster spot${capacity === 1 ? "" : "s"} would strand ${held - capacity}`
      };
    }
    const onIr = (roster?.ir ?? []).length;
    if (onIr > b.irSlots) {
      return {
        ok: false,
        error: `team ${teamId} has ${onIr} on IR \u2014 ${b.irSlots} IR slot${b.irSlots === 1 ? "" : "s"} would strand ${onIr - b.irSlots}`
      };
    }
    const onTaxi = (roster?.taxi ?? []).length;
    if (onTaxi > b.taxiSlots) {
      return {
        ok: false,
        error: `team ${teamId} has ${onTaxi} on taxi \u2014 ${b.taxiSlots} would strand ${onTaxi - b.taxiSlots}`
      };
    }
  }
  return { ok: true, error: null };
}

// core/league/rosters.js
function emptyRoster() {
  return { players: [], ir: [], taxi: [] };
}
var COMPARTMENTS = ["players", "ir", "taxi"];
function allPlayers(roster) {
  if (!roster) return [];
  return COMPARTMENTS.flatMap((c) => roster[c] ?? []);
}
function ownerOf(rosters, playerId) {
  const id = String(playerId);
  for (const [teamId, roster] of Object.entries(rosters ?? {})) {
    if (allPlayers(roster).some((p) => String(p) === id)) return teamId;
  }
  return null;
}
function cloneRosters(rosters) {
  const out = {};
  for (const [teamId, roster] of Object.entries(rosters ?? {})) {
    out[teamId] = {
      players: [...roster.players ?? []],
      ir: [...roster.ir ?? []],
      taxi: [...roster.taxi ?? []]
    };
  }
  return out;
}
var fail = (rosters, error) => ({ ok: false, rosters, error });
var done = (rosters) => ({ ok: true, rosters, error: null });
function addPlayer(rosters, teamId, playerId, { compartment = "players" } = {}) {
  const team = String(teamId);
  const id = String(playerId);
  if (!rosters?.[team]) return fail(rosters, `no such team: ${team}`);
  if (!COMPARTMENTS.includes(compartment)) return fail(rosters, `no such compartment: ${compartment}`);
  const current = ownerOf(rosters, id);
  if (current) return fail(rosters, `player ${id} is already owned by team ${current}`);
  const next = cloneRosters(rosters);
  next[team][compartment].push(id);
  return done(next);
}
function dropPlayer(rosters, teamId, playerId) {
  const team = String(teamId);
  const id = String(playerId);
  if (!rosters?.[team]) return fail(rosters, `no such team: ${team}`);
  if (!allPlayers(rosters[team]).some((p) => String(p) === id)) {
    return fail(rosters, `team ${team} does not own player ${id}`);
  }
  const next = cloneRosters(rosters);
  for (const c of COMPARTMENTS) {
    next[team][c] = next[team][c].filter((p) => String(p) !== id);
  }
  return done(next);
}
function moveCompartment(rosters, teamId, playerId, compartment) {
  const team = String(teamId);
  const id = String(playerId);
  if (!rosters?.[team]) return fail(rosters, `no such team: ${team}`);
  if (!COMPARTMENTS.includes(compartment)) return fail(rosters, `no such compartment: ${compartment}`);
  if (!allPlayers(rosters[team]).some((p) => String(p) === id)) {
    return fail(rosters, `team ${team} does not own player ${id}`);
  }
  const next = cloneRosters(rosters);
  for (const c of COMPARTMENTS) next[team][c] = next[team][c].filter((p) => String(p) !== id);
  next[team][compartment].push(id);
  return done(next);
}
function executeTrade(rosters, legs) {
  if (!Array.isArray(legs) || legs.length === 0) return fail(rosters, "a trade needs at least one leg");
  const seen = /* @__PURE__ */ new Set();
  for (const leg of legs) {
    const { from, to, playerId } = leg ?? {};
    const id = String(playerId);
    if (!rosters?.[String(from)]) return fail(rosters, `no such team: ${from}`);
    if (!rosters?.[String(to)]) return fail(rosters, `no such team: ${to}`);
    if (String(from) === String(to)) return fail(rosters, `leg moves player ${id} to its own team`);
    if (seen.has(id)) return fail(rosters, `player ${id} appears in two legs of one trade`);
    seen.add(id);
    const owner = ownerOf(rosters, id);
    if (owner !== String(from)) {
      return fail(rosters, `player ${id} is owned by ${owner ?? "nobody"}, not ${from}`);
    }
  }
  let next = cloneRosters(rosters);
  for (const { from, to, playerId } of legs) {
    const id = String(playerId);
    const compartment = COMPARTMENTS.find((c) => next[String(from)][c].some((p) => String(p) === id)) ?? "players";
    for (const c of COMPARTMENTS) {
      next[String(from)][c] = next[String(from)][c].filter((p) => String(p) !== id);
    }
    next[String(to)][compartment].push(id);
  }
  return done(next);
}
function rosterCapacity(settings) {
  const positions = settings?.rosterPositions ?? [];
  return positions.filter((p) => p !== "IR" && p !== "TAXI").length;
}
function positionCounts(roster, positionOf = () => null) {
  const counts = {};
  for (const id of roster?.players ?? []) {
    const pos = positionOf(id);
    if (!pos) continue;
    counts[pos] = (counts[pos] ?? 0) + 1;
  }
  return counts;
}
function mayAddAtPosition(roster, playerId, settings, positionOf = () => null) {
  const limits = settings?.positionLimits ?? {};
  const pos = positionOf(playerId);
  if (!pos) return { ok: true };
  const max = limits[pos];
  if (!Number.isInteger(max) || max < 0) return { ok: true };
  const have = positionCounts(roster, positionOf)[pos] ?? 0;
  if (have < max) return { ok: true };
  return { ok: false, error: `this league allows at most ${max} ${pos}${max === 1 ? "" : "s"} on an active roster` };
}

// core/league/schedule.js
function generateRegularSeason(teamIds, weeks, { startWeek = 1 } = {}) {
  const teams = (teamIds ?? []).map(String);
  if (teams.length < 2 || !Number.isInteger(weeks) || weeks < 1) return [];
  const BYE = /* @__PURE__ */ Symbol("bye");
  const field = teams.length % 2 === 0 ? [...teams] : [...teams, BYE];
  const half = field.length / 2;
  const schedule = [];
  let rotation = field.slice(1);
  for (let w = 0; w < weeks; w++) {
    const round = [field[0], ...rotation];
    const matchups = [];
    for (let i = 0; i < half; i++) {
      const home = round[i];
      const away = round[round.length - 1 - i];
      if (home === BYE || away === BYE) {
        matchups.push({ home: home === BYE ? away : home, away: null, bye: true });
      } else {
        matchups.push(w % 2 === 0 ? { home, away, bye: false } : { home: away, away: home, bye: false });
      }
    }
    schedule.push({ week: startWeek + w, matchups });
    rotation = [rotation[rotation.length - 1], ...rotation.slice(0, -1)];
  }
  return schedule;
}
function seedTeams(standings = []) {
  return [...standings].sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor || String(a.teamId).localeCompare(String(b.teamId))).map((row, i) => ({ ...row, seed: i + 1 }));
}
function buildBracket(seeds) {
  const n = seeds.length;
  if (n < 2) return { rounds: [], byes: [] };
  const size = 2 ** Math.ceil(Math.log2(n));
  const byeCount = size - n;
  const byes = seeds.slice(0, byeCount);
  const playing = seeds.slice(byeCount);
  const games = [];
  for (let i = 0; i < playing.length / 2; i++) {
    games.push({
      home: playing[i],
      away: playing[playing.length - 1 - i],
      winner: null
    });
  }
  return { rounds: [games], byes };
}
function consolationSeeds(standings = [], playoffTeams = 0) {
  const cut = Math.max(0, Number(playoffTeams) || 0);
  const missed = standings.slice(cut);
  if (missed.length < 2) return [];
  return missed.map((row, i) => ({ ...row, seed: i + 1, overallSeed: row.seed ?? cut + i + 1 }));
}
function advanceBracket(bracket, { reseed = true } = {}) {
  const round = bracket.rounds[bracket.rounds.length - 1] ?? [];
  if (round.length === 0) return bracket;
  if (round.some((g) => !g.winner)) return bracket;
  let survivors = [...bracket.byes, ...round.map((g) => g.winner)];
  if (survivors.length < 2) return bracket;
  if (reseed) survivors.sort((a, b) => a.seed - b.seed);
  const games = [];
  for (let i = 0; i < survivors.length / 2; i++) {
    games.push({ home: survivors[i], away: survivors[survivors.length - 1 - i], winner: null });
  }
  return { rounds: [...bracket.rounds, games], byes: [] };
}
function bracketChampion(bracket) {
  const last = bracket.rounds[bracket.rounds.length - 1] ?? [];
  if (last.length === 1 && last[0].winner) return last[0].winner;
  return null;
}
function buildStandings(teamIds, results = [], { medianMatchup = false } = {}) {
  const table = {};
  for (const id of teamIds ?? []) {
    table[String(id)] = { teamId: String(id), wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
  }
  const byWeek = /* @__PURE__ */ new Map();
  for (const r of results) {
    if (!byWeek.has(r.week)) byWeek.set(r.week, []);
    byWeek.get(r.week).push(r);
  }
  for (const [, weekResults] of byWeek) {
    for (const r of weekResults) {
      const home = table[String(r.home)];
      if (!home) continue;
      home.pointsFor += Number(r.homePoints) || 0;
      if (r.away === null || r.away === void 0) continue;
      const away = table[String(r.away)];
      if (!away) continue;
      away.pointsFor += Number(r.awayPoints) || 0;
      home.pointsAgainst += Number(r.awayPoints) || 0;
      away.pointsAgainst += Number(r.homePoints) || 0;
      if (r.homePoints > r.awayPoints) {
        home.wins++;
        away.losses++;
      } else if (r.homePoints < r.awayPoints) {
        away.wins++;
        home.losses++;
      } else {
        home.ties++;
        away.ties++;
      }
    }
    if (medianMatchup) applyMedian(table, weekResults);
  }
  return Object.values(table);
}
function applyMedian(table, weekResults) {
  const scores = [];
  for (const r of weekResults) {
    if (table[String(r.home)]) scores.push([String(r.home), Number(r.homePoints) || 0]);
    if (r.away !== null && r.away !== void 0 && table[String(r.away)]) {
      scores.push([String(r.away), Number(r.awayPoints) || 0]);
    }
  }
  if (scores.length === 0) return;
  const sorted = scores.map(([, s]) => s).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
  for (const [teamId, score] of scores) {
    if (score > median) table[teamId].wins++;
    else if (score < median) table[teamId].losses++;
    else table[teamId].ties++;
  }
}

// server/ops-scoring.js
var import_server_sdk2 = require("@dissent/plugin-kit/server-sdk");

// core/league/lineup.js
var FORBIDDEN = 1e9;
function hungarian(cost, n, m) {
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  return p;
}
function optimalLineup(players, starterSlots, pointsOf, positionOf) {
  const slots = Array.isArray(starterSlots) ? starterSlots : [];
  const ids = [...new Set((players ?? []).map(String))];
  const empty = slots.map((slot) => ({ slot, playerId: null, points: 0 }));
  if (slots.length === 0 || ids.length === 0) return empty;
  const n = slots.length;
  const m = Math.max(n, ids.length);
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(FORBIDDEN));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= ids.length; j++) {
      const id = ids[j - 1];
      const position = positionOf?.(id) ?? null;
      if (position && slotAccepts(slots[i - 1], position)) {
        const pts = Number(pointsOf?.(id) ?? 0);
        cost[i][j] = Number.isFinite(pts) ? -pts : 0;
      }
    }
  }
  const assignment = hungarian(cost, n, m);
  const rows = empty.map((r) => ({ ...r }));
  for (let j = 1; j <= m; j++) {
    const i = assignment[j];
    if (!i || i > n) continue;
    if (j > ids.length || cost[i][j] >= FORBIDDEN) continue;
    rows[i - 1] = { slot: slots[i - 1], playerId: ids[j - 1], points: -cost[i][j] };
  }
  return rows;
}
function setLineupPoints(lineup, starterSlots, pointsOf, positionOf) {
  const slots = Array.isArray(starterSlots) ? starterSlots : [];
  const row = Array.isArray(lineup) ? lineup : [];
  let total = 0;
  const rows = slots.map((slot, i) => {
    const id = row[i];
    if (!id || id === "0") return { slot, playerId: null, points: 0 };
    const position = positionOf?.(String(id)) ?? null;
    if (!position || !slotAccepts(slot, position)) {
      return { slot, playerId: String(id), points: 0, illegal: true };
    }
    const pts = Number(pointsOf?.(String(id)) ?? 0);
    const points = Number.isFinite(pts) ? pts : 0;
    total += points;
    return { slot, playerId: String(id), points };
  });
  return { rows, total: round2(total) };
}
function weeklyPoints({ players, lineup, starterSlots, pointsOf, positionOf, bestBall = false }) {
  if (bestBall) {
    const rows = optimalLineup(players, starterSlots, pointsOf, positionOf);
    return { rows, total: round2(rows.reduce((s, r) => s + r.points, 0)), bestBall: true };
  }
  return { ...setLineupPoints(lineup, starterSlots, pointsOf, positionOf), bestBall: false };
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// core/league/autosubs.js
function subEligible({ starterSlot, subPosition } = {}) {
  if (!starterSlot || !subPosition) return false;
  if (NON_SCORING_SLOTS.includes(starterSlot)) return false;
  return slotAccepts(starterSlot, subPosition);
}
function validateAutoSubs({
  subs = {},
  lineup = [],
  starterSlots = [],
  positionOf = () => null,
  roster = [],
  maxSubs = 0
} = {}) {
  const pairs = Object.entries(subs ?? {});
  if (pairs.length === 0) return { ok: true };
  if (!Number.isInteger(maxSubs) || maxSubs <= 0) {
    return { ok: false, error: "AutoSubs are not enabled in this league." };
  }
  if (pairs.length > maxSubs) {
    return {
      ok: false,
      error: `This league allows at most ${maxSubs} AutoSub${maxSubs === 1 ? "" : "s"} per week.`
    };
  }
  const held = new Set(roster.map(String));
  const starting = new Set(lineup.filter(Boolean).map(String));
  const usedSubs = /* @__PURE__ */ new Set();
  for (const [starterId, subId] of pairs) {
    const s = String(starterId);
    const b = String(subId);
    const idx = lineup.findIndex((x) => String(x ?? "") === s);
    if (idx === -1) return { ok: false, error: `${s} is not in the lineup.` };
    if (!held.has(b)) return { ok: false, error: `${b} is not on the roster.` };
    if (starting.has(b)) return { ok: false, error: `${b} is already starting.` };
    if (usedSubs.has(b)) {
      return { ok: false, error: `${b} cannot back up more than one starter.` };
    }
    usedSubs.add(b);
    if (!subEligible({ starterSlot: starterSlots[idx], subPosition: positionOf(b) })) {
      return { ok: false, error: `${b} cannot back up a ${starterSlots[idx]} slot.` };
    }
  }
  return { ok: true };
}
function playedThisWeek(statLine) {
  if (!statLine) return false;
  return Number(statLine.gp) === 1;
}
function resolveAutoSubs({
  lineup = [],
  starterSlots = [],
  subs = {},
  statsOf = () => null
} = {}) {
  const out = [...lineup];
  const applied = [];
  if (!subs || Object.keys(subs).length === 0) return { lineup: out, applied };
  for (const [starterId, subId] of Object.entries(subs)) {
    const idx = out.findIndex((x) => String(x ?? "") === String(starterId));
    if (idx === -1) continue;
    if (playedThisWeek(statsOf(starterId))) continue;
    if (!playedThisWeek(statsOf(subId))) continue;
    applied.push({ slot: starterSlots[idx], out: String(starterId), in: String(subId) });
    out[idx] = String(subId);
  }
  return { lineup: out, applied };
}

// core/league/season-clock.js
function shouldAdvance(meta, state) {
  const no = (reason) => ({ advance: false, to: null, reason });
  if (!meta) return no("no league");
  if (meta.settings?.autoAdvanceWeek === false) return no("auto-advance is off for this league");
  const type = String(state?.season_type ?? "");
  if (type !== "regular" && type !== "post") return no(`season_type is ${type || "unknown"}`);
  if (Number(state?.season) !== Number(meta.season)) {
    return no(`league season ${meta.season} is not the live season ${state?.season}`);
  }
  const live = Number(state?.week);
  if (!Number.isInteger(live) || live < 1) return no("no live week");
  const current = Number(meta.currentWeek ?? 0);
  if (live <= current) return no("already at or past the live week");
  return { advance: true, to: live, reason: `advancing ${current || "preseason"} -> ${live}` };
}

// core/league/score-backoff.js
var BASE_MS = 5 * 60 * 1e3;
var CAP_MS = 20 * 60 * 1e3;
var MAX_STREAK = 8;
function fingerprintOf(results = {}) {
  return Object.keys(results).sort().map((t) => `${t}:${results[t]?.total ?? 0}`).join("|");
}
function isDue(prev, now = Date.now()) {
  if (!prev || typeof prev.nextScoreAt !== "number") return true;
  return now >= prev.nextScoreAt;
}
function nextBackoff(prev, fingerprint, now = Date.now()) {
  const unchanged = Boolean(prev) && prev.fingerprint === fingerprint;
  const quietRuns = unchanged ? Math.min((prev.quietRuns ?? 0) + 1, MAX_STREAK) : 0;
  const wait = Math.min(BASE_MS * 2 ** quietRuns, CAP_MS);
  return { quietRuns, wait, nextScoreAt: now + wait };
}

// core/league/lineup-carry.js
function effectiveLineup(readWeek, week, held) {
  const own = readWeek(week);
  if (isSet(own)) return { ...own, lineup: own.lineup, carriedFrom: null };
  const onRoster = new Set([...held].map(String));
  for (let w = week - 1; w >= 1; w--) {
    const prev = readWeek(w);
    if (!isSet(prev)) continue;
    return {
      lineup: prev.lineup.map((id) => id && onRoster.has(String(id)) ? String(id) : null),
      setAt: null,
      setBy: null,
      carriedFrom: w
    };
  }
  return { lineup: [], setAt: null, setBy: null, carriedFrom: null };
}
function isSet(rec) {
  return Boolean(rec && Array.isArray(rec.lineup) && rec.setAt != null);
}

// server/lineup-read.js
function lineupFor(lg, season, week, teamId, assets) {
  const roster = assets?.rosters?.[teamId] ?? {};
  return effectiveLineup(
    (w) => read(KEY.lineup(lg, season, w, teamId), null),
    week,
    [...roster.players ?? [], ...roster.ir ?? []]
  );
}

// server/ops-scoring.js
var refuse = (msg) => {
  throw new Error(msg);
};
var POSITIONS_KEY = "fl:positions";
var INDEX_URL = "https://plugins.dissent.chat/plugins/nfl-hub/assets/players.index.json";
var STATS_URL = (season, week) => `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`;
function refreshPositions({ p, payload }) {
  if (!p.scheduled) {
    const lg = String(payload?.leagueId ?? "");
    const meta = lg ? read(KEY.meta(lg), null) : null;
    const err = requireCommissioner(p, meta);
    if (err) refuse(err);
  }
  const index = (0, import_server_sdk2.fetchJSON)({ url: INDEX_URL });
  const map = {};
  const injuries = {};
  for (const [id, rec] of Object.entries(index ?? {})) {
    if (rec?.p) map[id] = rec.p;
    if (rec?.i) injuries[id] = String(rec.i);
  }
  if (Object.keys(map).length === 0) refuse("player index returned no positions");
  writeUncontended(POSITIONS_KEY, {
    map,
    injuries,
    refreshedAt: Date.now(),
    count: Object.keys(map).length
  });
  return { positions: Object.keys(map).length, injuries: Object.keys(injuries).length };
}
function positionMap() {
  return read(POSITIONS_KEY, { map: {} }).map ?? {};
}
function injuryMap() {
  const rec = read(POSITIONS_KEY, null);
  if (!rec || !rec.injuries) return null;
  return rec.injuries;
}
function scoreWeekForLeague({ p, payload }) {
  const err = requireScheduled(p);
  if (err) refuse(err);
  return runScoring(String(payload?.leagueId ?? ""), payload?.season, payload?.week, { force: true });
}
var statsMemo = /* @__PURE__ */ new Map();
function weeklyStats(season, week) {
  const key = `${season}:${week}`;
  if (!statsMemo.has(key)) {
    statsMemo.set(key, (0, import_server_sdk2.fetchJSON)({ url: STATS_URL(season, week) }));
  }
  return statsMemo.get(key);
}
function runScoring(lg, seasonIn, weekIn, { force = false } = {}) {
  if (!lg) refuse("leagueId required");
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(seasonIn ?? meta.season);
  const week = Number(weekIn ?? meta.currentWeek);
  if (!Number.isInteger(week) || week < 1) return { skipped: "no current week" };
  const prev = read(KEY.scores(lg, season, week), null);
  if (prev?.final) return { season, week, skipped: "final" };
  if (!force && !isDue(prev)) {
    return { season, week, skipped: "not due", dueIn: prev.nextScoreAt - Date.now() };
  }
  const stats = weeklyStats(season, week);
  const positions = positionMap();
  const { starters } = splitRosterPositions(meta.settings?.rosterPositions);
  const scoring = meta.settings?.scoring ?? {};
  const pointsOf = (id) => scoreStatLine(stats?.[String(id)] ?? null, scoring);
  const positionOf = (id) => positions[String(id)] ?? null;
  const results = {};
  for (const teamId of Object.keys(teams)) {
    const roster = assets.rosters?.[teamId] ?? { players: [], ir: [], taxi: [] };
    const stored = lineupFor(lg, season, week, teamId, assets);
    let lineup = stored.lineup ?? [];
    let applied = [];
    if (!meta.settings?.bestBall && Number(meta.settings?.autoSubsPerWeek ?? 0) > 0) {
      const designations = read(KEY.autosubs(lg, season, week, teamId), { subs: {} }).subs ?? {};
      const resolved = resolveAutoSubs({
        lineup,
        starterSlots: starters,
        subs: designations,
        statsOf: (id) => stats?.[String(id)] ?? null
      });
      lineup = resolved.lineup;
      applied = resolved.applied;
    }
    const out = weeklyPoints({
      players: roster.players ?? [],
      lineup,
      starterSlots: starters,
      pointsOf,
      positionOf,
      bestBall: Boolean(meta.settings?.bestBall)
    });
    results[teamId] = {
      total: out.total,
      bestBall: out.bestBall,
      rows: out.rows.map((r) => ({ slot: r.slot, playerId: r.playerId, points: r.points })),
      ...applied.length > 0 ? { autoSubs: applied } : {}
    };
  }
  const fingerprint = fingerprintOf(results);
  const { quietRuns, nextScoreAt } = nextBackoff(prev, fingerprint);
  mutate(KEY.scores(lg, season, week), (cur) => {
    if (cur?.final) return cur;
    return {
      ...cur?.reopenedAt ? { reopenedAt: cur.reopenedAt, reopenedBy: cur.reopenedBy } : {},
      // Kept so the finality step need not re-fetch the scoreboard every tick (ops-finality.js).
      ...Number.isFinite(cur?.lockAt) ? { lockAt: cur.lockAt } : {},
      season,
      week,
      scoredAt: Date.now(),
      teams: results,
      fingerprint,
      quietRuns,
      nextScoreAt
    };
  }, null);
  return {
    season,
    week,
    teams: Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.total]))
  };
}
function getScores({ payload }) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week ?? meta.currentWeek);
  return read(KEY.scores(lg, season, week), { season, week, scoredAt: null, teams: {} });
}
function setCurrentWeek({ p, payload }) {
  const lg = String(payload?.leagueId ?? "");
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);
  const week = Number(payload?.week);
  if (!Number.isInteger(week) || week < 1) refuse("week must be a positive integer");
  mutate(KEY.meta(lg), (m) => ({ ...m, currentWeek: week }), meta);
  return { currentWeek: week };
}
function positionsAreStale() {
  const rec = read(POSITIONS_KEY, null);
  if (!rec) return true;
  return Date.now() - (rec.refreshedAt ?? 0) > 7 * 24 * 60 * 60 * 1e3;
}
function getStandings({ payload }) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const schedule = read(KEY.schedule(lg, season), null);
  const teamIds = Object.keys(teams);
  if (!schedule) {
    return { season, weeks: 0, standings: buildStandings(teamIds, []), scheduled: false };
  }
  const results = [];
  let scoredWeeks = 0;
  let throughWeek = null;
  for (const week of schedule.weeks ?? []) {
    const scores = read(KEY.scores(lg, season, week.week), null);
    if (!scores?.final) continue;
    scoredWeeks++;
    throughWeek = Math.max(throughWeek ?? 0, week.week);
    for (const m of week.matchups ?? []) {
      const home = scores.teams?.[m.home];
      if (m.bye || !m.away) {
        if (home) results.push({ week: week.week, home: m.home, away: null, homePoints: home.total, awayPoints: 0 });
        continue;
      }
      const away = scores.teams?.[m.away];
      if (!home || !away) continue;
      results.push({
        week: week.week,
        home: m.home,
        away: m.away,
        homePoints: home.total,
        awayPoints: away.total
      });
    }
  }
  const table = buildStandings(teamIds, results, {
    medianMatchup: Boolean(meta.settings?.medianMatchup)
  });
  return {
    season,
    weeks: scoredWeeks,
    throughWeek,
    scheduled: true,
    // Seeded here too, so a client rendering a playoff line does not re-rank and
    // risk disagreeing about the cut.
    standings: seedTeams(table)
  };
}
var STATE_URL = "https://api.sleeper.app/v1/state/nfl";
function nflState() {
  return (0, import_server_sdk2.fetchJSON)({ url: STATE_URL });
}
function advanceWeekIfDue(lg, state) {
  const meta = read(KEY.meta(lg), null);
  const verdict = shouldAdvance(meta, state);
  if (!verdict.advance) return { skipped: verdict.reason };
  const live = verdict.to;
  const current = Number(meta.currentWeek ?? 0);
  let finalized = null;
  if (current >= 1) {
    try {
      finalized = runScoring(lg, meta.season, current, { force: true });
    } catch (err) {
      finalized = { error: String(err.message ?? err) };
    }
  }
  mutate(KEY.meta(lg), (m) => ({ ...m, currentWeek: live }), meta);
  return { advanced: { from: current || null, to: live }, finalized };
}
function backfillOneWeek(lg) {
  const meta = read(KEY.meta(lg), null);
  if (!meta) return null;
  const season = Number(meta.season);
  const current = Number(meta.currentWeek ?? 0);
  if (current < 2) return null;
  const schedule = read(KEY.schedule(lg, season), null);
  const start = Number(schedule?.startWeek ?? meta.settings?.startWeek ?? 1);
  for (let week = start; week < current; week++) {
    if (read(KEY.scores(lg, season, week), null)) continue;
    try {
      const result = runScoring(lg, season, week, { force: true });
      return { week, result };
    } catch (err) {
      return { week, error: String(err.message ?? err) };
    }
  }
  return null;
}

// core/league/trade-block.js
function pickKey(pick) {
  if (!pick) return "";
  return `${pick.season ?? ""}:${pick.round ?? ""}:${pick.slot ?? ""}`;
}
function setBlock(block = {}, teamId, { players = [], picks = [] } = {}, owns = () => true) {
  const id = String(teamId ?? "");
  if (!id) return { ...block };
  const nextPlayers = [...new Set(players.map(String))].filter((p) => owns(id, p));
  const seen = /* @__PURE__ */ new Set();
  const nextPicks = [];
  for (const p of picks) {
    const k = pickKey(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    nextPicks.push({ season: p.season, round: p.round, slot: String(p.slot) });
  }
  const next = { ...block };
  if (nextPlayers.length === 0 && nextPicks.length === 0) {
    delete next[id];
    return next;
  }
  next[id] = { players: nextPlayers, picks: nextPicks };
  return next;
}
function setInterest(interest = {}, teamId, playerIds = [], ownerOf2 = () => null) {
  const id = String(teamId ?? "");
  if (!id) return { ...interest };
  const wanted = [...new Set(playerIds.map(String))].filter((p) => String(ownerOf2(p) ?? "") !== id);
  const next = { ...interest };
  if (wanted.length === 0) delete next[id];
  else next[id] = wanted;
  return next;
}
function interestCounts(interest = {}) {
  const counts = {};
  for (const wanted of Object.values(interest ?? {})) {
    for (const p of new Set((wanted ?? []).map(String))) {
      counts[p] = (counts[p] ?? 0) + 1;
    }
  }
  return counts;
}

// core/league/waiver-wire.js
var DROP_DESTINATION = Object.freeze({
  WAIVERS: "waivers",
  FREE_AGENCY: "free_agency"
});
var FA_HOLD_MS = 24 * 60 * 60 * 1e3;
function waiversEnabled(settings) {
  const days = Number(settings?.waiverClearDays);
  return Number.isFinite(days) && days > 0;
}
function dropDestination({ acquired = {}, playerId, now = 0, settings } = {}) {
  if (!waiversEnabled(settings)) return DROP_DESTINATION.FREE_AGENCY;
  const rec = acquired?.[String(playerId)];
  if (rec && rec.via === "free_agency" && Number.isFinite(Number(rec.at)) && now - Number(rec.at) < FA_HOLD_MS) {
    return DROP_DESTINATION.FREE_AGENCY;
  }
  return DROP_DESTINATION.WAIVERS;
}
function wireClearsAt(now = 0, settings) {
  const days = Number(settings?.waiverClearDays) || 0;
  return now + days * 24 * 60 * 60 * 1e3;
}
function placeOnWire(wire = {}, playerId, { clearsAt, droppedBy = null, droppedAt = 0 } = {}) {
  const id = String(playerId ?? "");
  if (!id) return { ...wire };
  return { ...wire, [id]: { clearsAt, droppedBy: droppedBy ? String(droppedBy) : null, droppedAt } };
}
function removeFromWire(wire = {}, playerId) {
  const next = { ...wire };
  delete next[String(playerId ?? "")];
  return next;
}
function onWaivers(wire = {}, playerId, now = 0) {
  const rec = wire?.[String(playerId ?? "")];
  return Boolean(rec) && Number(rec.clearsAt) > now;
}
function wirePlayers(wire = {}, now = 0) {
  return Object.entries(wire ?? {}).filter(([, rec]) => Number(rec?.clearsAt) > now).map(([playerId, rec]) => ({ playerId, ...rec })).sort((a, b) => a.clearsAt - b.clearsAt || a.playerId.localeCompare(b.playerId));
}
function clearExpired(wire = {}, now = 0) {
  const next = {};
  const cleared = [];
  for (const [playerId, rec] of Object.entries(wire ?? {})) {
    if (Number(rec?.clearsAt) > now) next[playerId] = rec;
    else cleared.push(playerId);
  }
  return { wire: next, cleared: cleared.sort() };
}
function recordAcquisition(acquired = {}, playerId, { at = 0, via = "free_agency" } = {}) {
  const id = String(playerId ?? "");
  if (!id) return { ...acquired };
  return { ...acquired, [id]: { at, via } };
}
function forgetAcquisition(acquired = {}, playerId) {
  const next = { ...acquired };
  delete next[String(playerId ?? "")];
  return next;
}

// server/ops-league.js
var refuse2 = (msg) => {
  throw new Error(msg);
};
function createLeague({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse2(err);
  const settings = normalizeSettings(payload?.settings ?? {});
  const check = validateSettings(settings);
  if (!check.valid) refuse2(`invalid settings: ${check.errors.join("; ")}`);
  const proposed = payload?.leagueId ? String(payload.leagueId) : null;
  if (proposed && !/^[a-zA-Z0-9_-]{1,40}$/.test(proposed)) {
    refuse2("leagueId must be 1-40 characters of [A-Za-z0-9_-]");
  }
  const id = proposed ?? `lg${Date.now().toString(36)}`;
  if (read(KEY.meta(id), null)) refuse2(`league ${id} already exists`);
  mutate(KEY.index(), (list) => {
    const list2 = list ?? [];
    return list2.includes(id) ? list2 : [...list2, id];
  }, []);
  mutate(KEY.meta(id), () => ({
    id,
    settings,
    commissioners: [p.userId],
    season: payload?.season ?? (/* @__PURE__ */ new Date()).getUTCFullYear(),
    createdAt: Date.now(),
    createdBy: p.userId
  }), null);
  mutate(KEY.teams(id), () => ({}), {});
  mutate(KEY.assets(id), () => ({ rosters: {}, budgets: {}, pickOwnership: [] }), null);
  return { leagueId: id, settings };
}
function listLeagues({ p }) {
  return leagueIndex().map((id) => {
    const meta = read(KEY.meta(id), null);
    const teams = read(KEY.teams(id), {});
    return {
      id,
      name: meta?.settings?.name ?? id,
      season: meta?.season ?? null,
      format: meta?.settings?.format ?? null,
      teamCount: Object.keys(teams).length,
      myTeams: teamsOf(teams, p.userId),
      isCommissioner: isCommissioner(meta, p.userId)
    };
  });
}
function getLeague({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  return {
    id: lg,
    settings: meta.settings,
    season: meta.season,
    // The UI renders the week and every week-scoped call is keyed on it, so
    // omitting it made every league look like it was in preseason forever.
    currentWeek: meta.currentWeek ?? null,
    // ⚠️ RETURNED EXPLICITLY. `meta` is not spread into this payload — it carries
    // the commissioner list and creation provenance — so a field added to meta and
    // not added here is stored, never read, and looks broken from the browser.
    // That is the `fromSleeperSettings` shape of bug: a capability with no caller.
    bannerFileId: meta.bannerFileId ?? null,
    commissioners: meta.commissioners,
    teams: redactTeamPrivacy(teams, meta, p.userId),
    assets,
    myTeams: teamsOf(teams, p.userId),
    isCommissioner: isCommissioner(meta, p.userId),
    // ⚠️ The caller's OWN verified id. `myTeams` cannot tell owning a team apart
    // from co-owning one — `teamsOf` returns both — and the co-ownership UI has
    // to, because only an owner may approve or remove anybody.
    me: p.userId
  };
}
function redactTeamPrivacy(teams, meta, userId) {
  const commish = isCommissioner(meta, userId);
  const out = {};
  for (const [id, team] of Object.entries(teams ?? {})) {
    const pending = (team.coOwnerRequests ?? []).map((r) => typeof r === "string" ? { userId: r, label: "", at: 0 } : r);
    const maySee = commish || team.ownerId === userId;
    out[id] = {
      ...team,
      coOwnerRequests: maySee ? pending : pending.filter((r) => r.userId === userId),
      // ⚠️ Named explicitly, like requests: an unnamed new field goes to EVERYBODY.
      // An invite says an owner approached somebody, which is between those two.
      coOwnerInvites: maySee ? team.coOwnerInvites ?? [] : (team.coOwnerInvites ?? []).filter((i) => i.userId === userId)
    };
  }
  return out;
}
function joinLeague({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse2(err);
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse2(`no such league: ${lg}`);
  let name = `Team ${p.userId.slice(0, 6)}`;
  if (String(payload?.teamName ?? "").trim()) {
    const check = checkTeamName(payload.teamName);
    if (!check.ok) refuse2(check.error);
    name = check.name;
  }
  let assigned = null;
  mutate(KEY.teams(lg), (teams) => {
    const current = teams ?? {};
    const mine = teamsOf(current, p.userId);
    if (mine.length > 0) {
      assigned = mine[0];
      return current;
    }
    if (Object.keys(current).length >= (meta.settings?.numTeams ?? 12)) {
      refuse2("this league is full");
    }
    const clash = nameTaken(current, name);
    if (clash) refuse2(`"${name}" clashes with team ${clash} ("${current[clash].name}") \u2014 pick another`);
    const teamId = `t${Object.keys(current).length + 1}`;
    assigned = teamId;
    return { ...current, [teamId]: { id: teamId, name, ownerId: p.userId, coOwners: [] } };
  }, {});
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    if (assets.rosters[assigned]) return assets;
    return {
      ...assets,
      rosters: { ...assets.rosters, [assigned]: emptyRoster() },
      budgets: { ...assets.budgets, [assigned]: meta.settings?.waiverBudget ?? 0 }
    };
  }, null);
  return { leagueId: lg, teamId: assigned };
}
function updateSettings({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, assets } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse2(err);
  const incoming = { ...payload?.settings ?? {} };
  const { benchSlots, irSlots, taxiSlots, rosterPositions, ...rules } = incoming;
  if (rosterPositions !== void 0) {
    refuse2("roster shape is set with benchSlots / irSlots / taxiSlots, not rosterPositions");
  }
  const shaped = setRosterShape({ ...meta.settings, ...rules }, {
    bench: benchSlots,
    ir: irSlots,
    taxi: taxiSlots
  });
  const next = normalizeSettings(shaped);
  const check = validateSettings(next);
  if (!check.valid) refuse2(`invalid settings: ${check.errors.join("; ")}`);
  const draft = read(KEY.draft(lg), null);
  const applies = canApplySettings(meta.settings, next, {
    rosters: assets?.rosters ?? {},
    draftStatus: draft?.status ?? null
  });
  if (!applies.ok) refuse2(applies.error);
  mutate(KEY.meta(lg), (m) => ({ ...m, settings: next }), meta);
  return { settings: next };
}
function setLineup({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse2(err);
  const week = Number(payload?.week);
  const season = Number(payload?.season ?? meta.season);
  if (!Number.isInteger(week) || week < 1) refuse2("week must be a positive integer");
  const lineup = Array.isArray(payload?.lineup) ? payload.lineup.map((x) => x == null ? null : String(x)) : [];
  const { starters } = splitRosterPositions(meta.settings?.rosterPositions);
  const held = new Set([
    ...assets.rosters?.[teamId]?.players ?? [],
    ...assets.rosters?.[teamId]?.ir ?? []
  ].map(String));
  for (const id of lineup) {
    if (id && id !== "0" && !held.has(id)) refuse2(`player ${id} is not on team ${teamId}`);
  }
  const positions = positionMap();
  if (Object.keys(positions).length === 0) {
    refuse2("player positions are not loaded yet \u2014 try again shortly");
  }
  const check = validateLineup(lineup, starters, (id) => positions[String(id)] ?? null);
  if (!check.valid) refuse2(check.errors.join("; "));
  writeUncontended(KEY.lineup(lg, season, week, teamId), { lineup, setAt: Date.now(), setBy: p.userId });
  return { leagueId: lg, teamId, season, week, lineup };
}
function getLineup({ payload }) {
  const lg = requireLeagueId(payload);
  const { meta, assets } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const teamId = String(payload?.teamId ?? "");
  return lineupFor(lg, season, week, teamId, assets);
}
function setAutoSubs({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse2(err);
  const week = Number(payload?.week);
  const season = Number(payload?.season ?? meta.season);
  if (!Number.isInteger(week) || week < 1) refuse2("week must be a positive integer");
  const maxSubs = Number(meta.settings?.autoSubsPerWeek ?? 0);
  if (!Number.isInteger(maxSubs) || maxSubs <= 0) {
    refuse2("AutoSubs are not enabled in this league");
  }
  const raw = payload?.subs && typeof payload.subs === "object" ? payload.subs : {};
  const subs = {};
  for (const [starterId, subId] of Object.entries(raw)) {
    if (starterId == null || subId == null) continue;
    subs[String(starterId)] = String(subId);
  }
  const roster = assets.rosters?.[teamId] ?? { players: [], ir: [], taxi: [] };
  if (Object.keys(subs).length > 0) {
    const held = (roster.players ?? []).length;
    const capacity = rosterCapacity(meta.settings);
    if (capacity > 0 && held > capacity) {
      refuse2(`roster is over the limit (${held}/${capacity}) \u2014 clear it before setting AutoSubs`);
    }
  }
  const stored = lineupFor(lg, season, week, teamId, assets);
  const { starters } = splitRosterPositions(meta.settings?.rosterPositions);
  const positions = positionMap();
  if (Object.keys(positions).length === 0) {
    refuse2("player positions are not loaded yet \u2014 try again shortly");
  }
  const check = validateAutoSubs({
    subs,
    lineup: stored.lineup ?? [],
    starterSlots: starters,
    positionOf: (id) => positions[String(id)] ?? null,
    roster: [...roster.players ?? [], ...roster.ir ?? []],
    maxSubs
  });
  if (!check.ok) refuse2(check.error);
  writeUncontended(KEY.autosubs(lg, season, week, teamId), {
    subs,
    setAt: Date.now(),
    setBy: p.userId
  });
  return { leagueId: lg, teamId, season, week, subs };
}
function getAutoSubs({ payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse2(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const teamId = String(payload?.teamId ?? "");
  return read(KEY.autosubs(lg, season, week, teamId), { subs: {}, setAt: null, setBy: null });
}
function setTradeBlock({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse2(err);
  const rosters = assets.rosters ?? {};
  const ownerOf2 = (playerId) => {
    const id = String(playerId);
    for (const [t, r] of Object.entries(rosters)) {
      if ((r?.players ?? []).map(String).includes(id)) return String(t);
      if ((r?.ir ?? []).map(String).includes(id)) return String(t);
      if ((r?.taxi ?? []).map(String).includes(id)) return String(t);
    }
    return null;
  };
  const owns = (t, playerId) => ownerOf2(playerId) === String(t);
  const players = Array.isArray(payload?.players) ? payload.players.map(String) : [];
  const picks = Array.isArray(payload?.picks) ? payload.picks : [];
  const interested = Array.isArray(payload?.interest) ? payload.interest.map(String) : [];
  const touchesBlock = payload?.players !== void 0 || payload?.picks !== void 0;
  const touchesInterest = payload?.interest !== void 0;
  mutate(KEY.tradeBlock(lg), (cur) => {
    const state = cur ?? { block: {}, interest: {} };
    let block = state.block ?? {};
    let interest = state.interest ?? {};
    if (touchesBlock) block = setBlock(block, teamId, { players, picks }, owns);
    if (touchesInterest) interest = setInterest(interest, teamId, interested, ownerOf2);
    return { block, interest };
  }, { block: {}, interest: {} });
  const settled = read(KEY.tradeBlock(lg), { block: {}, interest: {} });
  return {
    leagueId: lg,
    teamId,
    block: settled.block?.[teamId] ?? { players: [], picks: [] },
    counts: interestCounts(settled.interest ?? {})
  };
}
function getTradeBlock({ payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse2(`no such league: ${lg}`);
  const state = read(KEY.tradeBlock(lg), { block: {}, interest: {} });
  return {
    block: state.block ?? {},
    interest: state.interest ?? {},
    counts: interestCounts(state.interest ?? {})
  };
}
function addFreeAgent({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse2(err);
  if (meta.settings?.addsEnabled === false) refuse2("adds are disabled in this league");
  const playerId = String(payload?.playerId ?? "");
  if (!playerId) refuse2("playerId required");
  const dropId = payload?.dropPlayerId ? String(payload.dropPlayerId) : null;
  const now = Date.now();
  let result = null;
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    let rosters = assets.rosters;
    let swapWire = assets.wire ?? {};
    let swapDest = null;
    if (dropId) {
      const dropped = dropPlayer(rosters, teamId, dropId);
      if (!dropped.ok) refuse2(dropped.error);
      rosters = dropped.rosters;
      swapDest = dropDestination({
        acquired: assets.acquired ?? {},
        playerId: dropId,
        now,
        settings: meta.settings
      });
      if (swapDest === DROP_DESTINATION.WAIVERS && dropId !== playerId) {
        swapWire = placeOnWire(swapWire, dropId, {
          clearsAt: wireClearsAt(now, meta.settings),
          droppedBy: teamId,
          droppedAt: now
        });
      }
    }
    const owner = ownerOf(rosters, playerId);
    if (owner) refuse2(`player ${playerId} is owned by team ${owner}`);
    if (onWaivers(assets.wire ?? {}, playerId, now)) {
      refuse2(`${playerId} is on waivers \u2014 submit a claim instead`);
    }
    const positions = positionMap();
    const limitCheck = mayAddAtPosition(
      rosters?.[teamId],
      playerId,
      meta.settings,
      (id) => positions[String(id)] ?? null
    );
    if (!limitCheck.ok) refuse2(limitCheck.error);
    const added = addPlayer(rosters, teamId, playerId);
    if (!added.ok) refuse2(added.error);
    result = {
      added: playerId,
      dropped: dropId,
      destination: dropId ? swapDest : null,
      clearsAt: dropId && swapDest === DROP_DESTINATION.WAIVERS ? wireClearsAt(now, meta.settings) : null
    };
    let acquired = recordAcquisition(assets.acquired ?? {}, playerId, { at: now, via: "free_agency" });
    if (dropId) acquired = forgetAcquisition(acquired, dropId);
    return { ...assets, rosters: added.rosters, acquired, wire: swapWire };
  }, null);
  return result;
}
function dropFreeAgent({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse2(err);
  const playerId = String(payload?.playerId ?? "");
  const now = Date.now();
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    const res = dropPlayer(assets.rosters, teamId, playerId);
    if (!res.ok) refuse2(res.error);
    const dest = dropDestination({
      acquired: assets.acquired ?? {},
      playerId,
      now,
      settings: meta.settings
    });
    const wire = dest === DROP_DESTINATION.WAIVERS ? placeOnWire(assets.wire ?? {}, playerId, {
      clearsAt: wireClearsAt(now, meta.settings),
      droppedBy: teamId,
      droppedAt: now
    }) : assets.wire ?? {};
    return {
      ...assets,
      rosters: res.rosters,
      wire,
      acquired: forgetAcquisition(assets.acquired ?? {}, playerId)
    };
  }, null);
  const settled = read(KEY.assets(lg), { wire: {} });
  return {
    dropped: playerId,
    destination: onWaivers(settled.wire ?? {}, playerId, now) ? DROP_DESTINATION.WAIVERS : DROP_DESTINATION.FREE_AGENCY,
    clearsAt: settled.wire?.[playerId]?.clearsAt ?? null
  };
}
function movePlayer({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse2(err);
  const playerId = String(payload?.playerId ?? "");
  const compartment = String(payload?.compartment ?? "players");
  if (compartment === "ir") {
    const injuries = injuryMap();
    if (injuries) {
      const allowed = meta.settings?.irStatuses;
      const status = injuries[playerId] ?? null;
      if (!irEligible(status, allowed ? { allowed } : void 0)) {
        refuse2(status ? `player ${playerId} is listed ${status}, which is not an IR designation` : `player ${playerId} carries no injury designation and cannot be placed on IR`);
      }
    }
  }
  mutate(KEY.assets(lg), (a) => {
    const res = moveCompartment(a.rosters, teamId, playerId, compartment);
    if (!res.ok) refuse2(res.error);
    const roster = res.rosters[teamId];
    if (compartment === "ir" && roster.ir.length > (meta.settings?.irSlots ?? 0)) {
      refuse2(`no IR slots free (${meta.settings?.irSlots ?? 0})`);
    }
    if (compartment === "taxi" && roster.taxi.length > (meta.settings?.taxiSlots ?? 0)) {
      refuse2(`no taxi slots free (${meta.settings?.taxiSlots ?? 0})`);
    }
    return { ...a, rosters: res.rosters };
  }, null);
  return { playerId, compartment };
}
function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse2("leagueId required");
  return lg;
}
function generateSchedule({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse2(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse2(err);
  const season = Number(payload?.season ?? meta.season);
  const teamIds = Object.keys(teams);
  if (teamIds.length < 2) refuse2("a schedule needs at least two teams");
  const existing = read(KEY.schedule(lg, season), null);
  if (existing && !payload?.force) {
    const scored = (existing.weeks ?? []).some((w) => read(KEY.scores(lg, season, w.week), null));
    if (scored) {
      refuse2("this season already has scored weeks \u2014 regenerating would change opponents for games already played. Pass force to override.");
    }
  }
  const startWeek = meta.settings?.startWeek ?? 1;
  const weeks = Math.max(1, (meta.settings?.playoffWeekStart ?? 15) - startWeek);
  const generated = generateRegularSeason(teamIds, weeks, { startWeek });
  const record = {
    season,
    startWeek,
    // The exact order the schedule was built from, kept so a later reader can
    // see WHY the pairings are what they are.
    teamIds,
    generatedAt: Date.now(),
    generatedBy: p.userId,
    weeks: generated
  };
  mutate(KEY.schedule(lg, season), () => record, null);
  return { season, weeks: generated.length, teams: teamIds.length };
}
function getSchedule({ payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse2(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  return read(KEY.schedule(lg, season), null);
}

// core/league/draft-order.js
var DRAFT_TYPE = Object.freeze({
  SNAKE: "snake",
  LINEAR: "linear",
  /**
   * 3rd Round Reversal: a snake that reverses AGAIN at round three.
   *
   * In a plain snake the team holding 1.01 ends round two and opens round
   * three, taking two picks back to back — the imbalance 3RR exists to remove.
   * Reversing again hands round three to whoever picked LAST in round one, and
   * the draft snakes normally from there with its parity flipped.
   */
  THIRD_ROUND_REVERSAL: "third_round_reversal"
});
function roundIsReversed(round, type) {
  if (type === DRAFT_TYPE.LINEAR) return false;
  if (type === DRAFT_TYPE.THIRD_ROUND_REVERSAL && round >= 3) return round % 2 === 1;
  if (type === DRAFT_TYPE.SNAKE || type === DRAFT_TYPE.THIRD_ROUND_REVERSAL) {
    return round % 2 === 0;
  }
  return false;
}
function generateOrder(draftOrder, rounds, type = DRAFT_TYPE.SNAKE) {
  const teams = Array.isArray(draftOrder) ? draftOrder.map(String) : [];
  const n = teams.length;
  const picks = [];
  if (n === 0 || !Number.isInteger(rounds) || rounds < 1) return picks;
  for (let round = 1; round <= rounds; round++) {
    const reversed = roundIsReversed(round, type);
    const order = reversed ? [...teams].reverse() : teams;
    order.forEach((team, i) => {
      picks.push({
        overall: (round - 1) * n + i + 1,
        round,
        pickInRound: i + 1,
        slot: team,
        owner: team
      });
    });
  }
  return picks;
}
function applyTradedPicks(picks, trades = []) {
  const byKey = /* @__PURE__ */ new Map();
  for (const t of trades) {
    if (!t) continue;
    byKey.set(`${t.round}:${String(t.slot)}`, String(t.to));
  }
  return picks.map((p) => {
    const owner = byKey.get(`${p.round}:${p.slot}`);
    return owner ? { ...p, owner } : p;
  });
}

// core/league/draft.js
var DRAFT_STATUS = Object.freeze({
  PRE: "pre",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETE: "complete"
});
function createDraft({
  draftOrder,
  rounds,
  type,
  tradedPicks = [],
  pickTimerSeconds = 90,
  season = null
}) {
  return {
    status: DRAFT_STATUS.PRE,
    season,
    type,
    rounds,
    pickTimerSeconds,
    order: applyTradedPicks(generateOrder(draftOrder, rounds, type), tradedPicks),
    picks: {},
    // overall -> { playerId, teamId, at, auto }
    startedAt: null,
    pickEndsAt: null
    // epoch ms deadline for the pick currently on the clock
  };
}
function startDraft(draft, now) {
  if (draft.status !== DRAFT_STATUS.PRE) return fail2(draft, "draft has already started");
  if (draft.order.length === 0) return fail2(draft, "draft has no picks");
  return done2({
    ...draft,
    status: DRAFT_STATUS.ACTIVE,
    startedAt: now,
    pickEndsAt: deadlineFrom(draft, now)
  });
}
var fail2 = (draft, error) => ({ ok: false, draft, error });
var done2 = (draft, made = []) => ({ ok: true, draft, error: null, made });
function deadlineFrom(draft, from) {
  return draft.pickTimerSeconds > 0 ? from + draft.pickTimerSeconds * 1e3 : null;
}
function currentPick(draft) {
  for (const p of draft.order) {
    if (!draft.picks[p.overall]) return p;
  }
  return null;
}
function draftedPlayerIds(draft) {
  return Object.values(draft.picks ?? {}).map((p) => String(p.playerId));
}
function draftedRosters(draft, teamIds) {
  const out = {};
  for (const id of teamIds ?? []) out[String(id)] = { players: [], ir: [], taxi: [] };
  for (const pick of Object.values(draft.picks ?? {})) {
    const team = String(pick.teamId);
    if (!out[team]) out[team] = { players: [], ir: [], taxi: [] };
    out[team].players.push(String(pick.playerId));
  }
  return out;
}
function makePick(draft, teamId, playerId, now, { auto = false } = {}) {
  if (draft.status !== DRAFT_STATUS.ACTIVE) return fail2(draft, `draft is ${draft.status}`);
  const pick = currentPick(draft);
  if (!pick) return fail2(draft, "draft is already complete");
  const team = String(teamId);
  if (pick.owner !== team) return fail2(draft, `it is team ${pick.owner}'s pick, not ${team}'s`);
  if (playerId === null || playerId === void 0 || playerId === "" || playerId === "0" || playerId === 0) {
    return fail2(draft, "no player named");
  }
  const id = String(playerId);
  if (draftedPlayerIds(draft).includes(id)) return fail2(draft, `player ${id} is already drafted`);
  const picks = { ...draft.picks, [pick.overall]: { playerId: id, teamId: team, at: now, auto } };
  const complete = Object.keys(picks).length >= draft.order.length;
  return done2({
    ...draft,
    picks,
    status: complete ? DRAFT_STATUS.COMPLETE : draft.status,
    // The next clock runs from the moment this pick was made, not from `now` —
    // for an auto-pick those differ, and using `now` would silently give the next
    // team extra time whenever a lapse was resolved late.
    pickEndsAt: complete ? null : deadlineFrom(draft, now)
  });
}
function resolveExpired(draft, now, autoPick) {
  if (draft.status !== DRAFT_STATUS.ACTIVE) return done2(draft);
  if (!draft.pickEndsAt) return done2(draft);
  let state = draft;
  const made = [];
  let guard = state.order.length + 1;
  while (guard-- > 0) {
    if (state.status !== DRAFT_STATUS.ACTIVE) break;
    const deadline = state.pickEndsAt;
    if (!deadline || deadline > now) break;
    const pick = currentPick(state);
    if (!pick) break;
    const playerId = autoPick?.(state, pick) ?? null;
    if (!playerId) break;
    const res = makePick(state, pick.owner, playerId, deadline, { auto: true });
    if (!res.ok) break;
    state = res.draft;
    made.push({ ...pick, playerId: String(playerId), at: deadline });
  }
  return done2(state, made);
}
function pauseDraft(draft, now) {
  if (draft.status !== DRAFT_STATUS.ACTIVE) return fail2(draft, `draft is ${draft.status}`);
  const measurable = Number.isFinite(now) && Number.isFinite(draft.pickEndsAt);
  return done2({
    ...draft,
    status: DRAFT_STATUS.PAUSED,
    pickEndsAt: null,
    pausedRemainingMs: measurable ? Math.max(0, draft.pickEndsAt - now) : null
  });
}
function resumeDraft(draft, now) {
  if (draft.status !== DRAFT_STATUS.PAUSED) return fail2(draft, `draft is ${draft.status}`);
  const banked = draft.pausedRemainingMs;
  const next = { ...draft, status: DRAFT_STATUS.ACTIVE };
  next.pickEndsAt = draft.pickTimerSeconds > 0 && Number.isFinite(banked) ? now + banked : deadlineFrom(draft, now);
  delete next.pausedRemainingMs;
  return done2(next);
}
function bestAvailable(draft, ranking = []) {
  const taken = new Set(draftedPlayerIds(draft));
  for (const id of ranking) {
    if (!taken.has(String(id))) return String(id);
  }
  return null;
}

// server/ops-draft.js
var refuse3 = (msg) => {
  throw new Error(msg);
};
function autoPicker(queues, ranking) {
  return (draft, pick) => {
    const queue = queues?.[pick.owner] ?? [];
    const fromQueue = bestAvailable(draft, queue);
    return fromQueue ?? bestAvailable(draft, ranking);
  };
}
function createLeagueDraft({ p, payload }) {
  const lg = requireLeagueId2(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse3(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse3(err);
  const order = Array.isArray(payload?.draftOrder) && payload.draftOrder.length ? payload.draftOrder.map(String) : Object.keys(teams);
  if (order.length === 0) refuse3("the league has no teams to draft");
  const known = new Set(Object.values(DRAFT_TYPE));
  const type = known.has(payload?.type) ? payload.type : DRAFT_TYPE.SNAKE;
  const rounds = Number(payload?.rounds ?? meta.settings?.draftRounds ?? 15);
  const pickTimerSeconds = Number(payload?.pickTimerSeconds ?? meta.settings?.pickTimerSeconds ?? 90);
  const existing = read(KEY.draft(lg), null);
  if (existing && existing.status !== DRAFT_STATUS.PRE) {
    refuse3(`this draft is ${existing.status} and cannot be rebuilt \u2014 rebuilding would discard every pick made`);
  }
  const assets = read(KEY.assets(lg), { pickOwnership: [] });
  const draft = createDraft({
    draftOrder: order,
    rounds,
    type,
    tradedPicks: assets.pickOwnership ?? [],
    pickTimerSeconds,
    season: meta.season
  });
  mutate(KEY.draft(lg), (d) => {
    if (d && d.status !== DRAFT_STATUS.PRE) {
      refuse3(`this draft is ${d.status} and cannot be rebuilt \u2014 rebuilding would discard every pick made`);
    }
    return draft;
  }, null);
  return {
    status: draft.status,
    picks: draft.order.length,
    rounds,
    type,
    rebuilt: Boolean(existing)
  };
}
function startLeagueDraft({ p, payload }) {
  const lg = requireLeagueId2(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse3(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse3(err);
  let out = null;
  mutate(KEY.draft(lg), (d) => {
    if (!d) refuse3("no draft has been created");
    const res = startDraft(d, Date.now());
    if (!res.ok) refuse3(res.error);
    out = { status: res.draft.status, pickEndsAt: res.draft.pickEndsAt };
    return res.draft;
  }, null);
  return out;
}
function getDraft({ p, payload }) {
  const lg = requireLeagueId2(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse3(`no such league: ${lg}`);
  const queues = read(KEY.meta(lg), {})?.draftQueues ?? {};
  const ranking = payload?.ranking ?? [];
  let view = null;
  mutate(KEY.draft(lg), (d) => {
    if (!d) refuse3("no draft has been created");
    const res = resolveExpired(d, Date.now(), autoPicker(queues, ranking));
    view = draftView(res.draft, meta, p);
    view.autoPicked = res.made.map((m) => ({ overall: m.overall, teamId: m.owner, playerId: m.playerId }));
    return res.draft;
  }, null);
  return view;
}
function makeDraftPick({ p, payload }) {
  const lg = requireLeagueId2(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse3(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse3(err);
  const playerId = payload?.playerId;
  if (playerId === null || playerId === void 0 || playerId === "") refuse3("playerId required");
  const queues = meta.draftQueues ?? {};
  const ranking = payload?.ranking ?? [];
  let out = null;
  mutate(KEY.draft(lg), (d) => {
    if (!d) refuse3("no draft has been created");
    const now = Date.now();
    const resolved = resolveExpired(d, now, autoPicker(queues, ranking));
    const res = makePick(resolved.draft, teamId, playerId, now);
    if (!res.ok) refuse3(res.error);
    out = {
      overall: currentPick(resolved.draft)?.overall ?? null,
      playerId: String(playerId),
      autoPicked: resolved.made.length,
      status: res.draft.status,
      pickEndsAt: res.draft.pickEndsAt
    };
    return res.draft;
  }, null);
  return out;
}
function setDraftQueue({ p, payload }) {
  const lg = requireLeagueId2(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse3(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse3(err);
  const queue = (payload?.queue ?? []).map(String);
  mutate(KEY.meta(lg), (m) => ({
    ...m,
    draftQueues: { ...m.draftQueues ?? {}, [teamId]: queue }
  }), meta);
  return { teamId, queued: queue.length };
}
function setDraftAuto({ p, payload }) {
  const lg = requireLeagueId2(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse3(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse3(err);
  const auto = Boolean(payload?.auto);
  mutate(KEY.meta(lg), (m) => {
    const flags = { ...m.autoDraft ?? {} };
    if (auto) flags[teamId] = true;
    else delete flags[teamId];
    return { ...m, autoDraft: flags };
  }, meta);
  return { teamId, auto };
}
function setDraftPaused({ p, payload }) {
  const lg = requireLeagueId2(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse3(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse3(err);
  const paused = Boolean(payload?.paused);
  let out = null;
  mutate(KEY.draft(lg), (d) => {
    if (!d) refuse3("no draft has been created");
    const now = Date.now();
    const res = paused ? pauseDraft(d, now) : resumeDraft(d, now);
    if (!res.ok) refuse3(res.error);
    out = { status: res.draft.status, pickEndsAt: res.draft.pickEndsAt };
    return res.draft;
  }, null);
  return out;
}
function finalizeDraft({ p, payload }) {
  const lg = requireLeagueId2(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse3(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse3(err);
  const draft = read(KEY.draft(lg), null);
  if (!draft) refuse3("no draft has been created");
  if (draft.status !== DRAFT_STATUS.COMPLETE) refuse3(`draft is ${draft.status}, not complete`);
  const drafted = draftedRosters(draft, Object.keys(teams));
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    const rosters = { ...assets.rosters };
    for (const [teamId, roster] of Object.entries(drafted)) {
      const existing = rosters[teamId] ?? { players: [], ir: [], taxi: [] };
      const players = [.../* @__PURE__ */ new Set([...existing.players, ...roster.players])];
      rosters[teamId] = { ...existing, players };
    }
    return { ...assets, rosters };
  }, null);
  return { finalized: true, teams: Object.keys(drafted).length };
}
function draftView(draft, meta, p) {
  const onClock = currentPick(draft);
  return {
    status: draft.status,
    type: draft.type,
    rounds: draft.rounds,
    pickTimerSeconds: draft.pickTimerSeconds,
    pickEndsAt: draft.pickEndsAt,
    // ⚠️ A PAUSED DRAFT REPORTS ITS BANKED TIME, not null. It has no deadline by
    // definition, and reporting nothing left the board showing "—" while paused,
    // so a manager could not see how long they would have on resume.
    msRemaining: draft.pickEndsAt ? Math.max(0, draft.pickEndsAt - Date.now()) : draft.status === DRAFT_STATUS.PAUSED ? draft.pausedRemainingMs ?? null : null,
    onClock: onClock ? { overall: onClock.overall, round: onClock.round, teamId: onClock.owner } : null,
    picks: draft.picks,
    order: draft.order,
    isCommissioner: isCommissioner(meta, p.userId),
    // ⚠️ THE BOARD'S ONLY SOURCE FOR THESE. They used to be fetched separately
    // from plugin storage by the client; returning them with the board is what
    // lets the storage copy go away entirely rather than leaving two answers to
    // "is this team autodrafting".
    autoDraft: meta?.autoDraft ?? {}
  };
}
function requireLeagueId2(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse3("leagueId required");
  return lg;
}

// core/league/waivers.js
var CLAIM_STATUS = Object.freeze({
  WON: "won",
  LOST: "lost",
  // somebody outbid or outranked them
  INVALID: "invalid"
  // could never have succeeded
});
function orderClaims(claims, { waiverType, priority = {} }) {
  const pri = (teamId) => priority[String(teamId)] ?? Number.MAX_SAFE_INTEGER;
  return [...claims].sort((a, b) => {
    if (waiverType === WAIVER_TYPE.FAAB) {
      const bid = (Number(b.bid) || 0) - (Number(a.bid) || 0);
      if (bid !== 0) return bid;
    }
    const p = pri(a.teamId) - pri(b.teamId);
    if (p !== 0) return p;
    return (a.submittedAt ?? 0) - (b.submittedAt ?? 0);
  });
}
function resolveWaivers(claims, {
  rosters,
  settings,
  budgets = {},
  priority = {},
  isAvailable = null
}) {
  const waiverType = settings?.waiverType;
  const ordered = orderClaims(claims ?? [], { waiverType, priority });
  let workingRosters = rosters;
  const workingBudgets = { ...budgets };
  let workingPriority = { ...priority };
  const results = [];
  for (const claim of ordered) {
    const team = String(claim.teamId);
    const playerId = String(claim.playerId);
    const bid = Number(claim.bid) || 0;
    const reject = (status, reason) => results.push({ claim, status, reason });
    if (!workingRosters?.[team]) {
      reject(CLAIM_STATUS.INVALID, `no such team: ${team}`);
      continue;
    }
    const owner = ownerOf(workingRosters, playerId);
    if (owner) {
      reject(
        owner === team ? CLAIM_STATUS.INVALID : CLAIM_STATUS.LOST,
        owner === team ? "already on this roster" : `claimed by team ${owner}`
      );
      continue;
    }
    if (isAvailable && !isAvailable(playerId)) {
      reject(CLAIM_STATUS.INVALID, "player is not a free agent");
      continue;
    }
    if (waiverType === WAIVER_TYPE.FAAB) {
      const remaining = workingBudgets[team] ?? settings?.waiverBudget ?? 0;
      if (bid < 0) {
        reject(CLAIM_STATUS.INVALID, "negative bid");
        continue;
      }
      if (bid > remaining) {
        reject(CLAIM_STATUS.INVALID, `bid ${bid} exceeds remaining budget ${remaining}`);
        continue;
      }
    }
    let candidate = workingRosters;
    if (claim.dropPlayerId) {
      const dropped = dropPlayer(candidate, team, String(claim.dropPlayerId));
      if (!dropped.ok) {
        reject(CLAIM_STATUS.INVALID, dropped.error);
        continue;
      }
      candidate = dropped.rosters;
    }
    const capacity = rosterCapacity(settings);
    if ((candidate[team].players ?? []).length >= capacity) {
      reject(CLAIM_STATUS.INVALID, `roster is full (${capacity}) and no drop was named`);
      continue;
    }
    const added = addPlayer(candidate, team, playerId);
    if (!added.ok) {
      reject(CLAIM_STATUS.INVALID, added.error);
      continue;
    }
    workingRosters = added.rosters;
    if (waiverType === WAIVER_TYPE.FAAB) {
      workingBudgets[team] = (workingBudgets[team] ?? settings?.waiverBudget ?? 0) - bid;
    }
    if (waiverType === WAIVER_TYPE.ROLLING) {
      workingPriority = demoteToBack(workingPriority, team);
    }
    results.push({ claim, status: CLAIM_STATUS.WON, reason: null, spent: bid });
  }
  return { results, rosters: workingRosters, budgets: workingBudgets, priority: workingPriority };
}
function demoteToBack(priority, teamId) {
  const team = String(teamId);
  const was = priority[team];
  if (was === void 0) return { ...priority };
  const out = {};
  let last = 0;
  for (const [id, pos] of Object.entries(priority)) {
    out[id] = pos > was ? pos - 1 : pos;
    last = Math.max(last, pos);
  }
  out[team] = last;
  return out;
}
function remainingBudget(budgets, teamId, settings) {
  return budgets?.[String(teamId)] ?? settings?.waiverBudget ?? 0;
}

// core/league/trades.js
var TRADE_STATUS = Object.freeze({
  PROPOSED: "proposed",
  // waiting on the other parties
  REVIEW: "review",
  // all accepted; the league may veto
  EXECUTED: "executed",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  // withdrawn by the proposer
  VETOED: "vetoed",
  EXPIRED: "expired"
  // nobody responded
});
var fail3 = (trade, error) => ({ ok: false, trade, error });
var done3 = (trade) => ({ ok: true, trade, error: null });
function proposeTrade({
  id,
  proposedBy,
  legs = [],
  picks = [],
  faab = [],
  now,
  expiresAt = null
}) {
  const parties = tradeParties({ legs, picks, faab });
  if (legs.length + picks.length + faab.length === 0) {
    return fail3(null, "a trade must move at least one asset");
  }
  if (!parties.includes(String(proposedBy))) {
    return fail3(null, "the proposer must be a party to the trade");
  }
  if (parties.length < 2) return fail3(null, "a trade needs at least two teams");
  return done3({
    id,
    proposedBy: String(proposedBy),
    parties,
    legs,
    picks,
    faab,
    status: TRADE_STATUS.PROPOSED,
    proposedAt: now,
    expiresAt,
    acceptances: { [String(proposedBy)]: now },
    // proposing IS accepting
    vetoes: {},
    reviewEndsAt: null,
    resolvedAt: null
  });
}
function tradeParties({ legs = [], picks = [], faab = [] }) {
  const set = /* @__PURE__ */ new Set();
  for (const l of legs) {
    set.add(String(l.from));
    set.add(String(l.to));
  }
  for (const p of picks) {
    set.add(String(p.slot));
    set.add(String(p.to));
  }
  for (const f of faab) {
    set.add(String(f.from));
    set.add(String(f.to));
  }
  return [...set];
}
function acceptTrade(trade, teamId, now, settings) {
  const team = String(teamId);
  if (trade.status !== TRADE_STATUS.PROPOSED) return fail3(trade, `trade is ${trade.status}`);
  if (!trade.parties.includes(team)) return fail3(trade, `team ${team} is not a party to this trade`);
  const acceptances = { ...trade.acceptances, [team]: now };
  const allIn = trade.parties.every((p) => acceptances[p] !== void 0);
  if (!allIn) return done3({ ...trade, acceptances });
  const reviewDays = settings?.tradeReviewDays ?? 0;
  return done3({
    ...trade,
    acceptances,
    status: TRADE_STATUS.REVIEW,
    reviewEndsAt: now + reviewDays * 24 * 60 * 60 * 1e3
  });
}
function rejectTrade(trade, teamId, now) {
  const team = String(teamId);
  if (trade.status !== TRADE_STATUS.PROPOSED) return fail3(trade, `trade is ${trade.status}`);
  if (!trade.parties.includes(team)) return fail3(trade, `team ${team} is not a party to this trade`);
  return done3({ ...trade, status: TRADE_STATUS.REJECTED, resolvedAt: now });
}
function cancelTrade(trade, teamId, now) {
  if (String(teamId) !== trade.proposedBy) return fail3(trade, "only the proposer may cancel");
  if (trade.status !== TRADE_STATUS.PROPOSED) return fail3(trade, `trade is ${trade.status}`);
  return done3({ ...trade, status: TRADE_STATUS.CANCELLED, resolvedAt: now });
}
function vetoTrade(trade, teamId, now, settings) {
  const team = String(teamId);
  if (trade.status !== TRADE_STATUS.REVIEW) return fail3(trade, `trade is ${trade.status}`);
  if (trade.parties.includes(team)) return fail3(trade, "a party to the trade cannot veto it");
  const vetoes = { ...trade.vetoes, [team]: now };
  const needed = settings?.vetoVotesNeeded ?? Infinity;
  if (Object.keys(vetoes).length >= needed) {
    return done3({ ...trade, vetoes, status: TRADE_STATUS.VETOED, resolvedAt: now });
  }
  return done3({ ...trade, vetoes });
}
function commissionerResolve(trade, approve, now) {
  if (trade.status !== TRADE_STATUS.PROPOSED && trade.status !== TRADE_STATUS.REVIEW) {
    return fail3(trade, `trade is ${trade.status}`);
  }
  return done3({
    ...trade,
    status: approve ? TRADE_STATUS.REVIEW : TRADE_STATUS.VETOED,
    reviewEndsAt: approve ? now : trade.reviewEndsAt,
    resolvedAt: approve ? null : now
  });
}
function resolveDueTrades(trades, now) {
  const out = [];
  const ready = [];
  for (const t of trades ?? []) {
    if (t.status === TRADE_STATUS.REVIEW && t.reviewEndsAt !== null && t.reviewEndsAt <= now) {
      ready.push(t);
      out.push(t);
      continue;
    }
    if (t.status === TRADE_STATUS.PROPOSED && t.expiresAt !== null && t.expiresAt <= now) {
      out.push({ ...t, status: TRADE_STATUS.EXPIRED, resolvedAt: t.expiresAt });
      continue;
    }
    out.push(t);
  }
  return { trades: out, ready };
}
function applyTrade(assets, trade) {
  if (trade.status !== TRADE_STATUS.REVIEW) {
    return { ok: false, assets, error: `trade is ${trade.status}, not ready to apply` };
  }
  const moved = executeTrade(assets.rosters, trade.legs ?? []);
  if (!moved.ok && (trade.legs ?? []).length > 0) {
    return { ok: false, assets, error: moved.error };
  }
  const budgets = { ...assets.budgets ?? {} };
  for (const f of trade.faab ?? []) {
    const from = String(f.from);
    const to = String(f.to);
    const amount = Number(f.amount) || 0;
    if (amount < 0) return { ok: false, assets, error: "negative FAAB transfer" };
    if ((budgets[from] ?? 0) < amount) {
      return { ok: false, assets, error: `team ${from} cannot send ${amount} FAAB` };
    }
    budgets[from] = (budgets[from] ?? 0) - amount;
    budgets[to] = (budgets[to] ?? 0) + amount;
  }
  const pickOwnership = [...assets.pickOwnership ?? [], ...trade.picks ?? []];
  return {
    ok: true,
    error: null,
    assets: { ...assets, rosters: moved.ok ? moved.rosters : assets.rosters, budgets, pickOwnership },
    trade: { ...trade, status: TRADE_STATUS.EXECUTED, resolvedAt: trade.reviewEndsAt }
  };
}
function tradingIsOpen(settings, week) {
  if (settings?.tradesEnabled === false) return false;
  return week <= (settings?.tradeDeadlineWeek ?? Infinity);
}

// server/ops-transactions.js
var refuse4 = (msg) => {
  throw new Error(msg);
};
function submitClaim({ p, payload }) {
  const lg = requireLeagueId3(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse4(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse4(err);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  if (!Number.isInteger(week) || week < 1) refuse4("week must be a positive integer");
  const claim = {
    teamId,
    playerId: String(payload?.playerId ?? ""),
    dropPlayerId: payload?.dropPlayerId ? String(payload.dropPlayerId) : null,
    bid: Number(payload?.bid ?? 0),
    submittedAt: Date.now(),
    submittedBy: p.userId
  };
  if (!claim.playerId) refuse4("playerId required");
  if (claim.bid < 0) refuse4("bid cannot be negative");
  mutate(KEY.waivers(lg, season, week), (claims) => {
    const list = claims ?? [];
    const without = list.filter((c) => !(c.teamId === teamId && c.playerId === claim.playerId));
    return [...without, claim];
  }, []);
  return { submitted: claim.playerId, bid: claim.bid, season, week };
}
function cancelClaim({ p, payload }) {
  const lg = requireLeagueId3(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse4(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse4(err);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const playerId = String(payload?.playerId ?? "");
  mutate(KEY.waivers(lg, season, week), (claims) => (claims ?? []).filter((c) => !(c.teamId === teamId && c.playerId === playerId)), []);
  return { cancelled: playerId };
}
function listClaims({ p, payload }) {
  const lg = requireLeagueId3(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse4(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const claims = read(KEY.waivers(lg, season, week), []);
  const mine = Object.keys(teams).filter((t) => teams[t].ownerId === p.userId || (teams[t].coOwners ?? []).includes(p.userId));
  return {
    // ⚠️ Only your own claims. Waivers are BLIND — returning everyone's bids
    // would turn a blind auction into an open one.
    claims: claims.filter((c) => mine.includes(c.teamId) || isCommissioner(meta, p.userId)),
    budgets: Object.fromEntries(mine.map((t) => [t, remainingBudget(assets.budgets, t, meta.settings)])),
    pendingCount: claims.length
  };
}
function runWaivers({ p, payload }) {
  const err = requireScheduled(p);
  if (err) refuse4(err);
  const lg = requireLeagueId3(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse4(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const claims = read(KEY.waivers(lg, season, week), []);
  if (claims.length === 0) return { processed: 0, results: [] };
  const now = Date.now();
  let results = [];
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    const out = resolveWaivers(claims, {
      rosters: assets.rosters,
      settings: meta.settings,
      budgets: assets.budgets,
      priority: meta.waiverPriority ?? {}
    });
    results = out.results.map((r) => ({
      teamId: r.claim.teamId,
      playerId: r.claim.playerId,
      status: r.status,
      reason: r.reason
    }));
    let wire = assets.wire ?? {};
    let acquired = assets.acquired ?? {};
    for (const r of out.results) {
      if (r.status !== CLAIM_STATUS.WON) continue;
      const pid = String(r.claim.playerId);
      wire = removeFromWire(wire, pid);
      acquired = recordAcquisition(acquired, pid, { at: now, via: "waivers" });
    }
    return { ...assets, rosters: out.rosters, budgets: out.budgets, wire, acquired };
  }, null);
  mutate(KEY.waivers(lg, season, week), () => [], []);
  return { processed: results.length, results };
}
function proposeLeagueTrade({ p, payload }) {
  const lg = requireLeagueId3(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse4(`no such league: ${lg}`);
  const week = Number(payload?.week ?? 1);
  if (!tradingIsOpen(meta.settings, week)) refuse4("trading is closed for this league");
  const from = String(payload?.fromTeamId ?? "");
  const err = requireTeamControl(p, teams, meta, from);
  if (err) refuse4(err);
  const id = `tr${Date.now().toString(36)}`;
  const res = proposeTrade({
    id,
    proposedBy: from,
    legs: payload?.legs ?? [],
    picks: payload?.picks ?? [],
    faab: payload?.faab ?? [],
    now: Date.now(),
    expiresAt: payload?.expiresAt ?? null
  });
  if (!res.ok) refuse4(res.error);
  mutate(KEY.trade(lg, id), () => res.trade, null);
  mutate(KEY.tradeIndex(lg), (list) => [...list ?? [], id], []);
  return { tradeId: id, status: res.trade.status, parties: res.trade.parties };
}
function respondToTrade({ p, payload }) {
  const lg = requireLeagueId3(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse4(`no such league: ${lg}`);
  const tradeId = String(payload?.tradeId ?? "");
  const teamId = String(payload?.teamId ?? "");
  const action = String(payload?.action ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse4(err);
  let out = null;
  mutate(KEY.trade(lg, tradeId), (t) => {
    if (!t) refuse4(`no such trade: ${tradeId}`);
    const now = Date.now();
    let res;
    switch (action) {
      case "accept":
        res = acceptTrade(t, teamId, now, meta.settings);
        break;
      case "reject":
        res = rejectTrade(t, teamId, now);
        break;
      case "cancel":
        res = cancelTrade(t, teamId, now);
        break;
      case "veto":
        res = vetoTrade(t, teamId, now, meta.settings);
        break;
      default:
        refuse4(`unknown action: ${action}`);
    }
    if (!res.ok) refuse4(res.error);
    out = { tradeId, status: res.trade.status, reviewEndsAt: res.trade.reviewEndsAt };
    return res.trade;
  }, null);
  return out;
}
function commissionerTrade({ p, payload }) {
  const lg = requireLeagueId3(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse4(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse4(err);
  const tradeId = String(payload?.tradeId ?? "");
  const approve = Boolean(payload?.approve);
  let out = null;
  mutate(KEY.trade(lg, tradeId), (t) => {
    if (!t) refuse4(`no such trade: ${tradeId}`);
    const res = commissionerResolve(t, approve, Date.now());
    if (!res.ok) refuse4(res.error);
    out = { tradeId, status: res.trade.status };
    return res.trade;
  }, null);
  return out;
}
function listTrades({ p, payload }) {
  const lg = requireLeagueId3(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse4(`no such league: ${lg}`);
  const ids = read(KEY.tradeIndex(lg), []);
  return ids.map((id) => read(KEY.trade(lg, id), null)).filter(Boolean);
}
function settleTrades({ p, payload }) {
  const err = requireScheduled(p);
  if (err) refuse4(err);
  const lg = requireLeagueId3(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse4(`no such league: ${lg}`);
  const ids = read(KEY.tradeIndex(lg), []);
  const trades = ids.map((id) => read(KEY.trade(lg, id), null)).filter(Boolean);
  const due = resolveDueTrades(trades, Date.now());
  const settled = [];
  for (const trade of due.ready) {
    let applied = null;
    mutate(KEY.assets(lg), (a) => {
      const res = applyTrade(a ?? { rosters: {}, budgets: {}, pickOwnership: [] }, trade);
      if (!res.ok) {
        applied = { ok: false, error: res.error };
        return a;
      }
      applied = { ok: true, trade: res.trade };
      return res.assets;
    }, null);
    if (applied?.ok) {
      mutate(KEY.trade(lg, trade.id), () => applied.trade, null);
      settled.push({ tradeId: trade.id, status: TRADE_STATUS.EXECUTED });
    } else {
      settled.push({ tradeId: trade.id, status: "failed", error: applied?.error ?? "unknown" });
    }
  }
  for (const t of due.trades) {
    if (t.status === TRADE_STATUS.EXPIRED) {
      mutate(KEY.trade(lg, t.id), () => t, null);
    }
  }
  return { settled };
}
function requireLeagueId3(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse4("leagueId required");
  return lg;
}
function sweepWaiverWire(lg, now = Date.now()) {
  let cleared = [];
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    const out = clearExpired(assets.wire ?? {}, now);
    if (out.cleared.length === 0) return assets;
    return { ...assets, wire: out.wire };
  }, null);
  const settled = read(KEY.assets(lg), { wire: {} });
  cleared = Object.keys(settled.wire ?? {});
  return { onWire: cleared.length };
}
function getWaiverWire({ payload }) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse4("leagueId required");
  const assets = read(KEY.assets(lg), { wire: {} });
  return { wire: wirePlayers(assets.wire ?? {}, Date.now()) };
}

// core/league/bracket-resolve.js
function resolveBracket(bracket, scoresFor) {
  if (!bracket) return bracket;
  const opts = {
    playoffWeekStart: bracket.playoffWeekStart ?? 15,
    reseed: bracket.reseed,
    scoresFor,
    // ⚠️ READ FROM THE BRACKET, not from live settings. A commissioner who
    // changed the format mid-playoffs would otherwise re-interpret which weeks
    // an already-finished round occupied and move a decided game.
    format: bracket.roundFormat,
    // The MAIN side's round count decides where the championship is. A
    // consolation bracket is shorter and must not double its own last round.
    totalRounds: (bracket.rounds ?? []).length
  };
  const main = advanceSide({
    rounds: bracket.rounds ?? [],
    byes: bracket.byes ?? [],
    champion: bracket.champion ?? null
  }, opts);
  const cons = bracket.consolation ? advanceSide(bracket.consolation, opts) : null;
  return {
    ...bracket,
    rounds: main.rounds,
    byes: main.byes,
    champion: main.champion ?? null,
    // ⚠️ Preserve `null`, never write the key back as undefined. JSON.stringify
    // drops undefined, so the tick's change-detection would see a difference on
    // every single pass and rewrite an unchanged bracket forever.
    consolation: cons ? { ...bracket.consolation, ...cons } : bracket.consolation ?? null
  };
}
var PLAYOFF_ROUND_FORMAT = Object.freeze({
  ONE: "one",
  TWO_WEEK_CHAMPIONSHIP: "two_week_championship",
  TWO: "two"
});
function weeksInRound(roundIndex, { format, totalRounds } = {}) {
  if (format === PLAYOFF_ROUND_FORMAT.TWO) return 2;
  if (format === PLAYOFF_ROUND_FORMAT.TWO_WEEK_CHAMPIONSHIP && Number.isInteger(totalRounds) && roundIndex === totalRounds - 1) return 2;
  return 1;
}
function weekForRound(playoffWeekStart, roundIndex, opts = {}) {
  let week = playoffWeekStart ?? 15;
  for (let i = 0; i < roundIndex; i++) week += weeksInRound(i, opts);
  return week;
}
function roundWeeks(playoffWeekStart, roundIndex, opts = {}) {
  const start = weekForRound(playoffWeekStart, roundIndex, opts);
  const n = weeksInRound(roundIndex, opts);
  return Array.from({ length: n }, (_, i) => start + i);
}
function aggregateWeeks(weeks, scoresFor) {
  const totals = {};
  for (const w of weeks) {
    const s = scoresFor(w);
    if (!s?.final) return null;
    for (const [teamId, rec] of Object.entries(s.teams ?? {})) {
      const t = Number(rec?.total);
      if (!Number.isFinite(t)) continue;
      totals[teamId] = (totals[teamId] ?? 0) + t;
    }
  }
  return { teams: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, { total: v }])) };
}
function advanceSide(side, { playoffWeekStart, reseed, scoresFor, format, totalRounds }) {
  if (!side || side.champion) return side;
  let state = side;
  let guard = 8;
  while (guard-- > 0) {
    const roundIndex = (state.rounds?.length ?? 0) - 1;
    const round = state.rounds?.[roundIndex] ?? [];
    if (round.length === 0) break;
    if (round.every((g) => g.winner)) {
      const advanced = advanceBracket(state, { reseed: reseed !== false });
      if (advanced.rounds.length === state.rounds.length) break;
      state = { ...state, rounds: advanced.rounds, byes: advanced.byes };
      continue;
    }
    const scores = aggregateWeeks(
      roundWeeks(playoffWeekStart, roundIndex, { format, totalRounds }),
      scoresFor
    );
    if (!scores) break;
    const decided = round.map((g) => decide(g, scores));
    if (decided.some((g) => !g.winner)) break;
    state = { ...state, rounds: [...state.rounds.slice(0, roundIndex), decided] };
  }
  const champ = bracketChampion(state);
  return champ ? { ...state, champion: champ } : state;
}
function decide(g, scores) {
  if (g.winner) return g;
  const home = scores.teams?.[g.home?.teamId]?.total;
  const away = scores.teams?.[g.away?.teamId]?.total;
  if (home === void 0 || away === void 0) return g;
  if (home === away) {
    return { ...g, winner: g.home.seed <= g.away.seed ? g.home : g.away, tie: true };
  }
  return { ...g, winner: home > away ? g.home : g.away };
}

// server/ops-playoffs.js
var refuse5 = (msg) => {
  throw new Error(msg);
};
function weekForRound2(settings, roundIndex) {
  return weekForRound(settings?.playoffWeekStart, roundIndex);
}
function startPlayoffs({ p, payload }) {
  const lg = requireLeagueId4(payload);
  const { meta } = loadLeague(lg);
  if (!meta) refuse5(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse5(err);
  const season = Number(payload?.season ?? meta.season);
  const existing = read(KEY.bracket(lg, season), null);
  if (existing && !payload?.force) {
    refuse5("this season already has a bracket \u2014 pass force to rebuild it, which discards every result in it");
  }
  const table = getStandings({ payload: { leagueId: lg, season } });
  if ((table.weeks ?? 0) === 0) {
    refuse5("no weeks have been scored \u2014 seeding a bracket now would rank everybody on nothing");
  }
  const cut = Number(meta.settings?.playoffTeams ?? 0);
  if (cut < 2) refuse5("this league's playoffTeams is below 2");
  const seeds = (table.standings ?? []).slice(0, cut);
  if (seeds.length < 2) refuse5("not enough teams to seed a bracket");
  const built = buildBracket(seeds);
  const alsoRans = meta.settings?.playoffConsolation === false ? [] : consolationSeeds(table.standings ?? [], cut);
  const consBuilt = alsoRans.length >= 2 ? buildBracket(alsoRans) : null;
  const record = {
    season,
    startedAt: Date.now(),
    startedBy: p.userId,
    playoffWeekStart: meta.settings?.playoffWeekStart ?? 15,
    reseed: meta.settings?.playoffReseed !== false,
    // ⚠️ Recorded ON THE BRACKET, like reseed and the seeds themselves. A
    // league that changed this mid-playoffs would otherwise re-interpret which
    // weeks a round already occupied and move a finished game.
    roundFormat: meta.settings?.playoffRoundFormat ?? "one",
    // The seeds AS THEY WERE when the bracket was built. Standings keep moving if
    // a week is rescored, and a bracket must not silently reseed itself.
    seeds,
    rounds: built.rounds,
    byes: built.byes,
    champion: null,
    consolation: consBuilt ? { seeds: alsoRans, rounds: consBuilt.rounds, byes: consBuilt.byes, champion: null } : null
  };
  mutate(KEY.bracket(lg, season), () => record, null);
  return summary(record, meta, p);
}
function getPlayoffs({ p, payload }) {
  const lg = requireLeagueId4(payload);
  const { meta } = loadLeague(lg);
  if (!meta) refuse5(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  let view = null;
  mutate(KEY.bracket(lg, season), (b) => {
    if (!b) {
      view = null;
      return b;
    }
    const next = resolve(lg, season, b);
    view = summary(next, meta, p);
    return next;
  }, null);
  return view;
}
function resolve(lg, season, bracket) {
  return resolveBracket(bracket, (week) => read(KEY.scores(lg, season, week), null));
}
function resolveBracketsFor(lg, season) {
  let changed = false;
  mutate(KEY.bracket(lg, season), (b) => {
    if (!b) return b;
    const next = resolve(lg, season, b);
    changed = JSON.stringify(next) !== JSON.stringify(b);
    return next;
  }, null);
  return { advanced: changed };
}
function summary(b, meta, p) {
  if (!b) return null;
  const withWeeks = (rounds) => (rounds ?? []).map((games, i) => ({
    round: i + 1,
    week: weekForRound2({ playoffWeekStart: b.playoffWeekStart }, i),
    games
  }));
  return {
    season: b.season,
    playoffWeekStart: b.playoffWeekStart,
    reseed: b.reseed,
    seeds: b.seeds,
    byes: b.byes,
    champion: b.champion,
    isCommissioner: isCommissioner(meta, p?.userId),
    rounds: withWeeks(b.rounds),
    // ⚠️ `null` when the league has no consolation side, NOT an empty object.
    // The UI has to tell "this league does not run one" apart from "it does and
    // nothing has happened yet" — the second gets a panel, the first must not.
    consolation: b.consolation ? {
      seeds: b.consolation.seeds,
      byes: b.consolation.byes,
      champion: b.consolation.champion ?? null,
      rounds: withWeeks(b.consolation.rounds)
    } : null
  };
}
function requireLeagueId4(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse5("leagueId required");
  return lg;
}

// server/ops-finality.js
var import_server_sdk3 = require("@dissent/plugin-kit/server-sdk");

// core/league/eastern-time.js
function nthSundayUtcDay(year, month1, n) {
  const first = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  return 1 + (7 - first) % 7 + 7 * (n - 1);
}
function dstBounds(year) {
  const start = Date.UTC(year, 2, nthSundayUtcDay(year, 3, 2), 2 + 5);
  const end = Date.UTC(year, 10, nthSundayUtcDay(year, 11, 1), 2 + 4);
  return { start, end };
}
function etOffsetHours(utcMs) {
  const y = new Date(utcMs).getUTCFullYear();
  const { start, end } = dstBounds(y);
  return utcMs >= start && utcMs < end ? -4 : -5;
}
function etDateOf(utcMs) {
  const local = new Date(utcMs + etOffsetHours(utcMs) * 36e5);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}
function etWallTimeToUtc({ y, m, d }, hour) {
  const guess = Date.UTC(y, m - 1, d, hour + 5);
  return Date.UTC(y, m - 1, d, hour - etOffsetHours(guess));
}
function nextEtDate({ y, m, d }) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// core/league/week-finality.js
var LOCK_HOUR_ET = 9;
var BACKSTOP_MS = 3 * 24 * 36e5;
function finalityVerdict({ games, now, lastKickoffEstimate }) {
  const known = (games ?? []).filter((g) => Number.isFinite(g.kickoff));
  const last = known.length ? Math.max(...known.map((g) => g.kickoff)) : lastKickoffEstimate;
  if (!Number.isFinite(last)) return { lock: false, reason: "no games known for this week" };
  const backstopAt = last + BACKSTOP_MS;
  if (known.length === 0) {
    if (now >= backstopAt) return { lock: true, reason: "backstop", backstopAt };
    return { lock: false, reason: "no games known yet", backstopAt };
  }
  const lockAt = etWallTimeToUtc(nextEtDate(etDateOf(last)), LOCK_HOUR_ET);
  const pending = known.filter((g) => !g.completed).length;
  if (pending === 0 && now >= lockAt) return { lock: true, reason: "all-games-complete", lockAt, backstopAt };
  if (now >= backstopAt) return { lock: true, reason: "backstop", lockAt, backstopAt };
  if (pending > 0) return { lock: false, reason: `${pending} game(s) not complete`, lockAt, backstopAt };
  return { lock: false, reason: "waiting for 09:00 ET", lockAt, backstopAt };
}
function backstopKickoffEstimate(seasonStartDate, week) {
  const [y, m, d] = String(seasonStartDate).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + (week - 1) * 7));
  const toMonday = (1 - t.getUTCDay() + 7) % 7;
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + toMonday, 23, 59);
}

// core/league/espn-week.js
function scoreboardUrl(season, week) {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;
}
function gamesFromScoreboard(payload) {
  const events = payload?.events;
  if (!Array.isArray(events) || events.length === 0) return null;
  return events.map((e) => ({
    kickoff: Date.parse(e?.date),
    completed: e?.status?.type?.completed === true
  }));
}

// server/ops-finality.js
var refuse6 = (msg) => {
  throw new Error(msg);
};
function oldestOpenWeek(lg, season, upTo) {
  for (let w = 1; w <= upTo; w++) {
    const s = read(KEY.scores(lg, season, w), null);
    if (s && !s.final) return w;
  }
  return null;
}
function lastPassIfCurrent(lg, meta, season, week) {
  if (Number(meta?.season) === season && Number(meta?.currentWeek) === week) {
    runScoring(lg, season, week, { force: true });
  }
}
function stamp(lg, season, week, fields) {
  return mutate(KEY.scores(lg, season, week), (cur) => {
    if (!cur) return cur;
    const { reopenedAt: _a, reopenedBy: _b, ...rest } = cur;
    return { ...rest, final: true, finalAt: Date.now(), ...fields };
  }, null);
}
function finalizeOldestIfDue(lg, nflState2, now = Date.now()) {
  const meta = read(KEY.meta(lg), null);
  if (!meta) return { skipped: "no league" };
  const season = Number(meta.season);
  const week = oldestOpenWeek(lg, season, Number(meta.currentWeek ?? 0));
  if (!week) return { skipped: "nothing open" };
  const stored = read(KEY.scores(lg, season, week), null);
  if (Number.isFinite(stored?.lockAt) && now < stored.lockAt) {
    return { week, locked: false, reason: "waiting for 09:00 ET", lockAt: stored.lockAt };
  }
  let games = null;
  try {
    games = gamesFromScoreboard((0, import_server_sdk3.fetchJSON)({ url: scoreboardUrl(season, week) }));
  } catch {
    games = null;
  }
  const estimate = nflState2?.season_start_date ? backstopKickoffEstimate(nflState2.season_start_date, week) : void 0;
  const v = finalityVerdict({ games: games ?? [], now, lastKickoffEstimate: games ? void 0 : estimate });
  if (!v.lock) {
    if (Number.isFinite(v.lockAt) && v.lockAt !== stored?.lockAt) {
      mutate(KEY.scores(lg, season, week), (cur) => cur && !cur.final ? { ...cur, lockAt: v.lockAt } : cur, null);
    }
    return { week, locked: false, reason: v.reason, lockAt: v.lockAt ?? null };
  }
  lastPassIfCurrent(lg, meta, season, week);
  stamp(lg, season, week, { finalReason: v.reason });
  return { week, locked: true, reason: v.reason };
}
function commissionerWeek(p, payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse6("leagueId required");
  const { meta } = loadLeague(lg);
  if (!meta) refuse6(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse6(err);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  if (!Number.isInteger(week) || week < 1) refuse6("week must be a positive integer");
  return { lg, meta, season, week };
}
function scoredWeek(p, payload) {
  const w = commissionerWeek(p, payload);
  if (!read(KEY.scores(w.lg, w.season, w.week), null)) refuse6(`week ${w.week} has not been scored yet`);
  return w;
}
function finalizeWeek({ p, payload }) {
  const { lg, meta, season, week } = scoredWeek(p, payload);
  lastPassIfCurrent(lg, meta, season, week);
  stamp(lg, season, week, { finalReason: "commissioner", finalBy: p.userId });
  return { week, final: true };
}
function reopenWeek({ p, payload }) {
  const { lg, season, week } = scoredWeek(p, payload);
  mutate(KEY.scores(lg, season, week), (cur) => {
    if (!cur) return cur;
    const { final: _f, finalAt: _a, finalReason: _r, finalBy: _b, ...rest } = cur;
    return { ...rest, reopenedAt: Date.now(), reopenedBy: p.userId };
  }, null);
  return {
    week,
    final: false,
    note: "Reopened. It re-scores on the next run and locks again. A playoff round already decided from this week is NOT undone."
  };
}

// server/ops-coowners.js
var refuse7 = (msg) => {
  throw new Error(msg);
};
var MAX_LABEL = 40;
var cleanLabel = (v) => String(v ?? "").trim().slice(0, MAX_LABEL);
var pendingOf = (team) => (team?.coOwnerRequests ?? []).map(normalizeRequest);
var invitesOf = (team) => team?.coOwnerInvites ?? [];
function normalizeRequest(r) {
  return typeof r === "string" ? { userId: r, label: "", at: 0 } : r;
}
var MAX_CO_OWNERS = 3;
var MAX_PENDING = 5;
function requestCoOwnership({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse7(err);
  const lg = requireLeagueId5(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse7(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const withdraw = payload?.withdraw === true;
  let outcome = null;
  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const team = teams[teamId];
    if (!team) refuse7(`no such team: ${teamId}`);
    const pending = pendingOf(team);
    if (withdraw) {
      if (!pending.some((r) => r.userId === p.userId)) {
        outcome = "not-pending";
        return teams;
      }
      outcome = "withdrawn";
      return {
        ...teams,
        [teamId]: { ...team, coOwnerRequests: pending.filter((r) => r.userId !== p.userId) }
      };
    }
    if (team.ownerId === p.userId) refuse7("you already own this team");
    if ((team.coOwners ?? []).includes(p.userId)) {
      outcome = "already-co-owner";
      return teams;
    }
    const mine = teamsOf(teams, p.userId);
    if (mine.length > 0) refuse7(`you already manage team ${mine[0]} in this league`);
    if (pending.some((r) => r.userId === p.userId)) {
      outcome = "already-pending";
      return teams;
    }
    if (pending.length >= MAX_PENDING) refuse7("this team has too many pending requests");
    outcome = "requested";
    return {
      ...teams,
      [teamId]: {
        ...team,
        coOwnerRequests: [
          ...pending,
          { userId: p.userId, label: cleanLabel(payload?.label), at: Date.now() }
        ]
      }
    };
  }, {});
  return { leagueId: lg, teamId, outcome };
}
function respondToCoOwnerRequest({ p, payload }) {
  const lg = requireLeagueId5(payload);
  const { meta, teams: snapshot } = loadLeague(lg);
  if (!meta) refuse7(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamOwner(p, snapshot, meta, teamId);
  if (err) refuse7(err);
  const userId = String(payload?.userId ?? "");
  if (!userId) refuse7("userId required");
  const approve = payload?.approve !== false;
  let outcome = null;
  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const team = teams[teamId];
    if (!team) refuse7(`no such team: ${teamId}`);
    const pending = pendingOf(team);
    const asked = pending.find((r) => r.userId === userId);
    if (!asked) refuse7(`${userId} has no pending request for team ${teamId}`);
    const remaining = pending.filter((r) => r.userId !== userId);
    if (!approve) {
      outcome = "declined";
      return { ...teams, [teamId]: { ...team, coOwnerRequests: remaining } };
    }
    const mine = teamsOf(teams, userId);
    if (mine.length > 0) refuse7(`${userId} now manages team ${mine[0]} and cannot co-own another`);
    const coOwners = team.coOwners ?? [];
    if (coOwners.length >= MAX_CO_OWNERS) refuse7(`a team may have at most ${MAX_CO_OWNERS} co-owners`);
    outcome = "approved";
    return {
      ...teams,
      [teamId]: {
        ...team,
        coOwners: [...coOwners, userId],
        coOwnerRequests: remaining,
        // Carried across so the UI can name a co-owner it otherwise cannot
        // resolve. Cosmetic — see the note on MAX_LABEL.
        coOwnerLabels: { ...team.coOwnerLabels ?? {}, [userId]: asked.label }
      }
    };
  }, {});
  return { leagueId: lg, teamId, userId, outcome };
}
function removeCoOwner({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse7(err);
  const lg = requireLeagueId5(payload);
  const { meta, teams: snapshot } = loadLeague(lg);
  if (!meta) refuse7(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const userId = String(payload?.userId ?? p.userId);
  const team = snapshot?.[teamId];
  if (!team) refuse7(`no such team: ${teamId}`);
  const self = userId === p.userId;
  if (!self && team.ownerId !== p.userId && !isCommissioner(meta, p.userId)) {
    refuse7(`only the owner of team ${teamId} can remove its co-owners`);
  }
  if (team.ownerId === userId) refuse7("the owner cannot be removed \u2014 transfer the team instead");
  let outcome = null;
  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const current = teams[teamId];
    if (!current) refuse7(`no such team: ${teamId}`);
    const coOwners = current.coOwners ?? [];
    if (!coOwners.includes(userId)) {
      outcome = "not-a-co-owner";
      return teams;
    }
    outcome = "removed";
    const labels = { ...current.coOwnerLabels ?? {} };
    delete labels[userId];
    return {
      ...teams,
      [teamId]: { ...current, coOwners: coOwners.filter((u) => u !== userId), coOwnerLabels: labels }
    };
  }, {});
  return { leagueId: lg, teamId, userId, outcome };
}
function inviteCoOwner({ p, payload }) {
  const lg = requireLeagueId5(payload);
  const { meta, teams: snapshot } = loadLeague(lg);
  if (!meta) refuse7(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamOwner(p, snapshot, meta, teamId);
  if (err) refuse7(err);
  const userId = String(payload?.userId ?? "");
  if (!userId) refuse7("userId required");
  const withdraw = payload?.withdraw === true;
  let outcome = null;
  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const team = teams[teamId];
    if (!team) refuse7(`no such team: ${teamId}`);
    const invites = invitesOf(team);
    if (withdraw) {
      if (!invites.some((i) => i.userId === userId)) {
        outcome = "not-invited";
        return teams;
      }
      outcome = "withdrawn";
      return { ...teams, [teamId]: { ...team, coOwnerInvites: invites.filter((i) => i.userId !== userId) } };
    }
    if (team.ownerId === userId) refuse7("you already own this team");
    if ((team.coOwners ?? []).includes(userId)) {
      outcome = "already-co-owner";
      return teams;
    }
    const theirs = teamsOf(teams, userId);
    if (theirs.length > 0) refuse7(`${userId} already manages team ${theirs[0]} in this league`);
    if (invites.some((i) => i.userId === userId)) {
      outcome = "already-invited";
      return teams;
    }
    if (invites.length >= MAX_PENDING) refuse7("this team has too many pending invites");
    if ((team.coOwners ?? []).length >= MAX_CO_OWNERS) refuse7(`a team may have at most ${MAX_CO_OWNERS} co-owners`);
    outcome = "invited";
    return {
      ...teams,
      [teamId]: {
        ...team,
        coOwnerInvites: [...invites, { userId, label: cleanLabel(payload?.label), at: Date.now(), by: p.userId }]
      }
    };
  }, {});
  return { leagueId: lg, teamId, userId, outcome };
}
function acceptCoOwnerInvite({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse7(err);
  const lg = requireLeagueId5(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse7(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const accept = payload?.accept !== false;
  let outcome = null;
  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const team = teams[teamId];
    if (!team) refuse7(`no such team: ${teamId}`);
    const invites = invitesOf(team);
    const offer = invites.find((i) => i.userId === p.userId);
    if (!offer) refuse7(`you have no invite to team ${teamId}`);
    const remaining = invites.filter((i) => i.userId !== p.userId);
    if (!accept) {
      outcome = "declined";
      return { ...teams, [teamId]: { ...team, coOwnerInvites: remaining } };
    }
    const mine = teamsOf(teams, p.userId);
    if (mine.length > 0) refuse7(`you already manage team ${mine[0]} in this league`);
    const coOwners = team.coOwners ?? [];
    if (coOwners.length >= MAX_CO_OWNERS) refuse7(`a team may have at most ${MAX_CO_OWNERS} co-owners`);
    outcome = "accepted";
    return {
      ...teams,
      [teamId]: {
        ...team,
        coOwners: [...coOwners, p.userId],
        coOwnerInvites: remaining,
        // A standing request from the same person is answered by this.
        coOwnerRequests: pendingOf(team).filter((r) => r.userId !== p.userId),
        coOwnerLabels: { ...team.coOwnerLabels ?? {}, [p.userId]: offer.label }
      }
    };
  }, {});
  return { leagueId: lg, teamId, outcome };
}
function requireLeagueId5(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse7("leagueId required");
  return lg;
}

// server/ops-identity.js
var refuse8 = (msg) => {
  throw new Error(msg);
};
function must(result) {
  if (!result.ok) refuse8(result.error);
  return result;
}
function renameTeam({ p, payload }) {
  const lg = requireLeagueId6(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse8(`no such league: ${lg}`);
  const teams = read(KEY.teams(lg), {});
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamOwner(p, teams, meta, teamId);
  if (err) refuse8(err);
  const { name } = must(checkTeamName(payload?.name));
  mutate(KEY.teams(lg), (cur) => {
    const current = cur ?? {};
    const team = current[teamId];
    if (!team) refuse8(`no such team: ${teamId}`);
    const clash = nameTaken(current, name, teamId);
    if (clash) refuse8(`"${name}" clashes with team ${clash} ("${current[clash].name}")`);
    return { ...current, [teamId]: { ...team, name } };
  }, {});
  return { leagueId: lg, teamId, name };
}
function setTeamIdentity({ p, payload }) {
  const lg = requireLeagueId6(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse8(`no such league: ${lg}`);
  const teams = read(KEY.teams(lg), {});
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamOwner(p, teams, meta, teamId);
  if (err) refuse8(err);
  const patch = {};
  for (const [field, label] of [["avatarFileId", "avatar"], ["bannerFileId", "banner"]]) {
    if (payload?.[field] === void 0) continue;
    patch[field] = must(checkFileId(payload[field], label)).fileId;
  }
  if (Object.keys(patch).length === 0) refuse8("nothing to set: pass avatarFileId or bannerFileId");
  mutate(KEY.teams(lg), (cur) => {
    const current = cur ?? {};
    const team = current[teamId];
    if (!team) refuse8(`no such team: ${teamId}`);
    return { ...current, [teamId]: { ...team, ...patch } };
  }, {});
  const settled = read(KEY.teams(lg), {})[teamId] ?? {};
  return {
    leagueId: lg,
    teamId,
    avatarFileId: settled.avatarFileId ?? "",
    bannerFileId: settled.bannerFileId ?? ""
  };
}
function setLeagueIdentity({ p, payload }) {
  const lg = requireLeagueId6(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse8(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse8(err);
  if (payload?.bannerFileId === void 0) refuse8("nothing to set: pass bannerFileId");
  const { fileId } = must(checkFileId(payload.bannerFileId, "banner"));
  mutate(KEY.meta(lg), (m) => ({ ...m ?? meta, bannerFileId: fileId }), meta);
  return { leagueId: lg, bannerFileId: read(KEY.meta(lg), {}).bannerFileId ?? "" };
}
function requireLeagueId6(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse8("leagueId required");
  return lg;
}

// server/version.js
var MODULE_VERSION = "2.47.0";

// server/main.js
var OPS = {
  // Diagnostics — kept from 0.1.0 because they are how the publish path is
  // verified against a live node without any league existing.
  ping: ({ payload }) => ({ pong: true, module_version: MODULE_VERSION, echo: payload ?? null }),
  "diag:storage": () => {
    const key = "diag:roundtrip";
    const wrote = { at: MODULE_VERSION, n: (import_server_sdk5.storage.get(key)?.n ?? 0) + 1 };
    import_server_sdk5.storage.set(key, wrote);
    return { wrote, read: import_server_sdk5.storage.get(key) };
  },
  "diag:swap": () => {
    const before = import_server_sdk5.storage.getVersioned("diag:counter");
    const after = import_server_sdk5.storage.swap("diag:counter", (c) => ({ n: (c?.n ?? 0) + 1 }), { fallback: { n: 0 } });
    return { before_version: before.version, after, version: import_server_sdk5.storage.getVersioned("diag:counter").version };
  },
  "diag:whoami": ({ p }) => ({ userId: p.userId, scheduled: p.scheduled }),
  // League
  "league:create": createLeague,
  "league:list": listLeagues,
  "league:get": getLeague,
  "league:join": joinLeague,
  "league:settings": updateSettings,
  // Identity — what a team and a league LOOK like. Owner-only and
  // commissioner-only respectively; see server/ops-identity.js for why an image
  // is stored as a node file id and never as a URL.
  "team:rename": renameTeam,
  "team:identity": setTeamIdentity,
  "league:identity": setLeagueIdentity,
  "schedule:generate": generateSchedule,
  "schedule:get": getSchedule,
  // Co-ownership — a handshake, so both ids come from a verified session.
  // Both directions are handshakes — see ops-coowners.js for why neither is a grant.
  "team:coowner:request": requestCoOwnership,
  "team:coowner:respond": respondToCoOwnerRequest,
  "team:coowner:remove": removeCoOwner,
  "team:coowner:invite": inviteCoOwner,
  "team:coowner:accept": acceptCoOwnerInvite,
  // Rosters and lineups
  "lineup:set": setLineup,
  "lineup:get": getLineup,
  "autosub:set": setAutoSubs,
  "autosub:get": getAutoSubs,
  "tradeblock:set": setTradeBlock,
  "tradeblock:get": getTradeBlock,
  "roster:add": addFreeAgent,
  "roster:drop": dropFreeAgent,
  "roster:move": movePlayer,
  // Draft
  "draft:create": createLeagueDraft,
  "draft:start": startLeagueDraft,
  "draft:get": getDraft,
  "draft:pick": makeDraftPick,
  "draft:queue": setDraftQueue,
  "draft:auto": setDraftAuto,
  "draft:pause": setDraftPaused,
  "draft:finalize": finalizeDraft,
  // Waivers
  "waiver:submit": submitClaim,
  "waiver:cancel": cancelClaim,
  "waiver:list": listClaims,
  // Trades
  "trade:propose": proposeLeagueTrade,
  "trade:respond": respondToTrade,
  "trade:commissioner": commissionerTrade,
  "trade:list": listTrades,
  // Scoring
  "scores:get": getScores,
  "standings:get": getStandings,
  "playoffs:start": startPlayoffs,
  "playoffs:get": getPlayoffs,
  "league:week": setCurrentWeek,
  "week:finalize": finalizeWeek,
  "week:reopen": reopenWeek,
  "positions:refresh": refreshPositions,
  // Scheduled only — these refuse a user-triggered run themselves, in auth.js.
  "tick:waivers": runWaivers,
  "waiver:wire": getWaiverWire,
  "tick:trades": settleTrades,
  "tick:scores": scoreWeekForLeague
};
function runScheduledTick(p) {
  const leagues = import_server_sdk5.storage.get("fl:index") ?? [];
  const results = [];
  if (leagues.length > 0 && positionsAreStale()) {
    try {
      results.push({ task: "positions", result: refreshPositions({ p, payload: {} }) });
    } catch (err) {
      (0, import_server_sdk4.log)(`tick positions failed: ${err.message}`);
      results.push({ task: "positions", error: String(err.message ?? err) });
    }
  }
  let state = null;
  if (leagues.length > 0) {
    try {
      state = nflState();
    } catch (err) {
      (0, import_server_sdk4.log)(`tick: could not read the NFL state: ${err.message}`);
    }
  }
  for (const leagueId of leagues) {
    if (state) {
      try {
        const adv = advanceWeekIfDue(leagueId, state);
        if (adv.advanced) results.push({ leagueId, task: "week", result: adv });
      } catch (err) {
        (0, import_server_sdk4.log)(`tick week advance failed for ${leagueId}: ${err.message}`);
      }
    }
    const meta = import_server_sdk5.storage.get(`fl:${leagueId}:meta`);
    if (!meta) continue;
    const season = meta.season;
    const week = meta.currentWeek ?? null;
    for (const [name, fn, payload] of [
      ["trades", settleTrades, { leagueId }],
      ["waivers", runWaivers, { leagueId, season, week }],
      // ⚠️ AFTER the waiver run, never before: a player won this tick must come
      // off the wire first, or the sweep would "clear" a now-rostered player
      // into free agency.
      ["wire", () => sweepWaiverWire(leagueId), null],
      // ⚠️ Scoring is called through runScoring, not the op, because the op
      // requires a scheduled principal and re-checking it here would be a second
      // definition of the same rule.
      ["scores", () => runScoring(leagueId, season, week), null],
      // After scoring, not before: a round is decided by the week that was just
      // scored, so advancing first would always be one tick behind.
      ["playoffs", () => resolveBracketsFor(leagueId, season), null],
      // After scoring, so the lock follows the freshest pass. The bracket reads the new `final`
      // on the NEXT tick — five minutes late, which is fine for a result that waited all week.
      ["finality", () => finalizeOldestIfDue(leagueId, state), null]
    ]) {
      if ((name === "waivers" || name === "scores") && !week) continue;
      try {
        results.push({ leagueId, task: name, result: fn({ p, payload }) });
      } catch (err) {
        (0, import_server_sdk4.log)(`tick ${name} failed for ${leagueId}: ${err.message}`);
        results.push({ leagueId, task: name, error: String(err.message ?? err) });
      }
    }
  }
  for (const leagueId of leagues) {
    let repaired = null;
    try {
      repaired = backfillOneWeek(leagueId);
    } catch (err) {
      (0, import_server_sdk4.log)(`tick backfill failed for ${leagueId}: ${err.message}`);
    }
    if (repaired) {
      results.push({ leagueId, task: "backfill", result: repaired });
      break;
    }
  }
  return { tick: true, leagues: leagues.length, results };
}
function run() {
  const req = (0, import_server_sdk4.input)() ?? {};
  const p = principal(import_server_sdk4.caller);
  if (p.scheduled && !req.op) {
    try {
      (0, import_server_sdk4.output)({ ok: true, data: runScheduledTick(p) });
    } catch (err) {
      (0, import_server_sdk4.log)(`scheduled tick failed: ${err.message}`);
      (0, import_server_sdk4.output)({ ok: false, error: String(err.message ?? err) });
    }
    return 0;
  }
  const handler = OPS[req.op];
  if (!handler) {
    (0, import_server_sdk4.output)({ ok: false, error: `unknown op: ${req.op ?? "(none)"}`, ops: Object.keys(OPS) });
    return 0;
  }
  try {
    (0, import_server_sdk4.output)({ ok: true, data: handler({ p, payload: req.payload }) });
  } catch (err) {
    (0, import_server_sdk4.log)(`${req.op} failed: ${err.message}`);
    (0, import_server_sdk4.output)({ ok: false, error: String(err.message ?? err) });
  }
  return 0;
}
module.exports = { run };
