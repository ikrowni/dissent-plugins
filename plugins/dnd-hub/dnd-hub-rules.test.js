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
