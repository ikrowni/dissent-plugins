import { describe, it, expect } from 'vitest';
import { createLimits } from './limits.mjs';

describe('daily limits', () => {
  it('gives each contributor and each IP its own daily allowance', () => {
    let t = Date.UTC(2026, 8, 14, 12);
    const l = createLimits({ perContributor: 5, perIp: 8, now: () => t });
    expect(l.take('c1', '203.0.113.9', 4)).toBe(4);
    expect(l.take('c1', '203.0.113.9', 4)).toBe(1); // contributor cap
    expect(l.take('c2', '203.0.113.9', 4)).toBe(3); // IP cap: 5 used, 8 allowed
    t += 24 * 3600 * 1000;
    expect(l.take('c1', '203.0.113.9', 4)).toBe(4); // a new day
  });

  // 🔴 The IP is never kept as itself — not even in memory — and its key changes every day.
  it('🔴 keys IPs by a salted hash that rotates daily', () => {
    let t = Date.UTC(2026, 8, 14, 12);
    const l = createLimits({ now: () => t });
    l.take('c1', '203.0.113.9', 1);
    const day1 = l._keys();
    expect(day1.join()).not.toContain('203.0.113.9');
    t += 24 * 3600 * 1000;
    l.take('c1', '203.0.113.9', 1);
    const day2 = l._keys().filter((k) => k.startsWith('ip:'));
    expect(day2).not.toEqual(day1.filter((k) => k.startsWith('ip:')));
  });
});
