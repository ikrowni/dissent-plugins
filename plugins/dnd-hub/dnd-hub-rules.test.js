// plugins/dnd-hub/dnd-hub-rules.test.js
import { describe, it, expect } from 'vitest';
import { playerTokensToSeed, dragStep, findDoorAt, nextDoorState, playerMayToggleDoor } from './dnd-hub-rules.js';

describe('playerTokensToSeed', () => {
  const campaign = { members: ['a', 'b', 'c'], characterSummaries: { a: {}, b: {} } };
  it('seeds members with a character and no token, once', () => {
    expect(playerTokensToSeed(campaign, { tokens: {}, seededPlayers: {} })).toEqual(['a', 'b']);
  });
  it('never re-seeds a player whose token the DM deleted', () => {
    expect(playerTokensToSeed(campaign, { tokens: {}, seededPlayers: { a: true } })).toEqual(['b']);
  });
  it('treats an existing token as seeded (maps from before this field existed)', () => {
    expect(playerTokensToSeed(campaign, { tokens: { player_a: {} } })).toEqual(['b']);
  });
});

describe('dragStep', () => {
  const crossesAtX5 = (x1, _y1, x2) => (x1 < 5) !== (x2 < 5);
  it('moves freely when no wall is crossed', () => {
    expect(dragStep({ x: 1, y: 1 }, { x: 3, y: 1 }, crossesAtX5)).toEqual({ x: 3, y: 1, blocked: false });
  });
  it('stays at the last valid point when the pointer crosses a wall', () => {
    expect(dragStep({ x: 3, y: 1 }, { x: 7, y: 1 }, crossesAtX5)).toEqual({ x: 3, y: 1, blocked: true });
  });
});

describe('doors', () => {
  const toPx = d => d;
  const doors = { d1: { id: 'd1', x1: 0, y1: 0, x2: 0, y2: 100, state: 'closed' }, w: { id: 'w', x1: 50, y1: 0, x2: 50, y2: 10, isWindow: true } };
  it('finds a door anywhere along its length, not just the middle', () => {
    expect(findDoorAt(doors, 3, 90, 10, toPx)?.id).toBe('d1');
  });
  it('never returns a window', () => {
    expect(findDoorAt(doors, 50, 5, 10, toPx)).toBe(null);
  });
  it('DM cycles closed→open→locked→closed; players toggle open/closed', () => {
    expect(nextDoorState('closed', true)).toBe('open');
    expect(nextDoorState('open', true)).toBe('locked');
    expect(nextDoorState('locked', true)).toBe('closed');
    expect(nextDoorState('closed', false)).toBe('open');
    expect(nextDoorState('open', false)).toBe('closed');
    expect(nextDoorState('locked', false)).toBe('locked');
  });
  it('players must stand within 1.5 cells of the door', () => {
    const d = doors.d1;
    expect(playerMayToggleDoor(d, { x: 30, y: 50 }, 40, toPx)).toBe(true);
    expect(playerMayToggleDoor(d, { x: 100, y: 50 }, 40, toPx)).toBe(false);
    expect(playerMayToggleDoor(d, null, 40, toPx)).toBe(false);
  });
});

import { snapToGrid } from './dnd-hub-rules.js';
describe('snapToGrid', () => {
  it('puts a medium token in the cell under the pointer, not the next one over', () => {
    // cell 6 spans 300–350 (gs 50, no offset); its centre is 325
    expect(snapToGrid(330, 0, 50, 1)).toBe(325);
    expect(snapToGrid(349, 0, 50, 1)).toBe(325);
    expect(snapToGrid(301, 0, 50, 1)).toBe(325);
  });
  it('respects the grid offset', () => {
    expect(snapToGrid(37, 10, 50, 1)).toBe(35);
  });
  it('large (even-sized) tokens snap their centre to the nearest grid corner', () => {
    expect(snapToGrid(330, 0, 50, 2)).toBe(350);
    expect(snapToGrid(310, 0, 50, 2)).toBe(300);
  });
  it('tiny tokens centre in a cell too', () => {
    expect(snapToGrid(330, 0, 50, 0.5)).toBe(325);
  });
  it('huge (3×3) tokens centre on a cell like medium ones', () => {
    expect(snapToGrid(330, 0, 50, 3)).toBe(325);
  });
});

