// core/mock-draft.js — practise a draft against bots, entirely in the browser.
//
// PURE. No network, no module, no league. A mock is a rehearsal: nothing it does
// is written anywhere, which is the whole point — you can blow a first-round
// pick and find out what that feels like at no cost.
//
// ⚠️ IT DRIVES THE REAL DRAFT ENGINE. Order, pick legality and completion all
// come from core/league/{draft,draft-order}.js — the same code the live draft
// runs on the node. A separate mock implementation would drift, and the one
// thing a rehearsal must do is behave like the real event.
//
// ⚠️ SEEDED, so a mock is reproducible. Given the same seed the bots make the
// same picks, which is what lets this be tested at all and lets somebody replay
// a board they want to think about.

import { DRAFT_TYPE } from './league/draft-order.js';
import { createDraft, startDraft, makePick, currentPick, draftedPlayerIds } from './league/draft.js';

/** Positions a bot will actually spend a pick on. */
const STARTABLE = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/**
 * How many of each position a full starting lineup wants, and the most a sane
 * roster carries.
 *
 * ⚠️ THE CAPS ARE WHAT STOP A BOT DRAFTING SIX QUARTERBACKS. Pure
 * best-available with no positional memory produces exactly that, and a board
 * full of it makes the rehearsal worthless.
 */
export const POSITION_CAP = Object.freeze({ QB: 2, RB: 6, WR: 6, TE: 2, K: 1, DEF: 1 });

/** A small, fast, seeded PRNG. Reproducible mocks beat pretty ones. */
export function rngFrom(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Starting slots a roster template asks for, as a position count. */
export function startingNeed(rosterPositions = []) {
  const need = {};
  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;
    // FLEX is a real need but not for a specific position — counted separately
    // so a bot fills it with whichever of RB/WR/TE it values most.
    const key = slot === 'FLEX' ? 'FLEX' : slot;
    need[key] = (need[key] ?? 0) + 1;
  }
  return need;
}

/** What one team still wants, given what it already has. */
export function remainingNeed(rosterPositions, ownedPositions) {
  const need = startingNeed(rosterPositions);
  const have = {};
  for (const p of ownedPositions) have[p] = (have[p] ?? 0) + 1;

  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const used = Math.min(have[pos] ?? 0, need[pos] ?? 0);
    if (need[pos]) need[pos] -= used;
    have[pos] = (have[pos] ?? 0) - used;
  }
  // Whatever is left over of RB/WR/TE can cover FLEX.
  let spare = ['RB', 'WR', 'TE'].reduce((n, p) => n + Math.max(0, have[p] ?? 0), 0);
  if (need.FLEX) need.FLEX = Math.max(0, need.FLEX - spare);
  for (const k of Object.keys(need)) if (need[k] <= 0) delete need[k];
  return need;
}

/**
 * Which player a bot takes.
 *
 * ⚠️ NEED BEATS RANK, BUT ONLY WITHIN A WINDOW. A bot that always took the best
 * available ends up with five running backs and no quarterback; one that always
 * chased need reaches wildly for a kicker in round three. So it looks at the top
 * `window` available players and prefers the best one that fills an unmet
 * starting slot — a real manager's compromise.
 *
 * ⚠️ Late rounds relax the caps: once starters are filled the right move is
 * simply the best player left, which is also what makes the last rounds of a
 * mock look like a real draft rather than a checklist.
 */
