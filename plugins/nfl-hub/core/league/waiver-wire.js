// core/league/waiver-wire.js — where a dropped player goes, and for how long.
//
// PURE. No IO, no clock of its own — `now` is always passed in.
//
// ⚠️ THIS IS THE RULE THE 24-HOUR RULE IS AN EXCEPTION TO. Until this existed a
// drop returned the player straight to free agency, always, and
// `settings.waiverClearDays` was a DEAD SETTING — declared, mapped from Sleeper,
// consumed nowhere. Sleeper's 24-Hour Rule says a player added via free agency
// and dropped again within a day goes "straight back to free agency INSTEAD of
// waivers", which describes nothing unless waivers are the default destination.
//
// SHAPES
//   wire:     { [playerId]: { clearsAt, droppedBy, droppedAt } }
//   acquired: { [playerId]: { at, via } }   // `via` is 'free_agency' | 'draft' | 'trade' | 'waivers'

/** Where a dropped player lands. */
export const DROP_DESTINATION = Object.freeze({
  WAIVERS: 'waivers',
  FREE_AGENCY: 'free_agency',
});

/**
 * Sleeper's 24-Hour Rule window.
 *
 * ⚠️ A CONSTANT, NOT A SETTING. Sleeper does not expose it and neither do we —
 * it exists to stop a manager parking players on waivers all Sunday morning to
 * deny the rest of the league, and a league that could tune it to zero would
 * simply have the abuse back.
 */
export const FA_HOLD_MS = 24 * 60 * 60 * 1000;

/** Does this league run a waiver wire at all? */
export function waiversEnabled(settings) {
  const days = Number(settings?.waiverClearDays);
  return Number.isFinite(days) && days > 0;
}

/**
 * Where does this player go when dropped?
 *
 * ⚠️ THE 24-HOUR RULE IS ABOUT HOW HE WAS ACQUIRED, not merely how long ago.
 * A drafted or traded player dropped within a day still goes to waivers; only a
 * FREE-AGENT pickup skips them. Reading it as "recently acquired" would let a
 * team drop a just-traded star straight to the wire-free pool.
 */
export function dropDestination({ acquired = {}, playerId, now = 0, settings } = {}) {
  if (!waiversEnabled(settings)) return DROP_DESTINATION.FREE_AGENCY;

  const rec = acquired?.[String(playerId)];
  if (rec && rec.via === 'free_agency' && Number.isFinite(Number(rec.at))
    && now - Number(rec.at) < FA_HOLD_MS) {
    return DROP_DESTINATION.FREE_AGENCY;
  }
  return DROP_DESTINATION.WAIVERS;
}

/** When a player dropped now would clear waivers. */
export function wireClearsAt(now = 0, settings) {
  const days = Number(settings?.waiverClearDays) || 0;
  return now + days * 24 * 60 * 60 * 1000;
}

/**
 * Put a player on the wire.
 *
 * ⚠️ RE-DROPPING RESETS THE CLOCK. A player claimed and dropped again is newly
 * on waivers; carrying the old `clearsAt` would let him clear early through no
 * decision of the league's.
 */
export function placeOnWire(wire = {}, playerId, { clearsAt, droppedBy = null, droppedAt = 0 } = {}) {
  const id = String(playerId ?? '');
  if (!id) return { ...wire };
  return { ...wire, [id]: { clearsAt, droppedBy: droppedBy ? String(droppedBy) : null, droppedAt } };
}

/** Take a player off the wire — claimed, or cleared. */
export function removeFromWire(wire = {}, playerId) {
  const next = { ...wire };
  delete next[String(playerId ?? '')];
  return next;
}

/**
 * Is this player sitting on waivers right now?
 *
 * ⚠️ AN EXPIRED ENTRY IS NOT ON WAIVERS even if nobody has swept it yet. The
 * sweep is a scheduled tick and may be minutes late; answering from the clock
 * rather than from whether cleanup has run keeps a free agent addable the moment
 * he actually becomes one.
 */
export function onWaivers(wire = {}, playerId, now = 0) {
  const rec = wire?.[String(playerId ?? '')];
  return Boolean(rec) && Number(rec.clearsAt) > now;
}

/**
 * Everyone currently on the wire, soonest to clear first.
 *
 * That order is the one a manager reads: what am I about to lose the chance at?
 */
export function wirePlayers(wire = {}, now = 0) {
  return Object.entries(wire ?? {})
    .filter(([, rec]) => Number(rec?.clearsAt) > now)
    .map(([playerId, rec]) => ({ playerId, ...rec }))
    .sort((a, b) => a.clearsAt - b.clearsAt || a.playerId.localeCompare(b.playerId));
}

/**
 * Sweep everyone whose time is up.
 *
 * Returns the pruned wire and the ids that cleared, so the caller can announce
 * them — a player silently becoming available is a player nobody picks up.
 */
export function clearExpired(wire = {}, now = 0) {
  const next = {};
  const cleared = [];
  for (const [playerId, rec] of Object.entries(wire ?? {})) {
    if (Number(rec?.clearsAt) > now) next[playerId] = rec;
    else cleared.push(playerId);
  }
  return { wire: next, cleared: cleared.sort() };
}

/**
 * Record how a player came to a roster.
 *
 * Only `free_agency` acquisitions can ever trigger the 24-Hour Rule, but the
 * others are recorded too so the reason a drop behaved as it did is auditable.
 */
export function recordAcquisition(acquired = {}, playerId, { at = 0, via = 'free_agency' } = {}) {
  const id = String(playerId ?? '');
  if (!id) return { ...acquired };
  return { ...acquired, [id]: { at, via } };
}

/** Forget an acquisition — the player has left the roster. */
export function forgetAcquisition(acquired = {}, playerId) {
  const next = { ...acquired };
  delete next[String(playerId ?? '')];
  return next;
}
