import { describe, it, expect } from 'vitest';
import { scoreAt, swayAmp, powerAt, heroLanding, hostLanding, winner, SWEET } from './dagger-toss-rules.js';
import { mulberry32 } from './kit.js';

describe('Dagger Toss', () => {
  it('scores the rings from the heart out, and nothing off the board', () => {
    expect(scoreAt(0, 0).pts).toBe(50);
    expect(scoreAt(0.1, 0).pts).toBe(25);
    expect(scoreAt(0, 0.3).pts).toBe(10);
    expect(scoreAt(0.5, 0).pts).toBe(5);
    expect(scoreAt(0.9, 0).pts).toBe(2);
    expect(scoreAt(0.8, 0.8)).toEqual({ pts: 0, name: 'Miss' });
  });
  it('steadies the hand with Dexterity', () => {
    expect(swayAmp(1)).toBeLessThan(swayAmp(0));
    expect(swayAmp(-1)).toBeGreaterThan(swayAmp(0));
  });
  it('swings the power meter between 0 and 1', () => {
    expect(powerAt(0)).toBe(0);
    expect(powerAt(0.8)).toBeCloseTo(1);
    expect(powerAt(1.6)).toBeCloseTo(0);
  });
  it('flies true at the sweet spot, drops low when weak and flies high when strong', () => {
    const r = () => 0.5;
    expect(heroLanding({ x: 0, y: 0 }, { x: 0, y: 0 }, SWEET, r)).toEqual({ x: 0, y: 0 });
    expect(heroLanding({ x: 0, y: 0 }, { x: 0, y: 0 }, 0.2, r).y).toBeGreaterThan(0.4);
    expect(heroLanding({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, r).y).toBeLessThan(-0.2);
  });
  it('a shark throws closer than a novice, and a loosened board throws them off', () => {
    const avg = (skill, loose) => {
      const rng = mulberry32(7); let t = 0;
      for (let i = 0; i < 400; i++) { const p = hostLanding(skill, rng, loose); t += Math.hypot(p.x, p.y); }
      return t / 400;
    };
    expect(avg('shark')).toBeLessThan(avg('regular'));
    expect(avg('regular')).toBeLessThan(avg('novice'));
    expect(avg('regular', true)).toBeGreaterThan(avg('regular'));
  });
  it('the higher total wins', () => {
    expect(winner([10, 25, 5], [10, 10, 10])).toBe('hero');
    expect(winner([10], [10])).toBe('draw');
  });
});