import { newPlayerToken, placeOwnTokenVerdict } from './dnd-hub-rules.js';
describe('placing your own token', () => {
  it('builds a player token from the character summary', () => {
    const t = newPlayerToken('u1', { name: 'Thorin', hp: 12, hpMax: 12 }, 2, 125, 175, 8);
    expect(t).toMatchObject({ id: 'player_u1', type: 'player', userId: 'u1', name: 'Thorin', x: 125, y: 175, hp: 12, hpMax: 12, colorIdx: 2 });
  });
  it('moves an existing token', () => {
    expect(placeOwnTokenVerdict({ tokens: { player_u1: {} } }, 'u1')).toBe('move');
  });
  it('creates one when none was ever placed', () => {
    expect(placeOwnTokenVerdict({ tokens: {}, seededPlayers: {} }, 'u1')).toBe('create');
  });
  it('refuses when the DM removed it', () => {
    expect(placeOwnTokenVerdict({ tokens: {}, seededPlayers: { u1: true } }, 'u1')).toBe('removed-by-dm');
  });
});

import { fogAlpha } from './dnd-hub-rules.js';
import { campaignRecord, waitingSpot, newWaitingToken, isOwnWaitingSpawn, touching } from './dnd-hub-rules.js';
describe('fogAlpha', () => {
  it('players: unexplored is solid, explored is dimmed, visible is clear', () => {
    expect(fogAlpha('unexplored', false)).toBe(1);
    expect(fogAlpha('explored', false)).toBe(0.55);
    expect(fogAlpha('visible', false)).toBe(0);
  });
  it('the DM always sees the map through fog, as a tint', () => {
    expect(fogAlpha('unexplored', true)).toBeLessThan(0.6);
    expect(fogAlpha('unexplored', true)).toBeGreaterThan(0);
    expect(fogAlpha('explored', true)).toBeLessThan(fogAlpha('unexplored', true));
  });
});

describe('campaignRecord', () => {
  it('fills every field a new campaign needs', () => {
    const c = campaignRecord({ id: 'c1', name: 'N', dmUserId: 'u', dmDisplayName: 'Dee', now: '2026-10-03T00:00:00Z' });
    expect(c).toMatchObject({ id: 'c1', name: 'N', description: '', dmUserId: 'u', visibility: 'open', autoAccept: true,
      maxPlayers: 4, startingLevel: 1, members: [], maps: {}, encounters: {}, journals: {}, items: {}, scenes: {},
      activeMapId: null, status: 'active' });
  });
});

