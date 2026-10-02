import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('./plugin-sdk.js', () => ({ realtimePublish: vi.fn(async () => null), realtimePublishCompanion: vi.fn(async () => null) }));
import { realtimePublish, realtimePublishCompanion } from './plugin-sdk.js';
import { publishTo, isRepeat } from './lk-bus.js';

beforeEach(() => vi.clearAllMocks());

describe('publishTo', () => {
  it('reaches its own peers and every named sibling, with one id', async () => {
    const p = await publishTo(['hub', 'player'], 'hp:change', { hp: 3 });
    expect(realtimePublish).toHaveBeenCalledWith('hp:change', p);
    expect(realtimePublishCompanion).toHaveBeenCalledWith('dnd-hub', 'hp:change', p);
    expect(realtimePublishCompanion).toHaveBeenCalledWith('dnd-player', 'hp:change', p);
    expect(p.eid).toBeTruthy();
    expect(p.type).toBe('hp:change');
  });
});

describe('isRepeat', () => {
  it('handles an event once', () => {
    expect(isRepeat({ eid: 'a1' })).toBe(false);
    expect(isRepeat({ eid: 'a1' })).toBe(true);
    expect(isRepeat({})).toBe(false);
  });
});
