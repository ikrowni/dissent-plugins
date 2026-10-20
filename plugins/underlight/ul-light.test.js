import { describe, it, expect } from 'vitest';
import { parseRoom } from './ul-room.js';
import { buildSegs, raySeg, visPoly, los, oilRadius, lightLevel, makeLights } from './ul-light.js';

const room = parseRoom(['######', '#P   #', '#  # #', '######']);

describe('oilRadius', () => {
  it('grows with oil and drops to a spark at zero', () => {
    expect(oilRadius(100)).toBe(300);
    expect(oilRadius(50)).toBe(185);
    expect(oilRadius(0)).toBe(34);
  });
});

describe('buildSegs', () => {
  it('merges a run of wall into one edge', () => {
    const segs = buildSegs(parseRoom(['####', '#P #', '####']));
    // the inside of a 2x1 hole: top, bottom, left, right
    expect(segs).toContainEqual([24, 24, 72, 24]);
    expect(segs).toContainEqual([24, 48, 72, 48]);
    expect(segs).toContainEqual([24, 24, 24, 48]);
    expect(segs).toContainEqual([72, 24, 72, 48]);
  });
});

describe('raySeg', () => {
  it('hits a wall in front and misses one behind', () => {
    expect(raySeg(0, 0, 1, 0, [10, -5, 10, 5])).toBeCloseTo(10);
    expect(raySeg(0, 0, -1, 0, [10, -5, 10, 5])).toBe(null);
  });
});

describe('visPoly and los', () => {
  const segs = buildSegs(room);
  it('stops light at the stone pillar', () => {
    const pts = visPoly(segs, 36, 60, 300);
    // no lit point lies inside the pillar (col 3, row 2)
    for (let i = 0; i < pts.length; i += 2) {
      const inside = pts[i] > 72.5 && pts[i] < 95.5 && pts[i + 1] > 48.5 && pts[i + 1] < 71.5;
      expect(inside).toBe(false);
    }
  });
  it('sees across open air and not through the pillar', () => {
    expect(los(room, 36, 36, 108, 36)).toBe(true);
    expect(los(room, 60, 60, 108, 60)).toBe(false);
  });
});

describe('lightLevel', () => {
  it('is brightest at the light and zero past its reach or behind a wall', () => {
    const L = [{ x: 36, y: 60, r: 100, kind: 'player' }];
    expect(lightLevel(room, L, 36, 60).v).toBeCloseTo(1);
    expect(lightLevel(room, L, 108, 60).v).toBe(0);
    expect(lightLevel(room, L, 36, 36).v).toBeGreaterThan(0.7);
  });
  it('ignores an unlit sconce', () => {
    expect(lightLevel(room, [{ x: 36, y: 36, r: 22, kind: 'ember' }], 36, 36).v).toBe(0);
  });
});

describe('makeLights', () => {
  const base = () => ({
    player: { x: 30, y: 10, w: 18, h: 40, face: 1, oil: 100, snuffT: 0, dead: false },
    lantern: { state: 'held', x: 0, y: 0 }, sconces: [{ x: 100, y: 30, lit: false }],
  });
  it('puts your light in your hand, sized by oil', () => {
    const L = makeLights(base());
    expect(L[0]).toMatchObject({ kind: 'player', r: 300, x: 29, y: 32 });
    expect(L[1]).toMatchObject({ kind: 'ember', r: 22 });
  });
  it('shrinks to almost nothing while snuffed', () => {
    const S = base(); S.player.snuffT = 2;
    expect(makeLights(S)[0].r).toBe(30);
  });
  it('a thrown lantern lights where it is, and you keep a faint glow', () => {
    const S = base(); S.lantern = { state: 'rest', x: 200, y: 40 };
    expect(makeLights(S).map((l) => l.kind)).toEqual(['lantern', 'hand', 'ember']);
  });
});