describe('waiting tokens', () => {
  it('wait left of the map, one row per party member, up from the bottom', () => {
    expect(waitingSpot(0, 50, 800)).toEqual({ x: -75, y: 775 });
    expect(waitingSpot(2, 50, 800)).toEqual({ x: -75, y: 675 });
    expect(waitingSpot(-1, 50, 800)).toEqual({ x: -75, y: 775 }); // not a member (yet): the first row
  });
  it('on the grid\'s squares when the grid is shifted (it sat between squares), still clear of the map', () => {
    const at = (v, off) => Math.floor((v - off) / 50) * 50 + 25 + off; // a 1×1 drop's snap (snapToGrid)
    for (const [ox, oy] of [[7, 3], [40, 45], [0, 0]]) {
      const p = waitingSpot(1, 50, 790, ox, oy);
      expect(p.x).toBe(at(p.x, ox)); expect(p.y).toBe(at(p.y, oy));
      expect(p.x + 25).toBeLessThanOrEqual(-25); // a full half-square gap or more to the map's left edge
      expect(p.y + 25).toBeLessThanOrEqual(790);  // inside the map's height
    }
  });
  it('from the top while the map\'s height is not known', () => {
    expect(waitingSpot(2, 50)).toEqual({ x: -75, y: 125 });
  });
  it('a player may spawn only their own token, and only waiting', () => {
    const own = newWaitingToken('u1', { name: 'Bob' }, 0, 50, 8, 800);
    expect(isOwnWaitingSpawn({ fromUserId: 'u1', tokens: [own] })).toBe(true);
    expect(isOwnWaitingSpawn({ fromUserId: 'u2', tokens: [own] })).toBe(false);                         // someone else's
    expect(isOwnWaitingSpawn({ fromUserId: 'u1', tokens: [{ ...own, waiting: false, x: 300 }] })).toBe(false); // onto the map
    expect(isOwnWaitingSpawn({ fromUserId: 'u1', tokens: [own, { ...own, id: 'goblin' }] })).toBe(false);
    expect(isOwnWaitingSpawn({ fromUserId: 'u1', tokens: [own], deleted: ['player_u2'] })).toBe(false);
    expect(isOwnWaitingSpawn({ tokens: [own] })).toBe(false);
  });
  it('a new hero\'s token is marked waiting and is off the map', () => {
    const t = newWaitingToken('u1', { name: 'Bob', hp: 12, hpMax: 12 }, 1, 50, 8);
    expect(t).toMatchObject({ id: 'player_u1', userId: 'u1', name: 'Bob', waiting: true, x: -75, y: 75 });
    expect(t.x).toBeLessThan(0);
  });
});

import { acceptMove } from './dnd-hub-rules.js';

describe('acceptMove (audit O6)', () => {
  it('ignores my own echoed moves', () => {
    expect(acceptMove({}, { tokenId: 't', clientId: 'me', seq: 5 }, 'me')).toBe(false);
  });
  it('ignores a move older than the last one applied from that screen', () => {
    const seen = {};
    expect(acceptMove(seen, { tokenId: 't', clientId: 'b', seq: 7 }, 'me')).toBe(true);   // final (snapped) arrives first
    expect(acceptMove(seen, { tokenId: 't', clientId: 'b', seq: 6 }, 'me')).toBe(false);  // the live-drag one, late
    expect(acceptMove(seen, { tokenId: 't', clientId: 'b', seq: 8 }, 'me')).toBe(true);
  });
  it('moves without a sequence (older clients) are applied as before', () => {
    expect(acceptMove({}, { tokenId: 't' }, 'me')).toBe(true);
  });
});

import { attackVerdict, activeTokenId } from './dnd-hub-rules.js';

describe('campaignRecord settings', () => {
  it('a new campaign starts on the Guided preset', async () => {
    const { presetOf } = await import('./lk-table-rules.js');
    const c = campaignRecord({ id: 'c1', name: 'x', dmUserId: 'u1' });
    expect(presetOf(c.settings)).toBe('guided');
    expect(c.settings.spatialRange).toBe(60);
  });
});

describe('attackVerdict', () => {
  const gob = { id: 'g1', name: 'Goblin', ac: 15 }, rat = { id: 'r1', name: 'Rat', ac: 12 };
  it('says hit or miss for each target', () => {
    const v = attackVerdict([gob, rat], 8, 13);
    expect(v.hitIds).toEqual(['r1']);
    expect(v.text).toBe('Goblin: MISS (AC 15) | Rat: HIT (AC 12)');
    expect(v.crit).toBe(false);
  });
  it('a natural 20 hits whatever the AC and is a critical', () => {
    const v = attackVerdict([{ ...gob, ac: 30 }], 20, 25);
    expect(v.hitIds).toEqual(['g1']);
    expect(v.crit).toBe(true);
    expect(v.text).toContain('CRITICAL');
  });
  it('a natural 1 misses whatever the total', () => {
    expect(attackVerdict([gob], 1, 40).hitIds).toEqual([]);
  });
  it('a missing AC counts as 10', () => {
    expect(attackVerdict([{ id: 'x', name: 'X' }], 5, 10).hitIds).toEqual(['x']);
  });
  it('no target, no verdict', () => {
    expect(attackVerdict([], 15, 20)).toBe(null);
  });
});

