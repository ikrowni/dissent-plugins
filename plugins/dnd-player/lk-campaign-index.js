// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-campaign-index.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-campaign-index.js' directly would make the plugin unmirrorable.

// lk-campaign-index.js — what hub-index says about each campaign, so a screen reads only the campaigns it is in.
//
// ⚠️ VENDORED: edit this file at the plugins root, then run `node scripts/vendor-shared.mjs`. dnd-hub, dnd-master
// and dnd-player each import a copy; all three read and write the same hub-index.
//
// WHY: every Hub, DM sidebar and player sheet load read EVERY campaign on the server (hub-index, then one
// hub-camp-<id> each), all off one 120 reads/min budget per user. Ten campaigns sent bob_qa into ~80 HTTP 429s
// and crashed a playtest (2026-10-04). The index now carries a short summary of each campaign, and a load reads
// only the campaigns this user runs or plays in. The Join screen lists the others from their summaries.
//
// 🔴 The rule that keeps this safe: a MISSING summary means "read it". So an index written by an older screen
// (no summaries), a failed read, or a campaign nobody has saved since the change all fall back to the old
// behaviour. Only a PRESENT summary that leaves this user out lets a load skip a campaign, so a summary is only
// ever written from a campaign the save just merged with what is stored (summariesForIndex), never from a copy
// that may be older than someone else's change (Bob joins; a stale screen must not write him back out).

const DESC_MAX = 280;

/** The public facts the Join screen shows, and who is in the campaign. Never anything DM-only. */
export function campaignSummary(c) {
  return {
    id: c.id,
    name: c.name ?? '',
    dmUserId: c.dmUserId ?? null,
    dmDisplayName: c.dmDisplayName ?? null,
    members: Array.isArray(c.members) ? [...c.members] : [],
    visibility: c.visibility ?? null,
    maxPlayers: c.maxPlayers ?? null,
    description: String(c.description ?? '').slice(0, DESC_MAX),
    startingLevel: c.startingLevel ?? null,
    autoAccept: !!c.autoAccept,
    status: c.status ?? null,
  };
}

/** Whether this screen must read campaign `id` in full. No summary, or no known user, means yes. */
export function needsCampaign(summaries, id, userId) {
  const s = summaries?.[id];
  if (!s || !userId) return true;
  return s.dmUserId === userId || (Array.isArray(s.members) && s.members.includes(userId));
}

/**
 * The summaries a save writes. `written` = campaigns this save merged and wrote (their summary is current);
 * every other id keeps what the FRESH index says. `fresh` null (the read failed) leaves those out: missing
 * means "read it", which is safe, where a summary from our older copy might not be.
 */
export function summariesForIndex(ids, written, fresh) {
  const out = {};
  for (const id of ids) {
    if (written[id]) out[id] = campaignSummary(written[id]);
    else if (fresh?.[id]) out[id] = fresh[id];
  }
  return out;
}

/**
 * The campaign ids a save writes: ours, plus any the fresh index has that this screen did not remove (a
 * campaign created on another screen since we loaded must not be dropped by our save).
 */
export function idsForIndex(ours, freshIds, removed) {
  const out = [...ours];
  for (const id of freshIds || []) if (!out.includes(id) && !removed.includes(id)) out.push(id);
  return out;
}

/** True when the written campaigns' summaries differ from what the index last said (so it must be rewritten). */
export function summariesChanged(written, known) {
  return Object.entries(written).some(([id, c]) => JSON.stringify(campaignSummary(c)) !== JSON.stringify(known?.[id]));
}
