import { describe, it, expect } from 'vitest';
import { flight, solve, standable } from './ul-solver.js';
import { parseRoom } from './ul-room.js';
import { DEFAULT_TUNE, TS, DT } from './ul-const.js';
import { newGame, step } from './ul-game.js';
import { flatRoom, idle } from './tests/kit.js';

const T = DEFAULT_TUNE;
const spawnOf = (room) => room.spawns.find((s) => s.ch === 'P');
const startOf = (room) => { const p = spawnOf(room); return { x: p.x, y: p.y }; };
const X = (room, ch = 'X') => { const s = room.spawns.find((q) => q.ch === ch); return s && { x: s.x, y: s.y }; };

describe('flight', () => {
  it('matches the real player step for step (a held, running jump in the open)', () => {
    for (const [dir, hold] of [[1, 24], [-1, 5], [0, 60], [1, 12]]) {
      const S = newGame(flatRoom(40, 12));
      for (let i = 0; i < 60; i++) step(S, idle(), DT); // settle
      S.player.x = 20 * TS + 3; // the middle of the room, where flight starts too
      const y0 = S.player.y, real = [];
      for (let i = 0; i < 120; i++) {
        step(S, { ...idle(), dir, jump: i === 0, jumpHeld: i < hold }, DT);
        real.push([S.player.x, S.player.y]);
        if (i > 0 && S.player.onGround) break;
      }
      const trace = [];
      flight(S.room, T, { x: 20 * TS + 3, y: y0, w: 18, h: 40, vx: 0, vy: 0 }, { dir, hold, ground: true }, trace);
      expect(trace.length).toBe(real.length);
      trace.forEach(([x, y], i) => { expect(x).toBeCloseTo(real[i][0], 6); expect(y).toBeCloseTo(real[i][1], 6); });
    }
  });
});

/** A floor with a pit of `gap` tiles full of spikes; P on the left, X on the right. */
const gapRoom = (gap) => {
  const w = 10 + gap + 10, top = '#'.repeat(w), air = '#' + ' '.repeat(w - 2) + '#';
  const run = '#P' + ' '.repeat(w - 4) + 'X#';
  const floor = '#'.repeat(10) + '^'.repeat(gap) + '#'.repeat(10);
  return parseRoom([top, air, air, air, air, air, air, air, run, floor, top]);
};

describe('solve', () => {
  // With the mock's tuning a running jump carries about 140 units: 4 tiles of spikes clear, 5 land you on the last one.
  // Chunks are written to these limits (a gap of at most 4 over danger, a ledge at most 5 up).
  it('crosses a 4-tile gap of spikes with a run-up, not a 5-tile one', () => {
    for (const [gap, ok] of [[4, true], [5, false], [10, false]]) {
      const room = gapRoom(gap);
      expect(solve(room, T, startOf(room), { exit: X(room) }).exitOk, `gap ${gap}`).toBe(ok);
    }
  });
  it('climbs a ledge 5 tiles up but not 6', () => {
    const tower = (h) => {
      const rows = ['#'.repeat(20)];
      for (let i = 0; i < 12; i++) rows.push('#' + ' '.repeat(18) + '#');
      rows.push('#'.repeat(20));
      const g = rows.map((r) => [...r]);
      const top = 12 - h; // the ledge's top row
      for (let r = top + 1; r <= 12; r++) for (let c = 12; c < 19; c++) g[r][c] = '#';
      g[12][3] = 'P'; g[top][16] = 'X';
      return parseRoom(g.map((r) => r.join('')));
    };
    expect(solve(tower(5), T, startOf(tower(5)), { exit: X(tower(5)) }).exitOk).toBe(true);
    expect(solve(tower(6), T, startOf(tower(6)), { exit: X(tower(6)) }).exitOk).toBe(false);
  });
  it('drops through a thin ledge', () => {
    const room = parseRoom(['########', '#      #', '#P     #', '#------#', '#      #', '#     X#', '########']);
    expect(solve(room, T, startOf(room), { exit: X(room) }).exitOk).toBe(true);
  });
  it('finds a trap: a pit you can fall into and never climb out of', () => {
    const rows = ['#'.repeat(30)];
    for (let i = 0; i < 6; i++) rows.push('#' + ' '.repeat(28) + '#');
    rows.push('#P' + ' '.repeat(25) + 'X#');
    rows.push('#'.repeat(12) + '    ' + '#'.repeat(14)); // a hole in the floor
    for (let i = 0; i < 8; i++) rows.push('#'.repeat(12) + '    ' + '#'.repeat(14)); // a deep shaft
    rows.push('#'.repeat(30));
    const room = parseRoom(rows), res = solve(room, T, startOf(room), { exit: X(room) });
    expect(res.exitOk).toBe(true);
    expect(res.trapped.length).toBeGreaterThan(0);
  });
  it('says which sconce it cannot reach', () => {
    const room = parseRoom(['############', '#   S      #', '#          #', '#          #', '#          #', '#          #', '#          #', '#P        X#', '############']);
    const s = room.spawns.find((q) => q.ch === 'S');
    const res = solve(room, T, startOf(room), { exit: X(room), sconces: [{ x: s.x, y: s.y }] });
    expect(res.missing).toEqual([{ what: 'sconce', x: s.x, y: s.y }]);
  });
  it('reports a standing spot only where there is floor and headroom', () => {
    const room = parseRoom(['#####', '#   #', '#P  #', '##- #', '#####']);
    expect([standable(room, 1, 2), standable(room, 2, 2), standable(room, 3, 2)]).toEqual([true, true, false]);
    expect(standable(room, 1, 1)).toBe(false); // floor, but the head would be in the stone above
  });
});
