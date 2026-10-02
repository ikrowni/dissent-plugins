// plugins/dnd-campaign-pick.test.js
import { it, expect } from 'vitest';
import { pickCampaign } from './dnd-campaign-pick.js';

const cs = [
  { id: 'a', dmUserId: 'dm', members: ['p1'] },
  { id: 'b', dmUserId: 'p1', members: [] },
];
it('prefers the stored active campaign when the user belongs to it', () => {
  expect(pickCampaign(cs, 'b', 'p1')?.id).toBe('b');
});
it('falls back to any campaign the user plays or runs', () => {
  expect(pickCampaign(cs, 'zzz', 'p1')?.id).toBe('a');
});
it('ignores a stored campaign the user is not part of', () => {
  expect(pickCampaign(cs, 'a', 'stranger')).toBe(null);
});
