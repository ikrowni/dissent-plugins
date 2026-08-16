// tournament/sync.js — conflict avoidance for a shared tournament object.
//
// ⚠️ THIS IS NOT AUTHORIZATION AND MUST NOT BE MISTAKEN FOR IT.
//
// The tournament is client-authoritative: the node does not stamp sender identity on plugin
// realtime events (PluginRealtimePublish broadcasts {plugin_install_id, channel_id, event,
// data} and drops the userID it authenticated), and `storage:server` is a blanket write
// permission. Any member can publish anything. Client-side authorization is theatre when
// the client is the attacker. See docs/rl-tournament-feature-research.md.
//
// What this DOES fix is the non-malicious half of the problem, which bites first and bites
// everyone: last-write-wins with no merge. A client that was on a stale copy — reconnected
// late, tab left open, missed an event — would publish its old bracket and silently roll
// back correct results. Monotonic versioning makes a stale write a no-op instead.
//
// Under a future backend (core tables or a signed server module) this stays useful: the
// version is what lets the server reject a write built on a superseded read.

/// Stamp an outgoing tournament with the next version and who wrote it.
/// `editorId` is self-reported and only ever used for display — never for a decision.
export function stampVersion(tournament, editorId) {
  if (!tournament) return null;
  return {
    ...tournament,
    version: (Number(tournament.version) || 0) + 1,
    updatedAt: Date.now(),
    updatedBy: editorId ?? null,
  };
}

/// Decide whether an incoming tournament should replace the one held locally.
export function shouldAccept(local, incoming) {
  // A delete — explicit null — always wins. Refusing it would strand a tournament that the
  // organiser has removed, with no version to compare against.
  if (incoming === null || incoming === undefined) return true;
  if (!local) return true;

  // A different tournament entirely (new bracket created) supersedes regardless of version,
  // otherwise a fresh tournament starting at version 1 could never replace a long-running
  // one sitting at version 40.
  if (local.id && incoming.id && local.id !== incoming.id) return true;

  const lv = Number(local.version) || 0;
  const iv = Number(incoming.version) || 0;
  if (iv > lv) return true;
  if (iv < lv) return false;

  // Equal versions mean two clients edited the same base — a genuine conflict. Break it
  // deterministically so every client lands on the SAME winner rather than each keeping
  // whatever it happened to see last, which is how brackets diverge between viewers.
  const lt = Number(local.updatedAt) || 0;
  const it = Number(incoming.updatedAt) || 0;
  if (it !== lt) return it > lt;

  // Same version and same millisecond: fall back to a stable tiebreak on the writer id so
  // the outcome does not depend on arrival order.
  return String(incoming.updatedBy ?? '') > String(local.updatedBy ?? '');
}

/// True when an incoming update was rejected as stale — the caller may want to re-publish
/// its newer copy so the stale sender catches up.
export function isStaleWrite(local, incoming) {
  return Boolean(local) && Boolean(incoming) && !shouldAccept(local, incoming);
}
