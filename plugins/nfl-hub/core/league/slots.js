// core/league/slots.js — which players may occupy which roster slot.
//
// PURE. Imported by both halves of the plugin, so the client's "can I drop him
// here?" and the server's "is this lineup legal?" are the same function.

/**
 * Slot → the set of positions eligible for it.
 *
 * ⚠️ SLOT NAMES COME FROM SLEEPER AND ARE NOT GUESSES. The recorded league uses
 * `SUPER_FLEX`, which is the slot most likely to break naive handling: it accepts
 * a QB, so code that treats every FLEX alike will happily reject a legal lineup
 * or accept an illegal one.
 *
 * Order within a set does not matter; membership is the whole contract.
 */
const ELIGIBILITY = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],

  // Flex family. Each is a distinct set — they are not interchangeable.
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],

  // Individual defensive players. Present so an IDP league is expressible; no
  // league is required to use them.
  DL: ['DL', 'DE', 'DT'],
  LB: ['LB'],
  DB: ['DB', 'CB', 'S'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'],
};

/** Slots that hold players but never score. */
export const NON_SCORING_SLOTS = Object.freeze(['BN', 'IR', 'TAXI']);

/** Every slot name this engine understands. */
export const KNOWN_SLOTS = Object.freeze([...Object.keys(ELIGIBILITY), ...NON_SCORING_SLOTS]);

/**
 * May a player of `position` occupy `slot`?
 *
 * Bench, IR and taxi accept anyone — they are storage, not lineup positions.
 * Eligibility to *hold* a player there is separate from eligibility to *place*
 * one there: see `irEligible` for the injury-designation rules, which are a
 * league setting rather than a property of the slot.
 */
export function slotAccepts(slot, position) {
  if (!slot || !position) return false;
  if (NON_SCORING_SLOTS.includes(slot)) return true;
  const allowed = ELIGIBILITY[slot];
  // ⚠️ An UNKNOWN slot accepts nobody. Defaulting to "allow" would let a typo in
  // a league's roster_positions silently create a slot that takes any player.
  if (!allowed) return false;
  return allowed.includes(position);
}

/** The positions a slot accepts, or [] for an unknown slot. */
export function eligiblePositions(slot) {
  if (NON_SCORING_SLOTS.includes(slot)) return [];
  return ELIGIBILITY[slot] ? [...ELIGIBILITY[slot]] : [];
}

/**
 * Split a league's `roster_positions` into the slots that score and the ones
 * that do not.
 *
 * ⚠️ THE STARTING SLOTS ARE POSITIONAL AND MUST KEEP THEIR ORDER AND THEIR
 * DUPLICATES. A lineup is an array indexed against this list, so de-duplicating
 * ['RB','RB'] to ['RB'] would silently drop a starter and mislabel every slot
 * after it.
 */
export function splitRosterPositions(rosterPositions) {
  const all = Array.isArray(rosterPositions) ? rosterPositions : [];
  return {
    starters: all.filter((p) => !NON_SCORING_SLOTS.includes(p)),
    bench: all.filter((p) => p === 'BN').length,
    ir: all.filter((p) => p === 'IR').length,
    taxi: all.filter((p) => p === 'TAXI').length,
  };
}

/**
 * Is this lineup legal for these starting slots?
 *
 * `lineup` is positional: index i is the player id in starting slot i, with null
 * or '0' for an empty slot. `positionOf` resolves a player id to its position.
 *
 * Returns { valid, errors } rather than throwing — a half-filled lineup is a
 * normal intermediate state in a UI, not an exceptional one.
 */
export function validateLineup(lineup, starterSlots, positionOf, { allowEmpty = true } = {}) {
  const errors = [];
  const slots = Array.isArray(starterSlots) ? starterSlots : [];
  const row = Array.isArray(lineup) ? lineup : [];

  if (row.length > slots.length) {
    errors.push(`lineup has ${row.length} entries for ${slots.length} starting slots`);
  }

  const seen = new Map();
  slots.forEach((slot, i) => {
    const id = row[i];
    // Sleeper writes "0" for an unfilled slot, not null. Both mean empty.
    if (!id || id === '0') {
      if (!allowEmpty) errors.push(`slot ${i + 1} (${slot}) is empty`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`player ${id} is in slot ${seen.get(id) + 1} and slot ${i + 1}`);
      return;
    }
    seen.set(id, i);

    const position = positionOf?.(id) ?? null;
    if (!position) {
      errors.push(`player ${id} has no known position`);
      return;
    }
    if (!slotAccepts(slot, position)) {
      errors.push(`${position} is not eligible for slot ${i + 1} (${slot})`);
    }
  });

  return { valid: errors.length === 0, errors };
}
