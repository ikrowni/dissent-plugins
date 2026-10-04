import { describe, it, expect } from 'vitest';
import { campaignSummary, needsCampaign, summariesForIndex, idsForIndex, summariesChanged } from './lk-campaign-index.js';

describe('lk-campaign-index', () => {
  it('a summary carries only public facts, with a short description', () => {
    const s = campaignSummary({ id: 'c', name: 'N', dmUserId: 'dm', members: ['b'], description: 'x'.repeat(999),
      maps: { m: {} }, traps: [1], visibility: 'open', autoAccept: 1 });
    expect(s.description).toHaveLength(280);
    expect(s).not.toHaveProperty('maps');
    expect(s).not.toHaveProperty('traps');
    expect(s.autoAccept).toBe(true);
  });
  it('a missing summary or unknown user means read it', () => {
    expect(needsCampaign({}, 'c', 'bob')).toBe(true);
    expect(needsCampaign(null, 'c', 'bob')).toBe(true);
    expect(needsCampaign({ c: { dmUserId: 'x', members: [] } }, 'c', null)).toBe(true);
    expect(needsCampaign({ c: { dmUserId: 'x', members: [] } }, 'c', 'bob')).toBe(false);
    expect(needsCampaign({ c: { dmUserId: 'x', members: ['bob'] } }, 'c', 'bob')).toBe(true);
    expect(needsCampaign({ c: { dmUserId: 'bob', members: [] } }, 'c', 'bob')).toBe(true);
  });
  it('a failed fresh read leaves unwritten campaigns without a summary (safe: they get read)', () => {
    const out = summariesForIndex(['a', 'b'], { a: { id: 'a', dmUserId: 'dm' } }, null);
    expect(Object.keys(out)).toEqual(['a']);
  });
  it('ids: fresh ones are kept unless this screen removed them', () => {
    expect(idsForIndex(['a'], ['a', 'b', 'gone'], ['gone'])).toEqual(['a', 'b']);
  });
  it('summariesChanged notices a new member and a missing summary', () => {
    const c = { id: 'a', dmUserId: 'dm', members: ['b'] };
    expect(summariesChanged({ a: c }, {})).toBe(true);
    expect(summariesChanged({ a: c }, { a: campaignSummary(c) })).toBe(false);
    expect(summariesChanged({ a: { ...c, members: [] } }, { a: campaignSummary(c) })).toBe(true);
  });
});
