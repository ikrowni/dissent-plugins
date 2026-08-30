// server/ops-draft.js — the draft, and its deadline-on-read clock.
//
// ⚠️ EVERY READ OF THE BOARD RESOLVES LAPSED PICKS FIRST. That is the whole
// clock mechanism: the node's scheduler floor is five minutes and cannot drive a
// 90-second timer, so a lapsed pick is auto-drafted by whoever next looks, with
// the scheduled tick as a backstop for when nobody is looking. A lapse is
// therefore RECORDED late but TIMED correctly.
//
// ⚠️ RESOLUTION HAPPENS INSIDE THE SWAP. Resolving before the swap would let two
// simultaneous board loads both auto-draft the same lapsed pick to different
// players, and the loser's write would silently vanish.

import { KEY, read, mutate, loadLeague } from "./store.js";
import { requireCommissioner, requireTeamControl, isCommissioner } from "./auth.js";
import {
  createDraft, startDraft, makePick, resolveExpired, currentPick,
  pauseDraft, resumeDraft, bestAvailable, draftedRosters, DRAFT_STATUS,
} from "../core/league/draft.js";
import { DRAFT_TYPE } from "../core/league/draft-order.js";

const refuse = (msg) => { throw new Error(msg); };

/**
 * Autodraft: a team's own queue first, then the league's ranking.
 *
 * ⚠️ Must be free of side effects — `resolveExpired` calls it repeatedly while
 * cascading through several lapsed picks, and `swap` may replay the whole thing
 * on a conflict.
 */
function autoPicker(queues, ranking) {
  return (draft, pick) => {
    const queue = queues?.[pick.owner] ?? [];
    const fromQueue = bestAvailable(draft, queue);
    return fromQueue ?? bestAvailable(draft, ranking);
  };
}

/**
 * Commissioner: set the draft up, or rebuild it after a settings change.
 *
 * ⚠️ A DRAFT IS A SNAPSHOT OF THE SETTINGS AT THE MOMENT IT WAS BUILT. `rounds`,
 * `type` and the pick clock are baked into `order` by `createDraft`, so editing
 * the league afterwards changes nothing about a draft that already exists — the
 * board goes on saying "15 rounds" while the settings say 16, with no control
 * anywhere to reconcile them. That was reported as a stuck Start button, and it
 * is why this op is re-runnable: rebuilding is how a settings change reaches a
 * draft that has not started.
 *
 * ⚠️ AND ONLY WHILE IT HAS NOT STARTED. This used to overwrite unconditionally,
 * which meant one stray call discarded every pick of a live draft with nothing
 * to restore it from — the picks ARE the ownership record until the draft is
 * finalised.
 */
