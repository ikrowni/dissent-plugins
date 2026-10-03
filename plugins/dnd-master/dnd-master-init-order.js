// dnd-master-init-order.js — initiative order when players roll their own (Table rules: playersRollInitiative).
// A row with roll === null is a player who has not rolled; the tracker waits (no turns) until none are left.

const score = c => (c.roll == null ? -Infinity : c.roll);

/** Highest roll first; unrolled rows last. A new array. */
export const sortOrder = order => [...order].sort((a, b) => score(b) - score(a));

export const isWaiting = init => !!init?.order?.some(c => c.roll == null);

/** A fresh fight from its rows. */
export function startInitiative(order) {
  const sorted = sortOrder(order);
  return { active: true, round: 1, currentIndex: 0, order: sorted, waiting: sorted.some(c => c.roll == null) };
}

function settle(init, order) {
  const waiting = order.some(c => c.roll == null);
  return { ...init, order: sortOrder(order), currentIndex: 0, waiting };
}

/** The fight with this player's roll filled in; unchanged if they already rolled, are not in it, or no fight is on. */
export function withPlayerRoll(init, userId, roll) {
  if (!init?.active) return init;
  const i = init.order.findIndex(c => c.type === 'player' && c.userId === userId && c.roll == null);
  if (i < 0) return init;
  return settle(init, init.order.map((c, j) => (j === i ? { ...c, roll } : c)));
}

/** The DM rolls for everyone still missing (an absent player). `rollFor(row)` gives the number. */
export function rollMissing(init, rollFor) {
  if (!init?.active) return init;
  return settle(init, init.order.map(c => (c.roll == null ? { ...c, roll: rollFor(c) } : c)));
}
