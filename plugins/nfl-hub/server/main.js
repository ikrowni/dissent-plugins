// nfl-hub server module — the op router the node executes.
//
// ⚠️ MUST BE BUNDLED BEFORE COMPILING. extism-js does not resolve imports — see
// build.sh. The browser half of this plugin needs no such step, which is a real
// difference between the two halves.
//
// ⚠️ NOT `export function run` — bundled to CJS, extism-js looks for
// `module.exports.run`. With `export` esbuild treats this as ESM, silently drops
// the assignment at the bottom, and emits a wasm with no entry point at all. It
// BUILDS CLEANLY either way; only running it shows the difference.

import { log, input, output, caller } from "./sdk/server-sdk.js";
import { principal } from "./auth.js";
import { storage } from "./sdk/server-sdk.js";
import {
  createLeague, listLeagues, getLeague, joinLeague, updateSettings,
  setLineup, getLineup, addFreeAgent, dropFreeAgent, movePlayer,
  generateSchedule, getSchedule,
} from "./ops-league.js";
import {
  createLeagueDraft, startLeagueDraft, getDraft, makeDraftPick,
  setDraftQueue, setDraftPaused, finalizeDraft,
} from "./ops-draft.js";
import {
  submitClaim, cancelClaim, listClaims, runWaivers,
  proposeLeagueTrade, respondToTrade, commissionerTrade, listTrades, settleTrades,
} from "./ops-transactions.js";
import {
  refreshPositions, scoreWeekForLeague, getScores, setCurrentWeek,
  runScoring, positionsAreStale, getStandings,
} from "./ops-scoring.js";
import { startPlayoffs, getPlayoffs, resolveBracketsFor } from "./ops-playoffs.js";

const MODULE_VERSION = "0.6.0";

// A flat table rather than a switch, so the op list is greppable and each op
// stays independently testable.
const OPS = {
  // Diagnostics — kept from 0.1.0 because they are how the publish path is
  // verified against a live node without any league existing.
  ping: ({ payload }) => ({ pong: true, module_version: MODULE_VERSION, echo: payload ?? null }),
  "diag:storage": () => {
    const key = "diag:roundtrip";
    const wrote = { at: MODULE_VERSION, n: (storage.get(key)?.n ?? 0) + 1 };
    storage.set(key, wrote);
    return { wrote, read: storage.get(key) };
  },
  "diag:swap": () => {
    const before = storage.getVersioned("diag:counter");
    const after = storage.swap("diag:counter", (c) => ({ n: (c?.n ?? 0) + 1 }), { fallback: { n: 0 } });
    return { before_version: before.version, after, version: storage.getVersioned("diag:counter").version };
  },
  "diag:whoami": ({ p }) => ({ userId: p.userId, scheduled: p.scheduled }),

  // League
  "league:create": createLeague,
  "league:list": listLeagues,
  "league:get": getLeague,
  "league:join": joinLeague,
  "league:settings": updateSettings,
  "schedule:generate": generateSchedule,
  "schedule:get": getSchedule,

  // Rosters and lineups
  "lineup:set": setLineup,
  "lineup:get": getLineup,
  "roster:add": addFreeAgent,
  "roster:drop": dropFreeAgent,
  "roster:move": movePlayer,

  // Draft
  "draft:create": createLeagueDraft,
  "draft:start": startLeagueDraft,
  "draft:get": getDraft,
  "draft:pick": makeDraftPick,
  "draft:queue": setDraftQueue,
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
  "positions:refresh": refreshPositions,

  // Scheduled only — these refuse a user-triggered run themselves, in auth.js.
  "tick:waivers": runWaivers,
  "tick:trades": settleTrades,
  "tick:scores": scoreWeekForLeague,
};

/**
 * The scheduled tick.
 *
 * ⚠️ EVERY LEAGUE, EVERY TICK, WITHIN 5 SECONDS. A league whose work does not
 * fit must be chunked across ticks rather than allowed to run long — the runtime
 * kills the invocation at the deadline and whatever had not been written is
 * simply lost. Each league's work is wrapped so one bad league cannot stop the
 * others from being processed.
 */
function runScheduledTick(p) {
  const leagues = storage.get("fl:index") ?? [];
  const results = [];

  // Positions first: everything that validates or scores a lineup depends on
  // them, and a week-old map is fine — positions change on signings, not hourly.
  // Refreshed before the leagues so the very first tick of a new install has
  // them, rather than skipping a week.
  if (leagues.length > 0 && positionsAreStale()) {
    try {
      results.push({ task: "positions", result: refreshPositions({ p, payload: {} }) });
    } catch (err) {
      log(`tick positions failed: ${err.message}`);
      results.push({ task: "positions", error: String(err.message ?? err) });
    }
  }
  for (const leagueId of leagues) {
    const meta = storage.get(`fl:${leagueId}:meta`);
    if (!meta) continue;
    const season = meta.season;
    const week = meta.currentWeek ?? null;

    for (const [name, fn, payload] of [
      ["trades", settleTrades, { leagueId }],
      ["waivers", runWaivers, { leagueId, season, week }],
      // ⚠️ Scoring is called through runScoring, not the op, because the op
      // requires a scheduled principal and re-checking it here would be a second
      // definition of the same rule.
      ["scores", () => runScoring(leagueId, season, week), null],
      // After scoring, not before: a round is decided by the week that was just
      // scored, so advancing first would always be one tick behind.
      ["playoffs", () => resolveBracketsFor(leagueId, season), null],
    ]) {
      if ((name === "waivers" || name === "scores") && !week) continue;
      try {
        results.push({ leagueId, task: name, result: fn({ p, payload }) });
      } catch (err) {
        // One league's failure must not stop the tick. Logged so it is visible
        // in the node log rather than swallowed into a success.
        log(`tick ${name} failed for ${leagueId}: ${err.message}`);
        results.push({ leagueId, task: name, error: String(err.message ?? err) });
      }
    }
  }
  return { tick: true, leagues: leagues.length, results };
}

function run() {
  const req = input() ?? {};
  const p = principal(caller);

  // A scheduled run arrives with {"trigger":"schedule"} and no op.
  if (p.scheduled && !req.op) {
    try {
      output({ ok: true, data: runScheduledTick(p) });
    } catch (err) {
      log(`scheduled tick failed: ${err.message}`);
      output({ ok: false, error: String(err.message ?? err) });
    }
    return 0;
  }

  const handler = OPS[req.op];
  if (!handler) {
    // Named ops only. An unknown op is a caller bug and is never guessed at.
    output({ ok: false, error: `unknown op: ${req.op ?? "(none)"}`, ops: Object.keys(OPS) });
    return 0;
  }

  try {
    output({ ok: true, data: handler({ p, payload: req.payload }) });
  } catch (err) {
    // A refusal — an illegal move, a permission failure, a host limit — is
    // reported as data rather than trapping, so the caller gets a usable message
    // instead of an opaque "trap" outcome.
    log(`${req.op} failed: ${err.message}`);
    output({ ok: false, error: String(err.message ?? err) });
  }
  return 0;
}

module.exports = { run };
