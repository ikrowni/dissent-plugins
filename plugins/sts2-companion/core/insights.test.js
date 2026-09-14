import { describe, it, expect } from 'vitest';
import { insights, MIN_RATE_N, LOW_SAMPLE_N } from './insights.js';

const IC = 'CHARACTER.IRONCLAD';
const SI = 'CHARACTER.SILENT';
const solo = (over = {}, soloOver = {}) => ({
  v: 1, id: String(Math.random()), build: 'v0.99.1', ascension: 0, players: 1, characters: [IC],
  win: false, abandoned: false, floors: 20, killedBy: 'ENCOUNTER.A', fought: ['ENCOUNTER.A'],
  mine: { character: IC, buildTags: ['Vulnerable'], damageByAct: [10, 20], choices: [], ...soloOver },
  ...over,
});
const coop = (over = {}) => ({ ...solo(over), players: 2, characters: [IC, SI], mine: null });
/** A co-op run where the app knew which player was the user. */
const coopMine = (over = {}, mineOver = {}) => ({ ...solo(over, mineOver), players: 2, characters: [IC, SI] });

describe('insights', () => {
  it('ignores abandoned runs and runs that neither won nor died', () => {
    const r = insights([solo({ abandoned: true }), solo({ killedBy: null }), solo()]);
    expect(r.runs).toBe(1);
  });

  it('ignores runs that never got past the first floor, and custom games', () => {
    const r = insights([solo({ floors: 1 }), solo({ floors: 0 }), solo({ gameMode: 'custom' }), solo()]);
    expect(r.runs).toBe(1);
    expect(r.hidden).toBe(3);
  });

  it('counts a co-op run with no known player for survivability but never for builds, HP or cards', () => {
    const r = insights([coop(), solo()]);
    expect(r).toMatchObject({ runs: 2, soloRuns: 1, coopRuns: 1, yourRuns: 1 });
    expect(r.encounters.find((e) => e.id === 'ENCOUNTER.A')).toMatchObject({ fought: 2, deaths: 2 });
    expect(r.buildTypes).toHaveLength(1);
    expect(r.buildTypes[0].runs).toBe(1);
  });

  it('a co-op run where your player is known counts toward your builds and picks', () => {
    const r = insights([coopMine({}, { buildTags: ['Poison'], character: SI }), solo(), coop()]);
    expect(r).toMatchObject({ runs: 3, soloRuns: 1, coopRuns: 2, yourRuns: 2 });
    expect(r.buildTypes.map((b) => b.label).sort()).toEqual(['Poison', 'Vulnerable']);
    // Filtered to Silent: the co-op run counts because YOUR character was Silent.
    expect(insights([coopMine({}, { character: SI })], { character: SI })).toMatchObject({ runs: 1, yourRuns: 1 });
  });

  it(`shows no rate under ${MIN_RATE_N} samples and marks few runs under ${LOW_SAMPLE_N}`, () => {
    const four = insights(Array.from({ length: 4 }, () => solo()));
    expect(four.encounters[0].rate).toMatchObject({ rate: null, n: 4, lowSample: true });
    const six = insights(Array.from({ length: 6 }, () => solo()));
    expect(six.encounters[0].rate).toMatchObject({ rate: 1, n: 6, lowSample: true });
    expect(six.encounters[0].rate.low).toBeGreaterThan(0.5);
  });

  it('death rate is runs ended there over runs that fought it', () => {
    const ds = [
      ...Array.from({ length: 3 }, () => solo({ fought: ['ENCOUNTER.A', 'ENCOUNTER.B'], killedBy: 'ENCOUNTER.B' })),
      ...Array.from({ length: 7 }, () => solo({ fought: ['ENCOUNTER.A', 'ENCOUNTER.B'], win: true, killedBy: null })),
    ];
    const r = insights(ds);
    expect(r.encounters.map((e) => [e.id, e.fought, e.deaths])).toEqual([['ENCOUNTER.B', 10, 3], ['ENCOUNTER.A', 10, 0]]);
    expect(r.encounters[0].rate.rate).toBeCloseTo(0.3);
    expect(r.wins).toBe(7);
  });

  it('filters by character, counting a co-op run for either of its characters', () => {
    const r = insights([coop(), solo(), solo({ characters: [SI] }, { character: SI })], { character: SI });
    expect(r).toMatchObject({ runs: 2, soloRuns: 1, coopRuns: 1 });
  });

  it('floor buckets of ten', () => {
    const r = insights([solo({ floors: 3 }), solo({ floors: 10 }), solo({ floors: 11 }), solo({ floors: 45 })]);
    expect(r.floorBuckets).toEqual([
      { label: '1–10', n: 2 }, { label: '11–20', n: 1 }, { label: '21–30', n: 0 }, { label: '31–40', n: 0 }, { label: '41+', n: 1 },
    ]);
  });

  it('average damage per act over solo runs', () => {
    const r = insights([solo({}, { damageByAct: [10, 30] }), solo({}, { damageByAct: [20] })]);
    expect(r.damageByAct).toEqual([{ act: 1, mean: 15, n: 2 }, { act: 2, mean: 30, n: 1 }]);
  });

  it('build types: runs, wins, rate and median floor, most runs first', () => {
    const r = insights([
      solo({ win: true, killedBy: null, floors: 40 }),
      solo({ floors: 20 }),
      solo({ floors: 30 }, { buildTags: [] }),
    ]);
    expect(r.buildTypes.map((b) => [b.label, b.runs, b.wins, b.medianFloor])).toEqual([['Vulnerable', 2, 1, 30], ['Mixed', 1, 0, 30]]);
  });

  it('card impact: picked-win rate minus skipped-win rate, only where both can be shown', () => {
    const pick = (win) => solo(win ? { win: true, killedBy: null } : {}, { choices: [{ id: 'CARD.X', picked: true }] });
    const skip = (win) => solo(win ? { win: true, killedBy: null } : {}, { choices: [{ id: 'CARD.X', picked: false }] });
    const r = insights([pick(true), pick(true), pick(true), pick(true), pick(false), skip(true), skip(false), skip(false), skip(false), skip(false)]);
    const x = r.cards.find((c) => c.id === 'CARD.X');
    expect(x).toMatchObject({ offered: 10, picked: 5 });
    expect(x.pickedRate.rate).toBeCloseTo(0.8);
    expect(x.skippedRate.rate).toBeCloseTo(0.2);
    expect(x.impact).toBeCloseTo(0.6);
    const thin = insights([pick(true), skip(false)]).cards.find((c) => c.id === 'CARD.X');
    expect(thin.impact).toBeNull();
  });
});
