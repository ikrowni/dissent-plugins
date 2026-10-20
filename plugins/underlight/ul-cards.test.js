import { describe, it, expect } from 'vitest';
import { CARDS } from './ul-cards.js';
import { settled, flatRoom } from './tests/kit.js';

describe('CARDS', () => {
  it('names what killed you and how long you lasted', () => {
    const S = settled(flatRoom());
    S.player.cause = 'a Shade'; S.t = 83;
    expect(CARDS.dead(S).lines[0]).toBe('Killed by a Shade after 1:23, with 0 still in the room.');
  });
  it('counts the sconces you lit when the room is cleared', () => {
    const S = settled(flatRoom());
    S.sconces = [{ lit: true }, { lit: false }];
    expect(CARDS.cleared(S).lines[1]).toMatch(/sconces lit 1 of 2$/);
  });
});
