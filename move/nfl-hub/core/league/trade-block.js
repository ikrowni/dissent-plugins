// core/league/trade-block.js — what a team is offering, and what it wants.
//
// PURE. Two halves of one conversation, deliberately in one module because they
// are meaningless apart: a block nobody can express interest in is a noticeboard,
// and interest with nothing blocked is a wishlist.
//
// ⚠️ THIS IS THE LEAGUE ENGINE'S TRADE BLOCK, NOT THE FANTASY TAB'S. The Fantasy
// tab mirrors Sleeper and **cannot mutate it** — a block there could only ever be
// published, never acted on. Here a blocked asset feeds a real proposal we own.
// `core/store.js` KEY.tradeBlock (season-scoped) belongs to that other, unbuilt
// idea; do not reuse it. See the wave 3 plan.
//
// SHAPE
//   block:    { [teamId]: { players: string[], picks: PickRef[] } }
//   interest: { [teamId]: string[] }   // player ids this team wants
//
// A PickRef is { season, round, slot } — `slot` is the team whose original pick
// it is, matching `trades.js`.

/** A stable key for a pick, so it can live in a Set and compare by value. */
export function pickKey(pick) {
  if (!pick) return '';
  return `${pick.season ?? ''}:${pick.round ?? ''}:${pick.slot ?? ''}`;
}

/**
 * Put assets on (or take them off) one team's block.
 *
 * Returns a NEW block map. `players` and `picks` REPLACE that team's entry
 * rather than merging — the UI sends the whole list, and merging would make
 * un-blocking impossible without a second verb.
 *
 * ⚠️ A team may only block what it holds. The caller supplies `owns`; passing
 * a permissive one is how a manager ends up offering somebody else's player.
 */
export function setBlock(block = {}, teamId, { players = [], picks = [] } = {}, owns = () => true) {
  const id = String(teamId ?? '');
  if (!id) return { ...block };

  const nextPlayers = [...new Set(players.map(String))].filter((p) => owns(id, p));
  const seen = new Set();
  const nextPicks = [];
  for (const p of picks) {
    const k = pickKey(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    nextPicks.push({ season: p.season, round: p.round, slot: String(p.slot) });
  }

  const next = { ...block };
  if (nextPlayers.length === 0 && nextPicks.length === 0) {
    // ⚠️ An empty entry is DELETED, not stored. Left behind, every team that
    // ever opened the screen would show as "on the block" with nothing on it.
    delete next[id];
    return next;
  }
  next[id] = { players: nextPlayers, picks: nextPicks };
  return next;
}

/** Every team currently offering something. */
export function blockedTeams(block = {}) {
  return Object.keys(block ?? {}).filter((t) => {
    const e = block[t];
    return (e?.players?.length ?? 0) > 0 || (e?.picks?.length ?? 0) > 0;
  });
}

/** Is this specific player on anyone's block? */
export function isBlocked(block = {}, playerId) {
  const id = String(playerId ?? '');
  if (!id) return false;
  return Object.values(block ?? {}).some((e) => (e?.players ?? []).map(String).includes(id));
}

/**
 * Record which players a team wants.
 *
 * ⚠️ A TEAM CANNOT WANT ITS OWN PLAYER. Sleeper surfaces interest as a count on
 * the owner's roster card; self-interest would inflate that count with the one
 * team the owner already knows about.
 */
export function setInterest(interest = {}, teamId, playerIds = [], ownerOf = () => null) {
  const id = String(teamId ?? '');
  if (!id) return { ...interest };

  const wanted = [...new Set(playerIds.map(String))]
    .filter((p) => String(ownerOf(p) ?? '') !== id);

  const next = { ...interest };
  if (wanted.length === 0) delete next[id];
  else next[id] = wanted;
  return next;
}

/**
 * How many teams want each player.
 *
 * This is the heart-with-a-number from study §8.3 — the single most useful thing
 * on the trade screen, because it turns "would anyone take him?" into a number.
 */
export function interestCounts(interest = {}) {
  const counts = {};
  for (const wanted of Object.values(interest ?? {})) {
    for (const p of new Set((wanted ?? []).map(String))) {
      counts[p] = (counts[p] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Which teams want this player, sorted for a stable list.
 *
 * Sleeper makes the count tappable; a count you cannot expand tells a manager
 * there is a deal available without saying who with.
 */
export function teamsInterestedIn(interest = {}, playerId) {
  const id = String(playerId ?? '');
  if (!id) return [];
  return Object.entries(interest ?? {})
    .filter(([, wanted]) => (wanted ?? []).map(String).includes(id))
    .map(([teamId]) => String(teamId))
    .sort();
}

/**
 * The other teams worth talking to about a trade, best first.
 *
 * A partner is interesting when they want something of yours, or hold something
 * you want — ranked by how much overlap there is, because that is the ordering
 * a manager would do by hand.
 */
export function tradeMatches({
  block = {}, interest = {}, teamId, ownerOf = () => null,
} = {}) {
  const me = String(teamId ?? '');
  if (!me) return [];

  const iWant = new Set((interest[me] ?? []).map(String));
  const matches = {};

  // They want one of mine.
  for (const [other, wanted] of Object.entries(interest ?? {})) {
    if (String(other) === me) continue;
    for (const p of wanted ?? []) {
      if (String(ownerOf(p) ?? '') !== me) continue;
      matches[other] ??= { teamId: String(other), theyWant: [], iWant: [] };
      matches[other].theyWant.push(String(p));
    }
  }

  // I want one of theirs, and they have it on the block.
  for (const [other, entry] of Object.entries(block ?? {})) {
    if (String(other) === me) continue;
    for (const p of entry?.players ?? []) {
      if (!iWant.has(String(p))) continue;
      matches[other] ??= { teamId: String(other), theyWant: [], iWant: [] };
      matches[other].iWant.push(String(p));
    }
  }

  return Object.values(matches).sort(
    (a, b) => (b.theyWant.length + b.iWant.length) - (a.theyWant.length + a.iWant.length)
      || a.teamId.localeCompare(b.teamId),
  );
}
