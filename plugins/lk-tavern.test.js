import { describe, it, expect } from 'vitest';
import { GAME_TYPES, gameType, cleanSetup, cleanHost, cleanTavern, stakeProblem, settle, hostPerception, cheatCheck,
  statEdge, MAX_PAYOUT, SETUP_DEFAULTS } from './lk-tavern.js';

describe('the game list', () => {
  it('has ten games with unique ids, a rules text and a stat each', () => {
    expect(GAME_TYPES).toHaveLength(10);
    expect(new Set(GAME_TYPES.map(g => g.id)).size).toBe(10);
    for (const g of GAME_TYPES) {
      expect(['npc', 'table']).toContain(g.mode);
      expect(['str', 'dex', 'con', 'int', 'wis', 'cha']).toContain(g.stat);
      expect(g.howTo.length).toBeGreaterThan(20);
    }
  });
  it('plays Rune Dice, Beetle Derby and Last One Standing at the table (owner, 2026-10-05)', () => {
    for (const id of ['rune-dice', 'beetle-derby', 'last-standing']) expect(gameType(id).mode).toBe('table');
    expect(gameType('dagger-toss').mode).toBe('npc');
  });
});

describe('cleanSetup', () => {
  it('fills the defaults', () => {
    const s = cleanSetup({ id: 'a', type: 'dagger-toss' });
    expect(s).toMatchObject({ ...SETUP_DEFAULTS, id: 'a', type: 'dagger-toss', name: 'Dagger Toss' });
  });
  it('keeps settings in range', () => {
    const s = cleanSetup({ type: 'nope', minBet: 50, maxBet: 10, payout: 999, npcSkill: 'god', caught: 'death', entryFee: -3 });
    expect(s.type).toBe(GAME_TYPES[0].id);
    expect(s.maxBet).toBe(50);              // never below the least bet
    expect(s.payout).toBe(MAX_PAYOUT);
    expect(s.npcSkill).toBe('regular');
    expect(s.caught).toBe('forfeit');
    expect(s.entryFee).toBe(0);
  });
  it('keeps switches that are off', () => {
    const s = cleanSetup({ statsHelp: false, cheating: false });
    expect(s.statsHelp).toBe(false);
    expect(s.cheating).toBe(false);
  });
});

describe('taverns and hosts', () => {
  it('caps a tavern at eight tables and names a nameless host', () => {
    const t = cleanTavern({ name: 'The Gilded Newt', hosts: Array.from({ length: 12 }, (_, i) => ({ id: 'h' + i })) });
    expect(t.hosts).toHaveLength(8);
    expect(cleanHost({}).name).toBe('The dealer');
    expect(t.ambientVolume).toBe(0.5);
  });
});

describe('stakes', () => {
  const setup = { minBet: 5, maxBet: 20, entryFee: 2 };
  it('says why a stake cannot be played', () => {
    expect(stakeProblem(setup, 4, 100)).toMatch(/least/);
    expect(stakeProblem(setup, 21, 100)).toMatch(/up to 20/);
    expect(stakeProblem(setup, 10, 11)).toMatch(/need 12 gp/);
    expect(stakeProblem(setup, 2.5, 100)).toMatch(/least/);
  });
  it('lets a good stake through', () => expect(stakeProblem(setup, 10, 12)).toBeNull());
});

describe('settle', () => {
  const setup = { payout: 3, prizeItemId: 'ring' };
  it('pays a win at the setup\'s payout, with the prize', () => expect(settle(setup, { stake: 10, won: true })).toEqual({ gold: 30, itemId: 'ring' }));
  it('pays nothing on a loss', () => expect(settle(setup, { stake: 10, won: false })).toEqual({ gold: 0, itemId: null }));
  it('hands the stake back on a draw', () => expect(settle(setup, { stake: 10, won: 'draw' }).gold).toBe(10));
  it('lets a game ask for its own odds, never above the cap', () => {
    expect(settle(setup, { stake: 10, won: true, multiplier: 6 }).gold).toBe(60);
    expect(settle(setup, { stake: 10, won: true, multiplier: 500 }).gold).toBe(10 * MAX_PAYOUT);
  });
  it('pays a caught cheat nothing, even when they won', () => expect(settle(setup, { stake: 10, won: true, caught: true }).gold).toBe(0));
});

describe('cheating', () => {
  it('reads the host\'s perception from their NPC and their skill', () => {
    expect(hostPerception({ npcSkill: 'novice' }, null)).toBe(10);
    expect(hostPerception({ npcSkill: 'shark' }, { wis: 14 })).toBe(17);
  });
  it('catches a cheat at or under the host\'s perception; a 20 always works, a 1 never does', () => {
    expect(cheatCheck(10, 3, 13).caught).toBe(true);
    expect(cheatCheck(11, 3, 13).caught).toBe(false);
    expect(cheatCheck(20, -5, 30).caught).toBe(false);
    expect(cheatCheck(1, 30, 5).caught).toBe(true);
  });
});

describe('statEdge', () => {
  it('scales a modifier to -1..1, and is 0 with stats off', () => {
    expect(statEdge({}, 5)).toBe(1);
    expect(statEdge({}, 2)).toBeCloseTo(0.4);
    expect(statEdge({}, -9)).toBe(-1);
    expect(statEdge({ statsHelp: false }, 5)).toBe(0);
  });
});
