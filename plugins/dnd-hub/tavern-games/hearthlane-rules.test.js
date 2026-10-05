import { describe, it, expect } from 'vitest';
import { newGame, play, lanePower, legalLanes, score, over, hostMove, handSize, PLAYS } from './hearthlane-rules.js';
import { mulberry32 } from './kit.js';

const board = (hero, host, extra = {}) => ({
  hero: { deck: [], hand: [], lanes: hero, storms: [false, false, false] }, host: { deck: [], hand: [], lanes: host, storms: [false, false, false] },
  turn: 'hero', plays: { hero: 0, host: 0 }, ...extra,
});

describe('Hearthlane', () => {
  it('a bard lifts its lane-mates, a storm flattens a lane', () => {
    const s = board([['knight', 'bard', 'peasant'], [], []], [[], [], []]);
    expect(lanePower(s, 'hero', 0)).toBe(5 + 1 + 1 + 2); // +1 to the knight and the peasant
    s.host.storms[0] = true;
    expect(lanePower(s, 'hero', 0)).toBe(3 + 2);
  });
  it('a rogue kills the weakest foe in its lane', () => {
    const s = board([[], [], []], [['knight', 'peasant'], [], []]);
    s.hero.hand = ['rogue'];
    const after = play(s, 'hero', 0, 0);
    expect(after.host.lanes[0]).toEqual(['knight']);
    expect(after.turn).toBe('host');
  });
  it('a full lane takes no more units, but a storm still lands', () => {
    const s = board([['peasant', 'peasant', 'peasant'], [], []], [[], [], []]);
    s.hero.hand = ['archer', 'storm'];
    expect(legalLanes(s, 'hero', 0)).toEqual([1, 2]);
    expect(legalLanes(s, 'hero', 1)).toEqual([0, 1, 2]);
    expect(() => play(s, 'hero', 0, 0)).toThrow();
  });
  it('two lanes win; otherwise total power decides', () => {
    expect(score(board([['knight'], ['knight'], []], [[], [], ['ogre']])).winner).toBe('hero');
    expect(score(board([['knight'], [], []], [[], ['peasant'], []])).winner).toBe('hero');
    expect(score(board([['archer'], [], []], [[], ['archer'], []])).winner).toBe('draw');
  });
  it('a whole game ends after five plays each, every host move legal', () => {
    for (const skill of ['novice', 'regular', 'shark']) {
      const rng = mulberry32(11);
      let s = newGame(rng, handSize(0));
      while (!over(s)) {
        if (s.turn === 'hero') { const i = 0; s = play(s, 'hero', i, legalLanes(s, 'hero', i)[0]); }
        else { const m = hostMove(s, skill, rng); s = play(s, 'host', m.i, m.lane); }
      }
      expect(s.plays).toEqual({ hero: PLAYS, host: PLAYS });
      expect(['hero', 'host', 'draw']).toContain(score(s).winner);
    }
  });
});
