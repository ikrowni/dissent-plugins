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
import { campaignRecord, waitingSpot, newWaitingToken } from './dnd-hub-rules.js';
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
  it('wait left of the map, one row per party member', () => {
    expect(waitingSpot(0, 50)).toEqual({ x: -75, y: 25 });
    expect(waitingSpot(2, 50)).toEqual({ x: -75, y: 125 });
    expect(waitingSpot(-1, 50)).toEqual({ x: -75, y: 25 }); // not a member (yet): the first row
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
