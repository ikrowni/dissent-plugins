import { describe, it, expect } from 'vitest';
import { statusLine, clock } from './ul-hud.js';
import { settled, flatRoom } from './tests/kit.js';

describe('statusLine', () => {
  it('says nothing when all is well', () => { expect(statusLine(settled(flatRoom()))).toBe(null); });
  it('puts the Dark first, then a snuffed lantern, then a thrown one', () => {
    const S = settled(flatRoom());
    S.lantern.state = 'rest';
    expect(statusLine(S).text).toMatch(/E calls it back/);
    S.player.snuffT = 2.04;
    expect(statusLine(S)).toEqual({ text: 'Lantern snuffed · 2.0 s', tone: 'violet' });
    S.player.oil = 0;
    expect(statusLine(S).tone).toBe('warn');
  });
});

describe('clock', () => {
  it('reads minutes and seconds', () => { expect([clock(0), clock(61.9), clock(600)]).toEqual(['0:00', '1:01', '10:00']); });
});
