// tournament/replay.js — derive tournament state from the attested log.
//
// The log is the truth. Every entry carries an `author_id` the NODE stamped from the
// authenticated session, which a client cannot set or forge. Replaying the log therefore
// answers a question no other plugin storage can: *did the person who claims to have
// recorded this result actually record it?*
//
// THE ORGANISER IS WHOEVER CREATED THE BRACKET. There is no bootstrapping problem and no
// separate ownership record to keep honest: the `create` entry's attested author is the
// organiser, by definition. Every later entry is measured against that.
//
// Rejected entries are RETURNED, not silently dropped. Someone appending a result they are
// not allowed to record is a thing the organiser should be able to see, and a rejection that
// leaves no trace is indistinguishable from the entry never having existed.
//
// Pure: no DOM, no network, no module state.

import { buildBracket, propagateWinners, validateScore } from './bracket.js';

export const KIND = { CREATE: 'create', RESULT: 'result', DELETE: 'delete' };

function authorised(entry, state) {
  // A null author is an erased user (ON DELETE SET NULL). Unattributed cannot be
  // authorised — we no longer know who it was.
  if (!entry.author_id) return false;
  return entry.author_id === state.organiserId;
}

function applyCreate(entry) {
  const d = entry.data ?? {};
  if (!Array.isArray(d.participants) || d.participants.length < 2) return null;
  return {
    id: d.id,
    name: d.name ?? 'Tournament',
    gameMode: d.gameMode ?? '3v3',
    bestOf: Number(d.bestOf) || 3,
    participants: d.participants,
    rounds: buildBracket(d.participants),
    // Attested, not self-reported. This is the whole point of the primitive.
    organiserId: entry.author_id ?? null,
    createdAt: entry.created_at ?? null,
    lastEntryId: entry.id,
  };
}

function applyResult(entry, state, rejected) {
  const d = entry.data ?? {};
  if (!state || d.tournamentId !== state.id) {
    rejected.push({ entry, reason: 'refers to a tournament that is not current' });
    return state;
  }
  if (!authorised(entry, state)) {
    rejected.push({ entry, reason: 'not recorded by the organiser' });
    return state;
  }
  const round = state.rounds[d.roundIdx];
  const match = round?.matches?.[d.matchIdx];
  if (!match) {
    rejected.push({ entry, reason: 'no such match' });
    return state;
  }
  const v = validateScore(d.s1, d.s2, state.bestOf);
  if (!v.ok) {
    rejected.push({ entry, reason: v.error });
    return state;
  }
  if (!match.player1 || !match.player2) {
    rejected.push({ entry, reason: 'match has no opponents yet' });
    return state;
  }

  match.score1 = d.s1;
  match.score2 = d.s2;
  match.winnerId = d.s1 > d.s2 ? match.player1.dissentUserId : match.player2.dissentUserId;
  propagateWinners(state.rounds, state.participants);
  state.lastEntryId = entry.id;
  return state;
}

/// Replays every entry in id order and returns the derived state.
/// `{ tournament, rejected }` — tournament is null when none exists or it was deleted.
export function replay(entries) {
  const ordered = [...(entries ?? [])].sort((a, b) => a.id - b.id);
  const rejected = [];
  let state = null;

  for (const entry of ordered) {
    const kind = entry?.data?.kind;

    if (kind === KIND.CREATE) {
      // A new bracket always supersedes: whoever creates one becomes its organiser, and a
      // previous tournament's organiser has no say over a later, separate event.
      const next = applyCreate(entry);
      if (next) state = next;
      else rejected.push({ entry, reason: 'create entry is malformed' });
      continue;
    }

    if (kind === KIND.RESULT) {
      state = applyResult(entry, state, rejected);
      continue;
    }

    if (kind === KIND.DELETE) {
      if (!state || entry.data?.tournamentId !== state.id) {
        rejected.push({ entry, reason: 'refers to a tournament that is not current' });
      } else if (!authorised(entry, state)) {
        rejected.push({ entry, reason: 'not deleted by the organiser' });
      } else {
        state = null;
      }
      continue;
    }

    rejected.push({ entry, reason: `unknown entry kind: ${String(kind)}` });
  }

  return { tournament: state, rejected };
}

/// True when this viewer may record results — i.e. the log says they created the bracket.
export function canManage(tournament, viewerId) {
  return Boolean(tournament && viewerId && tournament.organiserId === viewerId);
}
