// server/store.js — the league's key schema, and which keys need atomicity.
//
// ⚠️ THE SPLIT IS THE DESIGN. Keys that must change TOGETHER share one value;
// everything else is split apart so it never contends. Getting this wrong is not
// a performance problem, it is a correctness one:
//
//   - `assets` holds rosters, FAAB budgets and pick ownership in ONE value,
//     because a trade moves all three and compare-and-swap is per-key. A trade
//     that moved the players but not the $40 is not a smaller trade, it is a
//     wrong one, and nothing can undo it but a commissioner.
//   - `lineup` is per team per week: the highest-frequency write in the product
//     and the one with exactly one legitimate writer. It must never share a key.
//   - `draft` is one value because a pick is atomic, and ownership during a
//     draft is derived from the picks rather than written to `assets`.
//
// Sizing, so the choices stay honest: 14 dynasty teams x 40 players x ~8 bytes
// of id is about 6 KB, against the host's 256 KiB per-value limit.

import { storage } from "./sdk/server-sdk.js";

export const KEY = {
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
  audit: (lg, chunk) => `fl:${lg}:audit:${chunk}`,
};

/**
 * Keys whose writers contend, and therefore MUST go through `swap`.
 *
 * Listed rather than left to judgement: "is this contended?" is exactly the
 * question someone answers wrongly at 1am, and `set` on a contended key loses
 * updates silently — no error, no trace, just a claim that vanishes.
 */
export const CONTENDED = ["assets", "draft", "waivers", "trade", "meta", "teams", "tradeIndex", "bracket"];

/** Read a value, or a fallback when unset. */
export function read(key, fallback = null) {
  const v = storage.get(key);
  return v === null || v === undefined ? fallback : v;
}

/**
 * Read-modify-write a contended key atomically.
 *
 * `mutate` may be called MORE THAN ONCE — on a conflict the SDK re-reads the
 * winning value and applies it again — so it must be free of side effects. No
 * logging, no posting, no counters.
 */
export function mutate(key, fn, fallback = null) {
  return storage.swap(key, fn, { fallback });
}

/**
 * Write a key with exactly one legitimate writer (a lineup, a scores row).
 *
 * ⚠️ Do NOT use this for anything in CONTENDED. It is last-write-wins.
 */
export function writeUncontended(key, value) {
  return storage.set(key, value);
}

/** The league ids on this install. */
export function leagueIndex() {
  return read(KEY.index(), []);
}

/**
 * Load the whole league, for an operation that needs several parts.
 *
 * ⚠️ THIS IS NOT AN ATOMIC SNAPSHOT. Each key is read separately, so two of them
 * can come from either side of somebody else's write. That is fine for
 * rendering, and NEVER fine for a decision that is then written back — for that,
 * mutate the one key that owns the state and re-read inside the swap.
 */
export function loadLeague(lg) {
  return {
    id: lg,
    meta: read(KEY.meta(lg), null),
    teams: read(KEY.teams(lg), {}),
    assets: read(KEY.assets(lg), { rosters: {}, budgets: {}, pickOwnership: [] }),
  };
}