describe('activeTokenId', () => {
  const order = [{ type: 'player', userId: 'u2', roll: 18 }, { type: 'monster', id: 'm1', roll: 9 }];
  it('a player row is their player_ token; a monster row is its own id', () => {
    expect(activeTokenId({ active: true, currentIndex: 0, order })).toBe('player_u2');
    expect(activeTokenId({ active: true, currentIndex: 1, order })).toBe('m1');
  });
  it('none while the tracker waits for rolls, or when no fight is on', () => {
    expect(activeTokenId({ active: true, waiting: true, currentIndex: 0, order })).toBe(null);
    expect(activeTokenId({ active: false, order })).toBe(null);
    expect(activeTokenId(null)).toBe(null);
  });
});

import { viewCentre, panFor } from './dnd-hub-rules.js';

describe('view sync', () => {
  it('a centre round-trips through pan', () => {
    const { cx, cy } = viewCentre(-300, -120, 1.5, 1600, 950);
    const { panX, panY } = panFor(cx, cy, 1.5, 1600, 950);
    expect([Math.round(panX), Math.round(panY)]).toEqual([-300, -120]);
  });
  it('windows of different sizes centre the same world point', () => {
    const c = { cx: 640, cy: 410 };
    for (const [w, h] of [[1280, 800], [1920, 1080]]) {
      const p = panFor(c.cx, c.cy, 2, w, h);
      const back = viewCentre(p.panX, p.panY, 2, w, h);
      expect([Math.round(back.cx), Math.round(back.cy)]).toEqual([640, 410]);
    }
  });
});

import { percentile, percentileFaces } from './dnd-hub-rules.js';
describe('percentile (d100 from two d10s)', () => {
  it('tens and ones, the 10 face reading 0, 00 and 0 being 100', () => {
    expect(percentile(3, 7)).toBe(37);
    expect(percentile(10, 5)).toBe(5);
    expect(percentile(4, 10)).toBe(40);
    expect(percentile(10, 10)).toBe(100);
  });
  it('every result from 1 to 100 comes from exactly one pair of faces, and percentileFaces finds it', () => {
    const seen = new Map();
    for (let t = 1; t <= 10; t++) for (let o = 1; o <= 10; o++) seen.set(percentile(t, o), (seen.get(percentile(t, o)) || 0) + 1);
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect([...seen.values()].every(n => n === 1)).toBe(true);
    for (let r = 1; r <= 100; r++) expect(percentile(...percentileFaces(r))).toBe(r);
  });
});

import { pointInPoly, playerSees } from './dnd-hub-rules.js';
describe('what a player sees of other tokens', () => {
  const sq = (x0, y0, s) => [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }];
  it('pointInPoly', () => {
    expect(pointInPoly(5, 5, sq(0, 0, 10))).toBe(true);
    expect(pointInPoly(15, 5, sq(0, 0, 10))).toBe(false);
  });
  it('heroes always; a monster only in vision, or in light a hero can see', () => {
    const goblin = { type: 'monster', x: 50, y: 50 };
    expect(playerSees({ type: 'player', x: 999, y: 999 }, 'u')).toBe(true);
    expect(playerSees(goblin, 'u', { visionPolys: [sq(0, 0, 100)] })).toBe(true);
    expect(playerSees(goblin, 'u', { visionPolys: [sq(200, 0, 100)] })).toBe(false);          // an explored room, not in sight
    expect(playerSees(goblin, 'u', { litPolys: [sq(0, 0, 100)], sightPolys: [sq(0, 0, 100)] })).toBe(true);
    expect(playerSees(goblin, 'u', { litPolys: [sq(0, 0, 100)], sightPolys: [] })).toBe(false); // lit, behind a shut door
  });
});

