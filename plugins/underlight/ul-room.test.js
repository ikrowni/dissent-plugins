import { describe, it, expect } from 'vitest';
import { parseRoom, tileAt, solid, solidPt } from './ul-room.js';
import { CELLARS_01 } from './rooms/cellars-01.js';

describe('parseRoom', () => {
  it('reads tiles and turns spawn letters into air with a spawn at the tile centre', () => {
    const room = parseRoom(['####', '#P S', '#-^#']);
    expect(room.cols).toBe(4);
    expect(room.tiles[1]).toEqual(['#', ' ', ' ', ' ']);
    expect(room.spawns).toEqual([{ ch: 'P', x: 36, y: 36 }, { ch: 'S', x: 84, y: 36 }]);
    expect(room.w).toBe(96);
    expect(room.h).toBe(72);
  });
  it('pads short rows with air', () => {
    expect(parseRoom(['####', '#P']).tiles[1]).toEqual(['#', ' ', ' ', ' ']);
  });
  it('refuses a letter it does not know, saying where', () => {
    expect(() => parseRoom(['#P#', '#x#'])).toThrow('room row 1 col 1: unknown "x"');
  });
  it('needs exactly one P', () => {
    expect(() => parseRoom(['###'])).toThrow('exactly one P, this one has 0');
    expect(() => parseRoom(['#PP#'])).toThrow('has 2');
  });
});

describe('tiles', () => {
  const room = parseRoom(['#P-^']);
  it('treats outside the room as stone', () => {
    expect(tileAt(room, -1, 0)).toBe('#');
    expect(tileAt(room, 0, 5)).toBe('#');
  });
  it('counts stone and spikes as solid, ledges and air as not', () => {
    expect([0, 1, 2, 3].map((c) => solid(room, c, 0))).toEqual([true, false, false, true]);
    expect(solidPt(room, 23.9, 1)).toBe(true);
    expect(solidPt(room, 24, 1)).toBe(false);
  });
});

describe('the first Cellars room', () => {
  it('parses: 80 x 23, one start, six sconces, eight enemies', () => {
    const room = parseRoom(CELLARS_01);
    expect([room.cols, room.rows]).toEqual([80, 23]);
    const count = (ch) => room.spawns.filter((s) => s.ch === ch).length;
    expect([count('P'), count('S'), count('h') + count('m') + count('n')]).toEqual([1, 6, 8]);
  });
});
