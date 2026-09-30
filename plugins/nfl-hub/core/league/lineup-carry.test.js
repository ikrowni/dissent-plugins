import { describe, it, expect } from 'vitest';
import { effectiveLineup } from './lineup-carry.js';

// A store of saved weeks, exactly the shape setLineup writes: { lineup, setAt, setBy }.
const store = (weeks) => (w) => weeks[w] ?? null;
const saved = (lineup, setAt = 1) => ({ lineup, setAt, setBy: 'u1' });

describe('effectiveLineup', () => {
  it("returns the week's own lineup when one was saved", () => {
    const got = effectiveLineup(store({ 5: saved(['qb1', 'rb1']) }), 5, ['qb1', 'rb1']);
    expect(got.lineup).toEqual(['qb1', 'rb1']);
    expect(got.carriedFrom).toBeNull();
  });

  it('carries the last saved week forward into an unset week — the reported bug', () => {
    const got = effectiveLineup(store({ 3: saved(['qb1', 'rb1', 'wr1']) }), 6, ['qb1', 'rb1', 'wr1']);
    expect(got.lineup).toEqual(['qb1', 'rb1', 'wr1']);
    expect(got.carriedFrom).toBe(3);
  });

  it('uses the MOST RECENT saved week, not the first', () => {
    const got = effectiveLineup(
      store({ 1: saved(['qb2', 'rb2']), 4: saved(['qb1', 'rb1']) }), 6, ['qb1', 'qb2', 'rb1', 'rb2'],
    );
    expect(got.lineup).toEqual(['qb1', 'rb1']);
    expect(got.carriedFrom).toBe(4);
  });

  it('a manual change in one week (an injury) carries forward from there', () => {
    const weeks = { 2: saved(['qb1', 'rb1']), 5: saved(['qb1', 'rb3']) }; // rb1 hurt in week 5
    expect(effectiveLineup(store(weeks), 7, ['qb1', 'rb1', 'rb3']).lineup).toEqual(['qb1', 'rb3']);
    expect(effectiveLineup(store(weeks), 4, ['qb1', 'rb1', 'rb3']).lineup).toEqual(['qb1', 'rb1']);
  });

  it('a carried player no longer on the roster becomes an empty slot, never a scored one', () => {
    const got = effectiveLineup(store({ 2: saved(['qb1', 'rb1', 'wr1']) }), 3, ['qb1', 'wr1']); // rb1 dropped
    expect(got.lineup).toEqual(['qb1', null, 'wr1']);
  });

  it('keeps holes the manager saved on purpose', () => {
    expect(effectiveLineup(store({ 2: saved(['qb1', null]) }), 3, ['qb1']).lineup).toEqual(['qb1', null]);
  });

  it('a lineup deliberately saved empty counts as set and is not overridden by an older one', () => {
    const got = effectiveLineup(store({ 1: saved(['qb1']), 2: saved([]) }), 2, ['qb1']);
    expect(got.lineup).toEqual([]);
    expect(got.carriedFrom).toBeNull();
  });

  it('returns an empty lineup when no week has ever been set', () => {
    const got = effectiveLineup(store({}), 1, ['qb1']);
    expect(got).toEqual({ lineup: [], setAt: null, setBy: null, carriedFrom: null });
  });

  it('never looks at a LATER week', () => {
    const got = effectiveLineup(store({ 8: saved(['qb1']) }), 5, ['qb1']);
    expect(got.lineup).toEqual([]);
  });
});
