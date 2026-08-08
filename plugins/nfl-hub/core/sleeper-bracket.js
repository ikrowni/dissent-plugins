// core/sleeper-bracket.js — the playoff bracket.
//
// Sleeper's bracket payload is terse single-letter keys. Measured 2026-08-08 against the
// live winners_bracket and losers_bracket of a completed 12-team league:
//
//   m  match id                  r   round number
//   t1 / t2  roster ids          w / l  winner / loser roster id
//   p  placement decided by this match (1 = championship, 3 = third, 5 = fifth)
//   t1_from / t2_from  { w: matchId } or { l: matchId } — an UNPLAYED side's source
//
// A side is either a roster id or a forward reference; both are normalised here so views
// never branch on the raw shape.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** { w: 3 } -> { kind:'winner', matchId:3 }; { l: 3 } -> { kind:'loser', matchId:3 }. */
function fromRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.w !== undefined) return { kind: 'winner', matchId: Number(ref.w) };
  if (ref.l !== undefined) return { kind: 'loser', matchId: Number(ref.l) };
  return null;
}

export function parseBracket(json) {
  if (!Array.isArray(json)) return [];
  return json.map((m) => ({
    matchId: num(m?.m),
    round: num(m?.r),
    team1: num(m?.t1),
    team2: num(m?.t2),
    winner: num(m?.w),
    loser: num(m?.l),
    placement: num(m?.p),
    team1From: fromRef(m?.t1_from),
    team2From: fromRef(m?.t2_from),
  }));
}

export function bracketRounds(matches) {
  const byRound = new Map();
  for (const m of matches ?? []) {
    const r = m.round ?? 0;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }
  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, list]) => ({
      round,
      matches: list.sort((a, b) => (a.matchId ?? 0) - (b.matchId ?? 0)),
    }));
}

/**
 * What to print on one side of a match.
 *
 * An unplayed side has no roster id, only a reference to the match that will produce it.
 * Printing "TBD" for those loses the bracket's whole structure, so the reference is
 * spelled out instead.
 */
export function sideLabel(rosterId, from, names) {
  if (rosterId != null) return names?.[rosterId] ?? `Roster ${rosterId}`;
  if (from) return `${from.kind === 'winner' ? 'Winner' : 'Loser'} of M${from.matchId}`;
  return 'TBD';
}
