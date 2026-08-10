import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  slotAccepts, eligiblePositions, splitRosterPositions, validateLineup,
  NON_SCORING_SLOTS, KNOWN_SLOTS, irEligible, IR_ELIGIBLE_STATUSES,
} from './slots.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const league = fx('sleeper-league.json');

describe('slotAccepts', () => {
  it('matches a dedicated slot to its own position', () => {
    expect(slotAccepts('QB', 'QB')).toBe(true);
    expect(slotAccepts('QB', 'RB')).toBe(false);
  });

  it('distinguishes the flex family — they are not interchangeable', () => {
    expect(slotAccepts('FLEX', 'RB')).toBe(true);
    expect(slotAccepts('FLEX', 'QB')).toBe(false);
    expect(slotAccepts('REC_FLEX', 'RB')).toBe(false);
    expect(slotAccepts('REC_FLEX', 'TE')).toBe(true);
    expect(slotAccepts('WRRB_FLEX', 'TE')).toBe(false);
  });

  // ⚠️ The slot most likely to break naive handling, and the recorded league uses it.
  it('accepts a QB in SUPER_FLEX but not in FLEX', () => {
    expect(slotAccepts('SUPER_FLEX', 'QB')).toBe(true);
    expect(slotAccepts('FLEX', 'QB')).toBe(false);
  });

  it('lets bench, IR and taxi hold anyone', () => {
    for (const slot of NON_SCORING_SLOTS) {
      expect(slotAccepts(slot, 'QB')).toBe(true);
      expect(slotAccepts(slot, 'DEF')).toBe(true);
    }
  });

  // ⚠️ An unknown slot must accept NOBODY. Defaulting to allow would let a typo
  // in roster_positions silently create a slot that takes any player.
  it('refuses an unknown slot rather than defaulting to permissive', () => {
    expect(slotAccepts('SUPERFLEX', 'QB')).toBe(false);
    expect(slotAccepts('', 'QB')).toBe(false);
    expect(slotAccepts('FLEX', null)).toBe(false);
  });

  it('every known slot is either scoring with eligibility, or non-scoring', () => {
    for (const slot of KNOWN_SLOTS) {
      const eligible = eligiblePositions(slot);
      if (NON_SCORING_SLOTS.includes(slot)) expect(eligible).toEqual([]);
      else expect(eligible.length).toBeGreaterThan(0);
    }
  });
});

describe('splitRosterPositions', () => {
  it('reads the recorded league’s real roster shape', () => {
    const split = splitRosterPositions(league.roster_positions);
    // 12 starting slots and 15 bench, per the recorded league.
    expect(split.starters).toEqual(
      ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX'],
    );
    expect(split.bench).toBe(15);
  });

  // ⚠️ THE DUPLICATES AND THE ORDER ARE THE POINT. A lineup is an array indexed
  // against this list, so collapsing ['RB','RB'] to ['RB'] drops a starter and
  // mislabels every slot after it.
  it('keeps duplicate slots and their order', () => {
    const split = splitRosterPositions(['QB', 'RB', 'RB', 'BN', 'WR']);
    expect(split.starters).toEqual(['QB', 'RB', 'RB', 'WR']);
  });

  it('counts IR and taxi separately from bench', () => {
    const split = splitRosterPositions(['QB', 'BN', 'BN', 'IR', 'TAXI', 'TAXI', 'TAXI']);
    expect(split).toEqual({ starters: ['QB'], bench: 2, ir: 1, taxi: 3 });
  });

  it('survives a missing or malformed roster_positions', () => {
    expect(splitRosterPositions(null).starters).toEqual([]);
    expect(splitRosterPositions('QB').starters).toEqual([]);
  });
});