import { attackCheck, attackTurnCheck } from './dnd-hub-rules.js';
import { weaponReach, attacksPerAction } from './lk-rules5e.js';
describe('attackCheck — range, reach, flanking (owner, 2026-10-05)', () => {
  const at = (id, type, cx, cy, extra = {}) => ({ id, type, x: cx * 50 + 25, y: cy * 50 + 25, hp: 10, name: id, ...extra });
  const bob = at('bob', 'player', 5, 5), sword = weaponReach({ id: 'longsword' }), bow = weaponReach({ id: 'longbow' });
  it('a longsword hits the next square, not two away', () => {
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 6, 6), reach: sword }).ok).toBe(true);
    const far = attackCheck({ attacker: bob, target: at('g', 'monster', 7, 5), reach: sword });
    expect(far.ok).toBe(false);
    expect(far.reason).toMatch(/10 ft away/);
  });
  it('a glaive reaches two squares', () => {
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 7, 5), reach: weaponReach({ id: 'glaive' }) }).ok).toBe(true);
  });
  it('a longbow: fine to 150 ft, disadvantage to 600, nothing beyond; disadvantage with an enemy next to you', () => {
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 35, 5), reach: bow })).toMatchObject({ ok: true, mode: 'ranged', dis: false });
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 45, 5), reach: bow })).toMatchObject({ ok: true, dis: true, far: true });
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 130, 5), reach: bow }).ok).toBe(false);
    const g2 = at('g2', 'monster', 6, 5);
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 20, 5), reach: bow, tokens: [bob, g2] })).toMatchObject({ dis: true, crowded: true });
  });
  it('a thrown handaxe: melee next to you, thrown out to 60 ft', () => {
    const axe = weaponReach({ id: 'handaxe' });
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 6, 5), reach: axe }).mode).toBe('melee');
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 9, 5), reach: axe })).toMatchObject({ ok: true, mode: 'ranged', dis: false });
    expect(attackCheck({ attacker: bob, target: at('g', 'monster', 15, 5), reach: axe })).toMatchObject({ ok: true, dis: true });
  });
  it('a Large target is in reach from any square beside it (it was measured from one of its four squares)', () => {
    // An ogre covering squares 6–7 × 5–6: its centre is the corner between them.
    const ogre = { id: 'o', type: 'monster', x: 7 * 50, y: 6 * 50, hp: 30, name: 'Ogre', size: 'large' };
    expect(attackCheck({ attacker: bob, target: ogre, reach: sword })).toMatchObject({ ok: true, feet: 5 });             // beside its top-left square
    expect(attackCheck({ attacker: at('r', 'player', 8, 7), target: ogre, reach: sword })).toMatchObject({ ok: true, feet: 5 }); // its bottom-right corner
    expect(attackCheck({ attacker: at('r', 'player', 4, 5), target: ogre, reach: sword })).toMatchObject({ ok: false, feet: 10 });
    // A shifted grid (offsets) counts squares the same way.
    const shifted = t => ({ ...t, x: t.x + 20, y: t.y + 20 });
    expect(attackCheck({ attacker: shifted(bob), target: shifted(ogre), reach: sword, ox: 20, oy: 20 })).toMatchObject({ ok: true, feet: 5 });
  });
  it('flanking a Large target: an ally touching it on the far side', () => {
    const ogre = { id: 'o', type: 'monster', x: 7 * 50, y: 6 * 50, hp: 30, name: 'Ogre', size: 'large' };
    const ally = at('ria', 'player', 8, 5), above = at('ria', 'player', 6, 4);
    expect(attackCheck({ attacker: bob, target: ogre, reach: sword, tokens: [bob, ogre, ally], flanking: true }).adv).toBe(true);
    expect(attackCheck({ attacker: bob, target: ogre, reach: sword, tokens: [bob, ogre, above], flanking: true }).adv).toBe(false);
  });
  it('flanking: an ally on the far side of the target gives advantage, only with the rule on', () => {
    const g = at('g', 'monster', 6, 5), ally = at('ria', 'player', 7, 5), side = at('ria', 'player', 6, 6);
    expect(attackCheck({ attacker: bob, target: g, reach: sword, tokens: [bob, g, ally], flanking: true }).adv).toBe(true);
    expect(attackCheck({ attacker: bob, target: g, reach: sword, tokens: [bob, g, side], flanking: true }).adv).toBe(false);
    expect(attackCheck({ attacker: bob, target: g, reach: sword, tokens: [bob, g, ally], flanking: false }).adv).toBe(false);
    // diagonal flank
    expect(attackCheck({ attacker: bob, target: at('d', 'monster', 6, 6), reach: sword, tokens: [at('r', 'player', 7, 7)], flanking: true }).adv).toBe(true);
  });
  it('turns and Extra Attack', () => {
    expect(attackTurnCheck({ fightOn: false })).toEqual({ ok: true });
    expect(attackTurnCheck({ fightOn: true, myTurn: false }).ok).toBe(false);
    expect(attackTurnCheck({ fightOn: true, myTurn: true, used: 1, perAction: 1 }).ok).toBe(false);
    expect(attackTurnCheck({ fightOn: true, myTurn: true, used: 1, perAction: attacksPerAction(['Rage', 'Extra Attack']) }).ok).toBe(true);
    expect(attacksPerAction(['Extra Attack', 'Extra Attack (2)'])).toBe(3);
  });
});

