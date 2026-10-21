import { describe, it, expect } from 'vitest';
import { CARDS } from './ul-cards.js';
import { settled, flatRoom } from './tests/kit.js';

describe('CARDS', () => {
  it('names what killed you and how long you lasted', () => {
    const S = settled(flatRoom());
    S.player.cause = 'a Shade'; S.t = 83;
    expect(CARDS.dead(S, 'Cellars · level 2 of 3').lines[0]).toBe('Killed by a Shade on Cellars · level 2 of 3, 1:23 in.');
  });
  it('says what you carry down the stairs', () => {
    const S = settled(flatRoom());
    S.player.hp = 61.4; S.player.oil = 40; S.player.flask = 0;
    expect(CARDS.down(S, 'Lamp post').lines).toEqual(['Next: Lamp post.', 'You carry 61 body, 40 oil and an empty flask.']);
  });
  it('counts the sconces you lit when the room is cleared', () => {
    const S = settled(flatRoom());
    S.sconces = [{ lit: true }, { lit: false }];
    expect(CARDS.cleared(S).lines[1]).toMatch(/sconces lit 1 of 2$/);
  });
  it('when saving is refused, says how to change that answer (Dissent\'s "Viewing only · Change" chip)', () => {
    expect(CARDS.saving('refused')).toMatch(/^Saving is off/);
    expect(CARDS.saving('refused')).toContain('\u201cViewing only \u00b7 Change\u201d');
  });
});