export function botPick(available, { need, owned, rng = Math.random, window = 8 }) {
  if (available.length === 0) return null;
  const counts = {};
  for (const p of owned) counts[p.pos] = (counts[p.pos] ?? 0) + 1;
  const overCap = (pos) => (counts[pos] ?? 0) >= (POSITION_CAP[pos] ?? 99);

  // ⚠️ THE CAP IS A FILTER, NOT A PENALTY. As a score penalty it was decisive
  // only while something else sat in the window — late on, when the top of the
  // board is all one position, the least-bad option still won and a bot ended up
  // with a third quarterback. Filtering first, and only widening the search when
  // the window is exhausted, makes it hold whenever an alternative exists at all.
  let pool = available.slice(0, Math.max(1, window)).filter((e) => !overCap(e.pos));
  if (pool.length === 0) pool = available.filter((e) => !overCap(e.pos)).slice(0, window);
  // Nothing under the cap anywhere: a pick still has to be made.
  if (pool.length === 0) pool = available.slice(0, Math.max(1, window));

  const scored = pool.map((entry, i) => {
    const pos = String(entry.pos ?? '').toUpperCase();
    // Rank is the baseline: earlier in the ranking is better.
    let score = pool.length - i;
    const fillsNeed = (need[pos] ?? 0) > 0
      || (need.FLEX > 0 && (pos === 'RB' || pos === 'WR' || pos === 'TE'));
    if (fillsNeed) score += pool.length * 0.6;
    // ⚠️ Kickers and defences last. Nobody takes a kicker in round two, and a
    // board where a bot does reads as broken rather than as a bold strategy.
    if ((pos === 'K' || pos === 'DEF') && Object.keys(need).some((k) => k !== 'K' && k !== 'DEF')) {
      score -= pool.length * 5;
    }
    // ⚠️ Enough noise to actually reach. At ±1.5 the ranking gaps swamped it and
    // twelve bots drafted the board in order, which looks like a spreadsheet
    // rather than a draft room. Scaled to the pool so it stays a reach of a few
    // spots rather than a random pick.
    return { entry, score: score + rng() * pool.length * 0.45 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].entry.id;
}

/**
 * Set up a mock.
 *
 * `ranking` is an ordered list of player ids; `positionOf` resolves one to a
 * position. `slot` is which seat (1-based) the human takes.
 */
export function createMock({
  teams = 12, rounds = 15, slot = 1, type = DRAFT_TYPE.SNAKE,
  rosterPositions = [], ranking = [], positionOf = () => null, seed = 1,
} = {}) {
  const teamIds = Array.from({ length: teams }, (_, i) => `m${i + 1}`);
  // ⚠️ `draftOrder` (the team list), not a pre-built order — createDraft
  // generates the snake itself. Handing it an already-generated order leaves
  // `order: []`, and a draft with no picks reports nobody on the clock forever.
  //
  // ⚠️ pickTimerSeconds 0 on purpose: a mock has no clock. The human thinks for
  // as long as they like and the bots move the instant they are asked.
  const built = createDraft({ draftOrder: teamIds, rounds, type, pickTimerSeconds: 0, season: 0 });
  const started = startDraft(built, Date.now());
  return {
    draft: started.draft,
    teamIds,
    myTeam: teamIds[Math.min(Math.max(1, slot), teams) - 1],
    ranking: ranking.map(String),
    positionOf,
    rosterPositions,
    rng: rngFrom(seed),
    seed,
    log: [],
  };
}

/** Players still on the board, in ranking order. */
export function availableIn(mock) {
  const taken = new Set(draftedPlayerIds(mock.draft));
  const out = [];
  for (const id of mock.ranking) {
    if (taken.has(id)) continue;
    out.push({ id, pos: String(mock.positionOf(id) ?? '').toUpperCase() });
  }
  return out;
}

/** Everything one team has taken so far. */
export function rosterOf(mock, teamId) {
  return Object.values(mock.draft.picks ?? {})
    .filter((p) => String(p.teamId) === String(teamId))
    .map((p) => ({ id: String(p.playerId), pos: String(mock.positionOf(p.playerId) ?? '').toUpperCase() }));
}

/** Whose turn it is, or null when the board is full. */
export function onTheClock(mock) {
  return currentPick(mock.draft);
}

/** Record one pick — the human's or a bot's. */
export function pick(mock, playerId) {
  const cur = currentPick(mock.draft);
  if (!cur) return mock;
  const res = makePick(mock.draft, cur.owner, String(playerId), Date.now());
  if (!res.ok) return mock;
  return {
    ...mock,
    draft: res.draft,
    log: [...mock.log, { ...cur, playerId: String(playerId), auto: cur.owner !== mock.myTeam }],
  };
}

/**
 * Run bots until it is the human's turn again (or the board is full).
 *
 * ⚠️ BOUNDED BY THE BOARD. A pick that cannot be made — an exhausted ranking —
 * stops the run rather than looping, because a mock that hangs is worse than a
 * mock that ends early and says so.
 */
export function runBotsUntilMyTurn(mock) {
  let state = mock;
  let guard = state.draft.order.length + 1;

  while (guard-- > 0) {
    const cur = onTheClock(state);
    if (!cur || cur.owner === state.myTeam) break;
    const available = availableIn(state);
    if (available.length === 0) break;
    const owned = rosterOf(state, cur.owner);
    const chosen = botPick(available, {
      need: remainingNeed(state.rosterPositions, owned.map((o) => o.pos)),
      owned,
      rng: state.rng,
    });
    if (!chosen) break;
    const next = pick(state, chosen);
    if (next === state) break; // refused — stop rather than spin
    state = next;
  }
  return state;
}

/** Is the board full? */
export function isComplete(mock) {
  return onTheClock(mock) === null;
}

/** One team's finished roster, grouped for a summary. */
export function summarize(mock, teamId) {
  const roster = rosterOf(mock, teamId);
  const byPos = {};
  for (const r of roster) {
    if (!STARTABLE.has(r.pos)) continue;
    (byPos[r.pos] ??= []).push(r.id);
  }
  return { count: roster.length, byPos };
}

/**
 * Grade every team's draft.
 *
 * ⚠️ THE GRADE IS A CURVE, NOT AN ABSOLUTE. Every pick in a mock comes from the
 * same board, so the total value in the room is fixed — one team can only do
 * well by another doing badly. Grading against the field is therefore the only
 * honest framing; a fixed threshold would hand out twelve A's in a shallow
 * league and twelve C's in a deep one, and mean nothing either way.
 *
 * `valueOf(playerId)` returns the player's value over replacement. Missing
 * values count as zero rather than skipping the pick, so a team that drafted
 * unranked players is scored for having done so.
 */
export function gradeDrafts(mock, valueOf) {
  const totals = mock.teamIds.map((teamId) => ({
    teamId,
    total: rosterOf(mock, teamId).reduce((sum, r) => sum + (Number(valueOf(r.id)) || 0), 0),
  }));

  const scores = totals.map((t) => t.total);
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const span = best - worst;

  return totals
    .map((t) => {
      // A dead-flat field (everyone identical) is a B for everybody rather than
      // a divide by zero.
      const pct = span === 0 ? 0.5 : (t.total - worst) / span;
      return { ...t, pct, grade: gradeFor(pct) };
    })
    .sort((a, b) => b.total - a.total);
}

/** The curve. Deliberately generous at the top and short of an F. */
function gradeFor(pct) {
  if (pct >= 0.92) return 'A+';
  if (pct >= 0.78) return 'A';
  if (pct >= 0.62) return 'B+';
  if (pct >= 0.46) return 'B';
  if (pct >= 0.30) return 'B-';
  if (pct >= 0.15) return 'C+';
  return 'C';
}