import { snapWallPoint } from './dnd-hub-rules.js';
describe('snapWallPoint', () => {
  it('joins an existing end first, then the grid corner, else stays put', () => {
    expect(snapWallPoint({ x: 104, y: 97 }, [{ x: 100, y: 100 }], { gs: 50 })).toEqual({ x: 100, y: 100, snapped: 'end' });
    expect(snapWallPoint({ x: 74, y: 128 }, [{ x: 300, y: 300 }], { gs: 50 })).toEqual({ x: 50, y: 150, snapped: 'grid' });
    expect(snapWallPoint({ x: 74, y: 128 }, [], { gs: 50, ox: 10, oy: 0 })).toEqual({ x: 60, y: 150, snapped: 'grid' });
    expect(snapWallPoint({ x: 74, y: 128 }, [], null)).toEqual({ x: 74, y: 128, snapped: null });
  });
});

describe('touching: next to each other, whatever their size (the auto-target)', () => {
  const gs = 50, at = (cx, cy, n = 1) => ({ x: (cx + n / 2) * gs, y: (cy + n / 2) * gs }); // a token covering cx.. cy..
  it('medium beside medium, also diagonally; two squares off is not', () => {
    expect(touching(at(0, 0), 1, at(1, 0), 1, gs)).toBe(true);
    expect(touching(at(0, 0), 1, at(1, 1), 1, gs)).toBe(true);
    expect(touching(at(0, 0), 1, at(2, 0), 1, gs)).toBe(false);
  });
  it('a hero beside a Large (2×2) or Huge (3×3) monster touches it; one square away does not', () => {
    expect(touching(at(2, 0), 1, at(0, 0, 2), 2, gs)).toBe(true);
    expect(touching(at(3, 0), 1, at(0, 0, 2), 2, gs)).toBe(false);
    expect(touching(at(3, 1), 1, at(0, 0, 3), 3, gs)).toBe(true);  // was missed: centres 2 squares apart
    expect(touching(at(4, 1), 1, at(0, 0, 3), 3, gs)).toBe(false);
  });
});
