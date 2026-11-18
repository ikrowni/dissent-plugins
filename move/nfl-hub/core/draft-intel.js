// core/draft-intel.js — what the board already knows, said out loud.
//
// PURE. No fetch, no new data, no new state. Everything here is derived from the
// picks and the ranked pool the draft board is already holding, which is the whole
// reason the ticker costs nothing: it is a read of what is on screen.
//
// ⚠️ THE TICKER IS NOT A FEED OF FACTS, IT IS A FEED OF MOMENTS. A strip that
// always has something to say is noise, and people stop reading it after about four
// picks. Everything here can return null, and null is the common case.

/** How many recent picks a run is measured over. */
export const RUN_WINDOW = 6;
/** How many of that window must share a position before it is a run. */
export const RUN_THRESHOLD = 4;
/** "Top N" — the tier scarcity is counted against. */
export const SCARCITY_TIER = 12;

/**
 * The last `n` picks, most recent first.
 *
 * ⚠️ SORTED NUMERICALLY. `picks` is an object keyed by overall pick number, and
 * Object.keys returns '10' before '9' as strings. Past the ninth pick a string sort
 * reports the wrong "most recent" pick, and every window built on it is junk —
 * silently, because the board itself looks perfectly correct.
 */
export function recentPicks(picks = {}, n = RUN_WINDOW) {
  return Object.entries(picks ?? {})
    .map(([overall, p]) => ({ ...p, overall: Number(overall) }))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, Math.max(0, n));
}

/**
 * Is a position running?
 *
 * Returns `{ pos, count, window }` or null. The window is reported back so the
 * rendered sentence and the arithmetic can never disagree about "the last 6".
 *
 * ⚠️ UNKNOWN POSITIONS ARE DROPPED, not grouped. The player index resolves ~95% of
 * ids; without this the unresolved remainder collect under '' and a board of
 * six unknowns announces a run on nothing.
 */
export function detectRun(picks = {}, {
  positionOf = () => null, window = RUN_WINDOW, threshold = RUN_THRESHOLD,
} = {}) {
  const counts = new Map();
  for (const pick of recentPicks(picks, window)) {
    const pos = String(positionOf(pick.playerId) ?? '').toUpperCase();
    if (!pos) continue;
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }

  let best = null;
  for (const [pos, count] of counts) {
    if (count < threshold) continue;
    if (best === null || count > best.count) best = { pos, count, window };
  }
  return best;
}

/**
 * The plain-English name of a position, for a sentence rather than a table.
 *
 * ⚠️ A ticker is read aloud in somebody's head. "2 top-12 RB left" is a cell in a
 * spreadsheet; "2 top-12 backs left" is a broadcast.
 */
const NOUN = {
  QB: ['quarterback', 'quarterbacks'],
  RB: ['back', 'backs'],
  WR: ['receiver', 'receivers'],
  TE: ['tight end', 'tight ends'],
  K: ['kicker', 'kickers'],
  DEF: ['defence', 'defences'],
};

function noun(pos, n) {
  const pair = NOUN[String(pos ?? '').toUpperCase()];
  if (!pair) return String(pos ?? '').toUpperCase();
  return n === 1 ? pair[0] : pair[1];
}

/**
 * How many of a position are left inside its own top tier.
 *
 * ⚠️ RANKED WITHIN THE POSITION, not overall. "Top-12 backs" means the twelve best
 * backs; measuring against the overall top 12 would report zero tight ends left in
 * every draft ever played, which is a true number answering the wrong question.
 *
 * `pool` is what `availablePool()` returns — `{ id, pos, rank }`, already ordered
 * best-first, so position rank is just the index within the filtered list.
 */
export function scarcityAt(pool = [], pos, { tier = SCARCITY_TIER } = {}) {
  const want = String(pos ?? '').toUpperCase();
  if (!want) return 0;
  let seen = 0;
  for (const entry of pool ?? []) {
    if (String(entry?.pos ?? '').toUpperCase() !== want) continue;
    seen += 1;
    if (seen >= tier) break;
  }
  return Math.min(seen, tier);
}

/**
 * The one sentence the ticker has, or null.
 *
 * ⚠️ NULL IS THE COMMON CASE AND THE STRIP MUST STILL KEEP ITS HEIGHT. See
 * renderTicker in views/draft-board.js: a collapsing strip shifts the board
 * mid-draft, which is the worst possible moment to move a click target.
 */
export function tickerLine({ picks = {}, positionOf = () => null, pool = [] } = {}) {
  const run = detectRun(picks, { positionOf });
  if (!run) return null;

  const left = scarcityAt(pool, run.pos);
  const head = `${run.count} of the last ${run.window} picks were ${run.pos}`;
  const text = left > 0
    ? `${head} — ${left} top-${SCARCITY_TIER} ${noun(run.pos, left)} left`
    : head;

  return { flag: 'RUN', pos: run.pos, text };
}

/** How many rows the live rail holds. Past this it is a transaction log, not news. */
export const FEED_LIMIT = 8;

/**
 * The live rail: picks as they land, newest first.
 *
 * ⚠️ DERIVED, NOT RECORDED. There is no event log and this does not add one — the
 * picks object IS the history, and reading it backwards is the whole feature. A
 * stored log would be a second source of truth that could disagree with the board
 * it sits beside.
 */
export function feedItems({
  picks = {}, playerOf = () => null, teamLabel = (t) => String(t), limit = FEED_LIMIT,
} = {}) {
  return recentPicks(picks, limit).map((pick) => {
    const p = playerOf(pick.playerId);
    return {
      kind: 'pick',
      overall: pick.overall,
      playerId: String(pick.playerId),
      name: p?.n ?? String(pick.playerId),
      pos: String(p?.p ?? '').toUpperCase(),
      team: teamLabel(pick.teamId),
      auto: Boolean(pick.auto),
    };
  });
}
