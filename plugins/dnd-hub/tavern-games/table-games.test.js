import { describe, it, expect } from 'vitest';
import { createTableRunner } from './table-runner.js';
import * as RD from './rune-dice-rules.js';
import { mulberry32 } from './kit.js';

/** A runner on a hand-cranked clock: `run()` fires every timer in time order until none are left. */
function harness(rules, setupExtra = {}) {
  let now = 0; const timers = []; const sent = []; const settled = [];
  const runner = createTableRunner({
    rules, setup: { cheating: true, npcSkill: 'regular', statsHelp: true, ...setupExtra }, host: { id: 'h', name: 'Marta' },
    broadcast: d => sent.push(d), settle: (id, o) => settled.push([id, o]), rng: mulberry32(4),
    setTimer: (f, ms) => { const t = { at: now + ms, f }; timers.push(t); return t; }, clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }, now: () => now,
  });
  const run = (limit = 5000) => {
    for (let i = 0; i < limit && timers.length; i++) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift(); now = t.at; t.f();
    }
  };
  return { runner, sent, settled, run, last: () => sent.filter(d => d.kind === 'state').at(-1)?.state };
}

describe('Rune Dice rules', () => {
  it('strikes the next player round the table; axes beat helms and arrows beat shields', () => {
    let s = RD.create([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, mulberry32(1));
    s.players[0].dice = [0, 0, 0, 2, 2, 5];   // 3 plain axes, 2 gold arrows, a hand
    s.players[1].dice = [3, 4, 3, 3, 3, 3];   // 5 helms, 1 shield
    s.players.forEach(p => { p.done = true; });
    s = RD.step(s);
    const a = s.clash.find(e => e.from === 'a');
    expect(a.to).toBe('b');
    expect(a.dmg).toBe(0 + 1);                // 3 axes − 5 helms = 0; 2 arrows − 1 shield = 1
    expect(s.players[0].favor).toBe(2 + 1);   // two gold faces, and the hand stole B's one (B's gold shield)
    expect(s.players[1].favor).toBe(0);
  });
  it('a boon costs favour and does what it says', () => {
    let s = RD.create([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, mulberry32(2));
    s.players[0].favor = 4; s.players[0].boon = 'fury'; s.players[0].dice = [3, 3, 3, 3, 3, 3];
    s.players[1].dice = [3, 3, 3, 3, 3, 3];
    s.players.forEach(p => { p.done = true; });
    s = RD.step(s);
    expect(s.players[1].life).toBe(RD.LIFE - 2);
    expect(s.players[0].favor).toBe(0);
  });
  it('Wisdom gives starting favour and, at +3, a fourth roll', () => {
    const s = RD.create([{ id: 'a', name: 'A', mod: 3 }, { id: 'b', name: 'B', mod: -1 }], {});
    expect(s.players[0].favor).toBe(3); expect(RD.maxRolls(s.players[0])).toBe(4);
    expect(s.players[1].favor).toBe(0); expect(RD.maxRolls(s.players[1])).toBe(3);
  });
});

describe('the table runner', () => {
  it('opens a lobby, plays a whole game with the NPCs, and settles every hero once', () => {
    const h = harness(RD);
    expect(h.runner.addSeat({ seatId: 's1', name: 'Bob', mod: 1 })).toBe(true);
    expect(h.runner.addSeat({ seatId: 's2', name: 'Cat', mod: 0 })).toBe(true);
    expect(h.sent[0].kind).toBe('lobby');
    h.run();
    expect(h.runner.phase).toBe('done');
    expect(RD.over(h.last())).toBe(true);
    expect(h.settled.map(x => x[0]).sort()).toEqual(['s1', 's2']);
    expect(h.last().players.map(p => p.id)).toEqual(['s1', 's2', 'host', 'brannoc']);
  });
  it('turns away a hero once the game is under way', () => {
    const h = harness(RD);
    h.runner.addSeat({ seatId: 's1', name: 'Bob' });
    h.runner.startNow();
    expect(h.runner.addSeat({ seatId: 's2', name: 'Cat' })).toBe(false);
  });
  it('a hero who leaves in the lobby is settled as void; mid-game they lose', () => {
    const h = harness(RD);
    h.runner.addSeat({ seatId: 's1', name: 'Bob' }); h.runner.addSeat({ seatId: 's2', name: 'Cat' });
    h.runner.leave('s2');
    expect(h.settled[0]).toEqual(['s2', { won: false, void: true }]);
    h.runner.startNow();
    h.runner.leave('s1');
    expect(h.settled[1]).toEqual(['s1', { won: false }]);
  });
  it('refuses a move out of turn, and judges a cheat once', () => {
    const h = harness(RD);
    h.runner.addSeat({ seatId: 's1', name: 'Bob', sleight: -10 });
    h.runner.startNow();
    h.runner.onMessage('s1', { kind: 'act', action: { type: 'done', keep: [], boon: null } });
    h.runner.onMessage('s1', { kind: 'act', action: { type: 'done', keep: [], boon: null } });
    expect(h.sent.some(d => d.kind === 'refused' && d.seatId === 's1')).toBe(true);
    h.runner.onMessage('s1', { kind: 'cheat' });
    h.runner.onMessage('s1', { kind: 'cheat' });
    const judged = h.sent.filter(d => d.kind === 'cheated');
    expect(judged).toHaveLength(1);
    if (judged[0].caught) expect(h.settled.find(x => x[0] === 's1')[1]).toEqual({ won: false, caught: true });
  });
  it('an idle hero is moved on after the turn limit', () => {
    const h = harness(RD);
    h.runner.addSeat({ seatId: 's1', name: 'Bob' });
    h.run();   // nobody ever acts for Bob: the auto action plays for him every round
    expect(h.runner.phase).toBe('done');
  });
});

import * as BB from './bluff-bones-rules.js';
describe('Bluff Bones rules', () => {
  const table = () => {
    const s = BB.create([{ id: 'a', name: 'A', mod: 3 }, { id: 'b', name: 'B', npc: true }, { id: 'c', name: 'C', npc: true }], {}, mulberry32(9));
    s.players[0].dice = [6, 6, 2, 3]; s.players[1].dice = [6, 1, 1, 1]; s.players[2].dice = [5, 5, 5, 5];
    return s;
  };
  it('a bid must beat the standing one', () => {
    expect(BB.beats({ count: 2, face: 3 }, null)).toBe(true);
    expect(BB.beats({ count: 2, face: 4 }, { count: 2, face: 3 })).toBe(true);
    expect(BB.beats({ count: 2, face: 2 }, { count: 2, face: 3 })).toBe(false);
    expect(BB.beats({ count: 3, face: 1 }, { count: 2, face: 6 })).toBe(true);
  });
  it('a called lie costs the bidder a die; a true bid costs the caller', () => {
    let s = BB.act(table(), 'a', { type: 'bid', count: 4, face: 6 });   // there are three 6s: a lie
    s = BB.act(s, 'b', { type: 'call' });
    expect(s.reveal).toMatchObject({ total: 3, loser: 'a' });
    s = BB.step(s);
    expect(s.players[0].dice).toHaveLength(BB.DICE - 1);
    expect(s.turn).toBe('a');                                           // the loser opens the next round
    let t = BB.act(table(), 'a', { type: 'bid', count: 3, face: 6 });   // true
    t = BB.step(BB.act(t, 'b', { type: 'call' }));
    expect(t.players[1].dice).toHaveLength(BB.DICE - 1);
  });
  it('the hero with Insight gets a read on the next bid; out of turn is refused', () => {
    const s = BB.act(BB.act(table(), 'a', { type: 'bid', count: 1, face: 2 }), 'b', { type: 'bid', count: 5, face: 5 });
    expect(s.hints.a?.text).toMatch(/gut says/);
    expect(() => BB.act(s, 'a', { type: 'call' })).toThrow();
  });
  it('a whole game run by the house ends with one winner', () => {
    const h = harness(BB);
    h.runner.addSeat({ seatId: 's1', name: 'Bob', mod: 2 });
    h.run();
    const s = h.last();
    expect(BB.over(s)).toBe(true);
    expect(s.players.filter(p => !p.out)).toHaveLength(1);
  });
});

import * as BD from './beetle-derby-rules.js';
describe('Beetle Derby rules', () => {
  it('six beetles with odds from 2 to 9; the house has no NPC punters', () => {
    const s = BD.create([{ id: 'a', name: 'A' }], {}, mulberry32(3));
    expect(s.beetles.map(b => b.odds).sort((x, y) => x - y)).toEqual([2, 3, 4, 5, 7, 9]);
    expect(BD.npcs()).toEqual([]);
  });
  it('one race for everyone; a winning pick pays its odds', () => {
    let s = BD.create([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {}, mulberry32(8));
    s = BD.act(BD.act(s, 'a', { type: 'pick', beetle: 0 }), 'b', { type: 'pick', beetle: 1 });
    expect(BD.toAct(s)).toEqual([]);
    s = BD.step(s, mulberry32(9));
    expect(s.phase).toBe('race');
    expect(s.frames.at(-1)[s.winner]).toBeGreaterThanOrEqual(1);
    const back = s.players.find(p => p.pick === s.winner);
    if (back) expect(BD.outcome(s, back.id)).toEqual({ won: true, multiplier: s.beetles[s.winner].odds });
    expect(() => BD.act(s, 'a', { type: 'pick', beetle: 2 })).toThrow();
  });
  it('favourites win more often than long shots', () => {
    const wins = { fav: 0, long: 0 };
    for (let i = 0; i < 300; i++) {
      const rng = mulberry32(100 + i);
      let s = BD.create([{ id: 'a', name: 'A' }], {}, rng);
      s = BD.step(BD.act(s, 'a', { type: 'pick', beetle: 0 }), rng);
      const odds = s.beetles[s.winner].odds;
      if (odds === 2) wins.fav++; if (odds === 9) wins.long++;
    }
    expect(wins.fav).toBeGreaterThan(wins.long);
  });
});

import * as LS from './last-standing-rules.js';
describe('Last One Standing rules', () => {
  it('the DC climbs; steadiness is worth -1 to +2', () => {
    expect(LS.dcFor(1)).toBe(10); expect(LS.dcFor(4)).toBe(16);
    expect(LS.steadyBonus(0)).toBe(-1); expect(LS.steadyBonus(1)).toBe(2);
  });
  it('if everyone fails at once, the best total stays up', () => {
    let s = LS.create([{ id: 'a', name: 'A', mod: 0 }, { id: 'b', name: 'B', mod: 0 }], { npcSkill: 'regular' });
    s.round = 8;                                   // DC 24: nobody makes it without a 20
    s = LS.act(LS.act(s, 'a', { type: 'steady', score: 1 }), 'b', { type: 'steady', score: 0 });
    s = LS.step(s, () => 0.5);                     // both roll 11
    expect(s.rolls.filter(r => r.pass)).toHaveLength(1);
    expect(s.rolls.find(r => r.pass).id).toBe('a');
  });
  it('a pour in the plant pot passes the round', () => {
    let s = LS.create([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {});
    s = LS.cheat(s, 'a');
    s = LS.step(LS.act(LS.act(s, 'a', { type: 'steady', score: 0 }), 'b', { type: 'steady', score: 1 }), () => 0);   // natural 1s
    expect(s.rolls.find(r => r.id === 'a').pass).toBe(true);
  });
  it('a whole contest run by the house ends', () => {
    const h = harness(LS);
    h.runner.addSeat({ seatId: 's1', name: 'Bob', mod: 2 });
    h.run();
    expect(LS.over(h.last())).toBe(true);
    expect(h.settled).toHaveLength(1);
  });
});