describe('validateLineup', () => {
  const slots = ['QB', 'RB', 'RB', 'FLEX', 'SUPER_FLEX'];
  const positions = { p1: 'QB', p2: 'RB', p3: 'RB', p4: 'WR', p5: 'QB', p6: 'TE' };
  const positionOf = (id) => positions[id] ?? null;

  it('accepts a legal lineup', () => {
    const r = validateLineup(['p1', 'p2', 'p3', 'p4', 'p5'], slots, positionOf);
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it('rejects a player in a slot that does not accept the position', () => {
    // A QB in FLEX is the classic illegal placement.
    const r = validateLineup(['p1', 'p2', 'p3', 'p5', 'p6'], slots, positionOf);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('QB is not eligible for slot 4 (FLEX)');
  });

  it('rejects the same player started twice', () => {
    const r = validateLineup(['p1', 'p2', 'p2', 'p4', 'p5'], slots, positionOf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('is in slot 2 and slot 3'))).toBe(true);
  });

  it('treats both null and "0" as an empty slot', () => {
    expect(validateLineup(['p1', 'p2', null, 'p4', 'p5'], slots, positionOf).valid).toBe(true);
    expect(validateLineup(['p1', 'p2', '0', 'p4', 'p5'], slots, positionOf).valid).toBe(true);
  });

  it('can require a full lineup when the league locks', () => {
    const r = validateLineup(['p1', 'p2', null, 'p4', 'p5'], slots, positionOf, { allowEmpty: false });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('slot 3 (RB) is empty');
  });

  it('rejects a player whose position is unknown', () => {
    const r = validateLineup(['ghost', 'p2', 'p3', 'p4', 'p5'], slots, positionOf);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('no known position');
  });

  it('rejects more entries than there are slots', () => {
    const r = validateLineup(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], slots, positionOf);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('6 entries for 5 starting slots');
  });

  it('validates against the recorded league’s real starting slots', () => {
    const { starters } = splitRosterPositions(league.roster_positions);
    // A QB in the final SUPER_FLEX is legal; the same QB one slot earlier is not.
    const legal = Array(starters.length).fill(null);
    legal[11] = 'p5';
    expect(validateLineup(legal, starters, positionOf).valid).toBe(true);

    const illegal = Array(starters.length).fill(null);
    illegal[10] = 'p5'; // FLEX
    expect(validateLineup(illegal, starters, positionOf).valid).toBe(false);
  });
});

describe('irEligible', () => {
  // ⚠️ IR accepts any POSITION — it is storage — but not any PLAYER. These are
  // two different questions and `slotAccepts` deliberately answers only the
  // first.
  it('is separate from slotAccepts, which takes anybody', () => {
    expect(slotAccepts('IR', 'QB')).toBe(true);
    expect(irEligible(null)).toBe(false);
  });

  it('accepts the season-length reserve designations', () => {
    for (const s of ['IR', 'PUP', 'NFI', 'NA', 'COV', 'DNR', 'SUS']) {
      expect(irEligible(s)).toBe(true);
    }
  });

  // ⚠️ THE RULE THAT MATTERS. Out and Doubtful are week-to-week game statuses,
  // and letting them onto IR hands every manager a free extra bench spot every
  // Sunday — IR does not count against the roster limit.
  it('refuses week-to-week game statuses', () => {
    for (const s of ['Out', 'Doubtful', 'Questionable', 'Probable']) {
      expect(irEligible(s)).toBe(false);
    }
  });

  it('refuses a healthy player', () => {
    expect(irEligible(null)).toBe(false);
    expect(irEligible(undefined)).toBe(false);
    expect(irEligible('')).toBe(false);
    expect(irEligible('   ')).toBe(false);
  });

  // Sleeper writes "Sus", not "SUS".
  it('ignores case and surrounding space in the designation', () => {
    expect(irEligible('Sus')).toBe(true);
    expect(irEligible(' ir ')).toBe(true);
    expect(irEligible('Pup')).toBe(true);
  });

  it('lets a league widen the set', () => {
    expect(irEligible('Out')).toBe(false);
    expect(irEligible('Out', { allowed: ['IR', 'Out'] })).toBe(true);
  });

  // An empty override is a misconfiguration, not an instruction to allow
  // everybody onto IR.
  it('falls back to the default set rather than allowing anyone', () => {
    expect(irEligible('Out', { allowed: [] })).toBe(false);
    expect(irEligible('IR', { allowed: [] })).toBe(true);
  });

  it('narrows as well as widens', () => {
    expect(irEligible('SUS', { allowed: ['IR'] })).toBe(false);
  });
});
