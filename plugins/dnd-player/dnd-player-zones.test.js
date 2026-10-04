import { describe, it, expect } from 'vitest';
import { zoneVolume } from './dnd-player-zones.js';

const zone = { x: 10.5, y: 8.5, radius: 4, maxVolume: 1 };
// A token's place in squares is its centre: square (10,8) has its centre at (10.5, 8.5).
const sq = (cx, cy) => ({ x: cx + 0.5, y: cy + 0.5 });

describe('zoneVolume', () => {
  it('full at the centre', () => expect(zoneVolume(zone, sq(10, 8))).toBe(1));
  it('fades with distance, in a straight line', () => {
    expect(zoneVolume(zone, sq(12, 8))).toBe(0.5);
    expect(zoneVolume(zone, sq(13, 8))).toBe(0.25);
    expect(zoneVolume(zone, sq(11, 8))).toBe(0.75);
  });
  it('silent at the edge and beyond', () => {
    expect(zoneVolume(zone, sq(14, 8))).toBe(0);
    expect(zoneVolume(zone, sq(16, 8))).toBe(0);
  });
  it('a quieter zone scales the same way', () => expect(zoneVolume({ ...zone, maxVolume: 0.5 }, sq(12, 8))).toBe(0.25));
  it('nothing known, nothing heard', () => {
    expect(zoneVolume(zone, null)).toBe(0);
    expect(zoneVolume({ ...zone, radius: 0 }, sq(10, 8))).toBe(0);
  });
  it('the old bug: a position in pixels is far outside every zone', () => expect(zoneVolume(zone, { x: 525, y: 425 })).toBe(0));
});
