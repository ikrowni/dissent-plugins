// plugins/dnd-hub/dnd-hub-movement.test.js
import { describe, it, expect } from 'vitest';
import { cellAt, turnKey, moveMode, pathFeet, cellsBetween, extendPath, checkReportedPath, speedOf, placeVerdict } from './dnd-hub-movement.js';

const c = (cx, cy) => ({ cx, cy });

describe('moveMode', () => {
  it('is free outside a fight, and always for the DM', () => {
    expect(moveMode({ isDM: false, activeTurnTokenId: null, tokenId: 't' })).toBe('free');
    expect(moveMode({ isDM: true, activeTurnTokenId: 'x', tokenId: 't' })).toBe('free');
  });
  it('locks a player token out of turn and budgets it on its turn', () => {
    expect(moveMode({ isDM: false, activeTurnTokenId: 'x', tokenId: 't' })).toBe('locked');
    expect(moveMode({ isDM: false, activeTurnTokenId: 't', tokenId: 't' })).toBe('budget');
  });
});

describe('turnKey', () => {
  it('is null outside a fight and differs per round and turn', () => {
    expect(turnKey({ round: 2, currentIndex: 1 }, null)).toBe(null);
    expect(turnKey({ round: 2, currentIndex: 1 }, 't')).not.toBe(turnKey({ round: 3, currentIndex: 1 }, 't'));
  });
});

describe('cellAt / pathFeet / cellsBetween', () => {
  it('finds cells with an offset grid', () => {
    expect(cellAt(105, 49, 5, 0, 50)).toEqual(c(2, 0));
  });
  it('counts 5 ft a step, diagonals included', () => {
    expect(pathFeet([c(0, 0)])).toBe(0);
    expect(pathFeet([c(0, 0), c(1, 1), c(2, 2)])).toBe(10);
  });
  it('fills the cells a pointer skipped', () => {
    expect(cellsBetween(c(0, 0), c(3, 0))).toEqual([c(1, 0), c(2, 0), c(3, 0)]);
    expect(cellsBetween(c(0, 0), c(0, 0))).toEqual([]);
  });
});

describe('extendPath', () => {
  it('stops at the speed limit — no step past it', () => {
    const r = extendPath([c(0, 0)], c(10, 0), { speedFt: 30 });
    expect(pathFeet(r.path)).toBe(30);
    expect(r.path.at(-1)).toEqual(c(6, 0));
    expect(r.stopped).toBe('speed');
  });
  it('a spent path cannot be extended at all', () => {
    const spent = extendPath([c(0, 0)], c(6, 0), { speedFt: 30 }).path;
    const r = extendPath(spent, c(7, 0), { committed: spent.length, speedFt: 30 });
    expect(r.path).toEqual(spent);
    expect(r.stopped).toBe('speed');
  });
  it('retraces uncommitted cells during a drag, but never refunds committed ones', () => {
    const out = extendPath([c(0, 0), c(1, 0)], c(3, 0), { committed: 2 }).path;
    expect(extendPath(out, c(1, 0), { committed: 2 }).path).toEqual([c(0, 0), c(1, 0)]);
    // Back past the committed cell is a new step, and it costs.
    expect(pathFeet(extendPath(out, c(0, 0), { committed: 2 }).path)).toBe(10);
  });
  it('stops at a wall', () => {
    const r = extendPath([c(0, 0)], c(4, 0), { blocked: (a, b) => a.cx === 1 && b.cx === 2 });
    expect(r.path.at(-1)).toEqual(c(1, 0));
    expect(r.stopped).toBe('wall');
  });
  it('does not change its input', () => {
    const p = [c(0, 0)];
    extendPath(p, c(2, 0));
    expect(p).toEqual([c(0, 0)]);
  });
});

describe('checkReportedPath', () => {
  const turn = { path: [c(0, 0), c(1, 0)] };
  it('accepts a path that continues the turn within speed', () => {
    expect(checkReportedPath(turn, [c(0, 0), c(1, 0), c(2, 1)], 30).ok).toBe(true);
  });
  it('refuses a path that rewrites what was already walked', () => {
    expect(checkReportedPath(turn, [c(0, 0), c(0, 1), c(1, 1)], 30).ok).toBe(false);
    expect(checkReportedPath(turn, [c(0, 0)], 30).ok).toBe(false);
  });
  it('refuses a jump, a wall crossing, and going past speed', () => {
    expect(checkReportedPath(turn, [c(0, 0), c(1, 0), c(5, 0)], 30).ok).toBe(false);
    expect(checkReportedPath(turn, [c(0, 0), c(1, 0), c(2, 0)], 30, () => true).ok).toBe(false);
    const long = [c(0, 0), c(1, 0), c(2, 0), c(3, 0), c(4, 0), c(5, 0), c(6, 0), c(7, 0)];
    const r = checkReportedPath(turn, long, 30);
    expect(r.ok).toBe(false);
    expect(r.path).toEqual(turn.path);
  });
});

describe('speedOf', () => {
  it('uses the token, then the character, then 30', () => {
    expect(speedOf({ speed: 40 }, { speed: 25 })).toBe(40);
    expect(speedOf({}, { speed: 25 })).toBe(25);
    expect(speedOf({}, null)).toBe(30);
  });
  it('is 0 while grappled or restrained', () => {
    expect(speedOf({ speed: 30, conditions: ['Grappled'] })).toBe(0);
  });
});

describe('placeVerdict', () => {
  it('allows revealed ground only', () => {
    const fog = { '1,1': 'visible', '2,2': 'explored', '3,3': 'unexplored' };
    expect(placeVerdict(fog, c(1, 1))).toBe('ok');
    expect(placeVerdict(fog, c(2, 2))).toBe('ok');
    expect(placeVerdict(fog, c(3, 3))).toBe('fogged');
    expect(placeVerdict(fog, c(9, 9))).toBe('fogged');
  });
  it('says when nothing is revealed at all', () => {
    expect(placeVerdict({}, c(0, 0))).toBe('nothing-revealed');
  });
});
