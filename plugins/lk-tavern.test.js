import { describe, it, expect } from 'vitest';
import { GAME_TYPES, gameType, cleanSetup, cleanTavern, stakeProblem, settle, hostPerception, cheatCheck,
  statEdge, MAX_PAYOUT, SETUP_DEFAULTS, MAX_TAVERN_NPCS, npcHost, talkingNpcs, migrateTaverns, npcToken, npcTokenId,
  npcSpots, withinTalkRange, TALK_RANGE } from './lk-tavern.js';

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

describe('taverns', () => {
  it('is a map, a sound and up to twelve NPCs (no tables)', () => {
    const t = cleanTavern({ name: 'The Gilded Newt', mapId: 'm1', hosts: [{ id: 'h' }], videoFileId: 'v',
      npcIds: [...Array.from({ length: 15 }, (_, i) => 'a' + i), 'a0', ''] });
    expect(t).toEqual({ id: '', name: 'The Gilded Newt', mapId: 'm1', soundFileId: null, ambientVolume: 0.5,
      npcIds: Array.from({ length: MAX_TAVERN_NPCS }, (_, i) => 'a' + i) });
  });
  it('has no map until the DM picks one', () => expect(cleanTavern({}).mapId).toBeNull());
});

describe('talking NPCs', () => {
  const camp = {
    gameSetups: { s1: { id: 's1', type: 'bones-grid' }, s2: { id: 's2', type: 'twenty' } },
    customActors: {
      a: { id: 'a', type: 'npc', name: 'Marta', setupId: 's1', greeting: 'Bones?', portraitFileId: 'f1', wis: 14 },
      b: { id: 'b', type: 'npc', name: 'Quiet Tom' },                       // says nothing, plays nothing
      c: { id: 'c', type: 'monster', name: 'Ogre', setupId: 's2' },          // monsters don't talk
      d: { id: 'd', type: 'npc', name: 'Greeter', greeting: 'Welcome!' },     // talks, no game
    },
  };
  it('turns an NPC into the host the talk box and the house use', () => {
    expect(npcHost(camp.customActors.a)).toEqual({ id: 'a', actorId: 'a', name: 'Marta', greeting: 'Bones?',
      portraitFileId: 'f1', setupId: 's1', wis: 14 });
    expect(npcHost({ id: 'x', type: 'npc' }).name).toBe('Stranger');
  });
  it('lists NPCs with a game or a greeting, and only the setups they use', () => {
    const { npcs, setups } = talkingNpcs(camp);
    expect(Object.keys(npcs).sort()).toEqual(['a', 'd']);
    expect(Object.keys(setups)).toEqual(['s1']);
  });
  it('copes with no campaign', () => expect(talkingNpcs(null)).toEqual({ npcs: {}, setups: {} }));
});

describe('moving old taverns over', () => {
  let n = 0;
  const newId = () => 'new' + (++n);
  const camp = () => ({
    gameSetups: { s1: { id: 's1', type: 'bones-grid' } },
    customActors: { a: { id: 'a', type: 'npc', name: 'Marta', hp: 9 }, f: { id: 'f', type: 'npc', name: 'Bookie Fen' } },
    taverns: { t: { id: 't', name: 'Newt', soundFileId: 's', videoFileId: 'v', videoMime: 'video/mp4', hosts: [
      { id: 'h1', actorId: 'a', name: 'Marta', setupId: 's1', greeting: 'Bones?', portraitFileId: 'p1' },
      { id: 'h2', name: 'Old Hrolf', setupId: 'gone', greeting: 'Dice?' },
      { id: 'h3', name: 'Bookie Fen', setupId: 's1' },
    ] } },
  });
  it('makes every host an NPC with their game, words and portrait', () => {
    n = 0;
    const out = migrateTaverns(camp(), newId);
    expect(out.customActors.a).toMatchObject({ name: 'Marta', hp: 9, setupId: 's1', greeting: 'Bones?', portraitFileId: 'p1' });
    expect(out.customActors.new1).toMatchObject({ id: 'new1', type: 'npc', name: 'Old Hrolf', setupId: '', greeting: 'Dice?' });
    expect(out.customActors.f.setupId).toBe('s1');           // a host with no actorId but an NPC of that name: reused
    expect(Object.keys(out.customActors)).toHaveLength(3);
    expect(out.taverns.t).toEqual({ id: 't', name: 'Newt', mapId: null, soundFileId: 's', ambientVolume: 0.5, npcIds: ['a', 'new1', 'f'] });
  });
  it('leaves a campaign with nothing to move alone (null)', () => {
    const once = { ...camp(), ...migrateTaverns(camp(), newId) };
    expect(migrateTaverns(once, newId)).toBeNull();
    expect(migrateTaverns({}, newId)).toBeNull();
  });
});

describe('NPC tokens', () => {
  const map = { bgScaledW: 1000, bgScaledH: 800, mapCellW: 20, tokens: {} }; // 50 px squares
  it('one token per NPC per map', () => {
    const t = npcToken({ id: 'a', name: 'Marta', hp: 9, ac: 11, size: 'large', portraitFileId: 'p' }, { x: 5, y: 6 });
    expect(t).toMatchObject({ id: npcTokenId('a'), type: 'npc', npcActorId: 'a', name: 'Marta', x: 5, y: 6, hp: 9, hpMax: 9,
      ac: 11, size: 'large', portraitFileId: 'p', visible: true, conditions: [] });
  });
  it('lines NPCs up through the middle of the map, a square apart', () => {
    expect(npcSpots(map, 3)).toEqual([{ x: 525, y: 425 }, { x: 625, y: 425 }, { x: 425, y: 425 }]);
  });
  it('skips a square a token stands on', () => {
    expect(npcSpots({ ...map, tokens: { p: { x: 530, y: 420 } } }, 1)).toEqual([{ x: 625, y: 425 }]);
  });
  it('works on a map that was never drawn (no size yet)', () => {
    expect(npcSpots({ gridSize: 40, tokens: {} }, 1)).toEqual([{ x: 420, y: 340 }]);
  });
});

describe('talk range', () => {
  const gs = 50, hero = { x: 0, y: 0 };
  it(`is ${TALK_RANGE} squares, diagonals counting as one`, () => {
    expect(withinTalkRange(hero, { x: 150, y: 0 }, gs)).toBe(true);
    expect(withinTalkRange(hero, { x: 145, y: 145 }, gs)).toBe(true);
    expect(withinTalkRange(hero, { x: 155, y: 0 }, gs)).toBe(false);
  });
  it('measures from the edge of a big token', () => {
    expect(withinTalkRange(hero, { x: 175, y: 0, size: 'large' }, gs)).toBe(true);
    expect(withinTalkRange(hero, { x: 180, y: 0, size: 'large' }, gs)).toBe(false);
  });
  it('needs both tokens', () => expect(withinTalkRange(null, { x: 0, y: 0 }, gs)).toBe(false));
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