export function createLeagueDraft({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  const order = Array.isArray(payload?.draftOrder) && payload.draftOrder.length
    ? payload.draftOrder.map(String)
    : Object.keys(teams);
  if (order.length === 0) refuse("the league has no teams to draft");

  // ⚠️ ACCEPT ANY KNOWN TYPE, don't enumerate one. This previously read
  // `=== LINEAR ? LINEAR : SNAKE`, which silently coerced every other value to
  // snake — so adding 3rd Round Reversal to the engine would have shipped a
  // setting that quietly did nothing, the worst kind of feature. An unknown
  // value still falls back to snake, but a known one is honoured.
  const known = new Set(Object.values(DRAFT_TYPE));
  const type = known.has(payload?.type) ? payload.type : DRAFT_TYPE.SNAKE;
  const rounds = Number(payload?.rounds ?? meta.settings?.draftRounds ?? 15);
  const pickTimerSeconds = Number(payload?.pickTimerSeconds ?? meta.settings?.pickTimerSeconds ?? 90);

  const existing = read(KEY.draft(lg), null);
  if (existing && existing.status !== DRAFT_STATUS.PRE) {
    refuse(`this draft is ${existing.status} and cannot be rebuilt — rebuilding would discard every pick made`);
  }

  const assets = read(KEY.assets(lg), { pickOwnership: [] });
  const draft = createDraft({
    draftOrder: order,
    rounds,
    type,
    tradedPicks: assets.pickOwnership ?? [],
    pickTimerSeconds,
    season: meta.season,
  });

  // ⚠️ Re-checked INSIDE the swap. The status read above can be stale by the
  // time this lands — the commissioner starting the draft in another tab is the
  // obvious race, and losing that race must not wipe the draft it started.
  mutate(KEY.draft(lg), (d) => {
    if (d && d.status !== DRAFT_STATUS.PRE) {
      refuse(`this draft is ${d.status} and cannot be rebuilt — rebuilding would discard every pick made`);
    }
    return draft;
  }, null);
  return {
    status: draft.status, picks: draft.order.length, rounds, type,
    rebuilt: Boolean(existing),
  };
}

/** Commissioner: start the clock. */
export function startLeagueDraft({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  let out = null;
  mutate(KEY.draft(lg), (d) => {
    if (!d) refuse("no draft has been created");
    const res = startDraft(d, Date.now());
    if (!res.ok) refuse(res.error);
    out = { status: res.draft.status, pickEndsAt: res.draft.pickEndsAt };
    return res.draft;
  }, null);
  return out;
}

/**
 * The board — and the clock tick.
 *
 * Reading is a mutation here, which looks odd and is deliberate: this is the
 * mechanism that makes a 90-second timer work under a five-minute scheduler.
 */
export function getDraft({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);

  const queues = read(KEY.meta(lg), {})?.draftQueues ?? {};
  const ranking = payload?.ranking ?? [];
  let view = null;

  mutate(KEY.draft(lg), (d) => {
    if (!d) refuse("no draft has been created");
    const res = resolveExpired(d, Date.now(), autoPicker(queues, ranking));
    view = draftView(res.draft, meta, p);
    view.autoPicked = res.made.map((m) => ({ overall: m.overall, teamId: m.owner, playerId: m.playerId }));
    return res.draft;
  }, null);

  return view;
}

/**
 * Make a pick.
 *
 * ⚠️ Lapsed picks are resolved BEFORE this pick is applied, in the same swap. A
 * manager who arrives after their clock expired must not be able to pick as
 * though it had not — the auto-pick already happened, they simply had not seen
 * it yet.
 */
export function makeDraftPick({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const playerId = payload?.playerId;
  if (playerId === null || playerId === undefined || playerId === "") refuse("playerId required");

  const queues = meta.draftQueues ?? {};
  const ranking = payload?.ranking ?? [];
  let out = null;

  mutate(KEY.draft(lg), (d) => {
    if (!d) refuse("no draft has been created");
    const now = Date.now();
    const resolved = resolveExpired(d, now, autoPicker(queues, ranking));
    const res = makePick(resolved.draft, teamId, playerId, now);
    if (!res.ok) refuse(res.error);
    out = {
      overall: currentPick(resolved.draft)?.overall ?? null,
      playerId: String(playerId),
      autoPicked: resolved.made.length,
      status: res.draft.status,
      pickEndsAt: res.draft.pickEndsAt,
    };
    return res.draft;
  }, null);

  return out;
}

/** A manager's autodraft queue, stored on the league meta. */
export function setDraftQueue({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const queue = (payload?.queue ?? []).map(String);
  mutate(KEY.meta(lg), (m) => ({
    ...m,
    draftQueues: { ...(m.draftQueues ?? {}), [teamId]: queue },
  }), meta);
  return { teamId, queued: queue.length };
}

/** Commissioner: pause or resume. */
export function setDraftPaused({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  const paused = Boolean(payload?.paused);
  let out = null;
  mutate(KEY.draft(lg), (d) => {
    if (!d) refuse("no draft has been created");
    // ⚠️ `now` on BOTH sides. Pausing banks the time left and resuming pays it
    // back, so a pause with no clock reading banks nothing and hands the team a
    // fresh ninety seconds — which is what pausing used to do every time, and
    // made the pause button a way to buy time.
    const now = Date.now();
    const res = paused ? pauseDraft(d, now) : resumeDraft(d, now);
    if (!res.ok) refuse(res.error);
    out = { status: res.draft.status, pickEndsAt: res.draft.pickEndsAt };
    return res.draft;
  }, null);
  return out;
}

/**
 * Materialise the draft into rosters once it completes.
 *
 * ⚠️ TWO KEYS, SO IT CANNOT BE ATOMIC — and it does not need to be, because it
 * is idempotent and only runs on a COMPLETE draft, whose picks can no longer
 * change. Running it twice produces the same rosters.
 */
export function finalizeDraft({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  const draft = read(KEY.draft(lg), null);
  if (!draft) refuse("no draft has been created");
  if (draft.status !== DRAFT_STATUS.COMPLETE) refuse(`draft is ${draft.status}, not complete`);

  const drafted = draftedRosters(draft, Object.keys(teams));
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    const rosters = { ...assets.rosters };
    for (const [teamId, roster] of Object.entries(drafted)) {
      const existing = rosters[teamId] ?? { players: [], ir: [], taxi: [] };
      // Union rather than overwrite: a keeper league already has players here.
      const players = [...new Set([...existing.players, ...roster.players])];
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
    msRemaining: draft.pickEndsAt
      ? Math.max(0, draft.pickEndsAt - Date.now())
      : (draft.status === DRAFT_STATUS.PAUSED ? draft.pausedRemainingMs ?? null : null),
    onClock: onClock ? { overall: onClock.overall, round: onClock.round, teamId: onClock.owner } : null,
    picks: draft.picks,
    order: draft.order,
    isCommissioner: isCommissioner(meta, p.userId),
  };
}

function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  return lg;
}
