// plugins/dnd-campaign-merge.test.js
import { describe, it, expect } from 'vitest';
import { mergeCampaign } from './dnd-campaign-merge.js';

const clone = o => JSON.parse(JSON.stringify(o));

describe('mergeCampaign', () => {
  it('takes remote when we changed nothing', () => {
    const base = { name: 'A', maps: {} };
    expect(mergeCampaign(base, clone(base), { name: 'B', maps: {} })).toEqual({ name: 'B', maps: {} });
  });

  it('keeps our change when remote is unchanged', () => {
    const base = { name: 'A' };
    expect(mergeCampaign(base, { name: 'Ours' }, clone(base))).toEqual({ name: 'Ours' });
  });

  it('keeps both sides when they touched different keys', () => {
    const base = { maps: { m: { tokens: { a: { x: 1 }, b: { x: 1 } } } } };
    const local = clone(base);  local.maps.m.tokens.a.x = 5;   // DM moved a
    const remote = clone(base); remote.maps.m.tokens.b.x = 9;  // player moved b
    expect(mergeCampaign(base, local, remote).maps.m.tokens).toEqual({ a: { x: 5 }, b: { x: 9 } });
  });

  it('local wins a true conflict on the same leaf', () => {
    const base = { v: 1 };
    expect(mergeCampaign(base, { v: 2 }, { v: 3 })).toEqual({ v: 2 });
  });

  it('honours a deletion made locally', () => {
    const base = { tokens: { a: { x: 1 }, b: { x: 1 } } };
    const local = { tokens: { b: { x: 1 } } };
    expect(mergeCampaign(base, local, clone(base))).toEqual({ tokens: { b: { x: 1 } } });
  });

  it('honours a deletion made remotely while we edited something else', () => {
    const base = { tokens: { a: { x: 1 }, b: { x: 1 } } };
    const local = clone(base); local.tokens.b.x = 2;
    const remote = { tokens: { b: { x: 1 } } };
    expect(mergeCampaign(base, local, remote)).toEqual({ tokens: { b: { x: 2 } } });
  });

  it('merges primitive arrays as sets (two players join at once)', () => {
    const base = { members: ['dm'] };
    const local = { members: ['dm', 'alice'] };
    const remote = { members: ['dm', 'bob'] };
    expect(mergeCampaign(base, local, remote).members).toEqual(['dm', 'bob', 'alice']);
  });

  it('a set removal survives a concurrent addition', () => {
    const base = { members: ['dm', 'alice'] };
    const local = { members: ['dm'] };                 // DM kicked alice
    const remote = { members: ['dm', 'alice', 'bob'] }; // bob joined
    expect(mergeCampaign(base, local, remote).members).toEqual(['dm', 'bob']);
  });

  it('merges id-keyed object arrays by id', () => {
    const base = { pins: [{ id: 'p1', label: 'a' }] };
    const local = { pins: [{ id: 'p1', label: 'a' }, { id: 'p2', label: 'mine' }] };
    const remote = { pins: [{ id: 'p1', label: 'renamed' }] };
    expect(mergeCampaign(base, local, remote).pins).toEqual([
      { id: 'p1', label: 'renamed' }, { id: 'p2', label: 'mine' },
    ]);
  });

  it('treats a missing remote as "nothing stored": local wins', () => {
    expect(mergeCampaign({ a: 1 }, { a: 2 }, null)).toEqual({ a: 2 });
  });

  it('with no base (first save this session) takes local', () => {
    expect(mergeCampaign(undefined, { a: 2 }, { a: 3 })).toEqual({ a: 2 });
  });

  it('does not mutate its inputs', () => {
    const base = { m: { a: 1 } }, local = { m: { a: 2 } }, remote = { m: { a: 1, b: 1 } };
    const snap = JSON.stringify([base, local, remote]);
    mergeCampaign(base, local, remote);
    expect(JSON.stringify([base, local, remote])).toBe(snap);
  });
});

import { staleCharacterIds, pruneDeadHeroes } from './dnd-campaign-merge.js';

describe('pruneDeadHeroes', () => {
  const heroes = () => ({ live: { n: 1 }, gone1: { n: 2 }, gone2: { n: 3 }, current: { n: 4 } });
  const index = ids => async () => ({ campaignIds: ids });

  it('names the heroes whose campaign is not in the index, never the current one', () => {
    expect(staleCharacterIds(heroes(), ['live'], 'current').sort()).toEqual(['gone1', 'gone2']);
    expect(staleCharacterIds(heroes(), null, 'current').sort()).toEqual(['gone1', 'gone2', 'live']);
  });

  it('drops dead heroes against a fresh index read and keeps the rest', async () => {
    const h = heroes();
    expect((await pruneDeadHeroes(h, 'current', null, index(['live']))).sort()).toEqual(['gone1', 'gone2']);
    expect(Object.keys(h).sort()).toEqual(['current', 'live']);
  });

  it('a cached index that already explains every hero skips the read', async () => {
    let reads = 0;
    const h = { live: {}, current: {} };
    await pruneDeadHeroes(h, 'current', ['live', 'current'], async () => { reads++; return { campaignIds: [] }; });
    expect(reads).toBe(0);
    expect(Object.keys(h).sort()).toEqual(['current', 'live']);
  });

  it('trusts only the fresh read: a campaign missing from a stale cache but in the index is kept', async () => {
    const h = { joinedInAnotherTab: {}, current: {} };
    expect(await pruneDeadHeroes(h, 'current', [], index(['joinedInAnotherTab']))).toEqual([]);
    expect(Object.keys(h).sort()).toEqual(['current', 'joinedInAnotherTab']);
  });

  it('an unreadable index prunes nothing (a failed read looks like "no data")', async () => {
    for (const readIndex of [async () => null, async () => ({}), async () => { throw new Error('net'); }]) {
      const h = heroes();
      expect(await pruneDeadHeroes(h, 'current', null, readIndex)).toEqual([]);
      expect(Object.keys(h).length).toBe(4);
    }
  });
});
