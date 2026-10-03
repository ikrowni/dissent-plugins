import { describe, it, expect } from 'vitest';
import { PACK_FORMAT_VERSION, validatePack, compileMap } from './lk-content-pack.js';

const map = {
  id: 'm', name: 'Test', cols: 10, rows: 6, gridSize: 50,
  rooms: [{ id: 'a', name: 'A', x: 1, y: 1, w: 3, h: 3 }, { id: 'b', name: 'B', x: 4, y: 1, w: 3, h: 3 }],
  doors: [{ id: 'd1', x1: 4, y1: 2, x2: 4, y2: 3, state: 'closed' }],
  openings: [{ x1: 1, y1: 2, x2: 1, y2: 3 }],
  lights: [{ cx: 2, cy: 2, feet: 20, color: 0xffcc66 }],
  traps: [{ cx: 5, cy: 2, label: 'Stones', damage: '2d6', saveAbility: 'dex', saveDC: 12, spotDC: 13 }],
  startCell: { cx: 1, cy: 2 },
};
const pack = { formatVersion: PACK_FORMAT_VERSION, meta: { name: 'T' }, maps: [map], story: [], encounters: [], items: [] };

describe('compileMap', () => {
  const c = compileMap(map);
  it('image size and grid', () => {
    expect([c.width, c.height, c.gridSize]).toEqual([500, 300, 50]);
    expect(c.coordFrame).toBe('image');
  });
  it('a shared edge is one wall, the door gap and the opening are not walls', () => {
    const has = (x1, y1, x2, y2) => c.walls.some(w => w.x1 === x1 * 50 && w.y1 === y1 * 50 && w.x2 === x2 * 50 && w.y2 === y2 * 50);
    // left wall of A is split by the opening at y 2..3
    expect(has(1, 1, 1, 2)).toBe(true);
    expect(has(1, 3, 1, 4)).toBe(true);
    expect(c.walls.some(w => w.x1 === 50 && w.x2 === 50 && w.y1 <= 100 && w.y2 >= 150)).toBe(false);
    // shared edge x=4 has the door gap 2..3
    expect(c.walls.some(w => w.x1 === 200 && w.x2 === 200 && w.y1 <= 100 && w.y2 >= 150)).toBe(false);
    expect(Object.values(c.doors)[0]).toMatchObject({ x1: 200, y1: 100, x2: 200, y2: 150, state: 'closed' });
  });
  it('collinear pieces are merged', () => {
    // top edge y=1 from x=1 to x=7 is one wall
    expect(c.walls.some(w => w.y1 === 50 && w.y2 === 50 && w.x1 === 50 && w.x2 === 350)).toBe(true);
  });
  it('lights in pixels, traps as triggers, start cell kept', () => {
    expect(c.lights[0]).toMatchObject({ x: 125, y: 125, radius: 200 });
    expect(c.triggers[0]).toMatchObject({ cx: 5, cy: 2, type: 'trap', damageExpr: '2d6', saveAbility: 'dex', saveDC: 12, spotDC: 13, oneShot: true, requireConfirm: false });
    expect(c.startCell).toEqual({ cx: 1, cy: 2 });
  });
});

describe('validatePack', () => {
  it('a sound pack has no problems', () => expect(validatePack(pack)).toEqual([]));
  it('a door that is on no room edge is reported', () => {
    const bad = { ...pack, maps: [{ ...map, doors: [{ id: 'x', x1: 9, y1: 5, x2: 9, y2: 6, state: 'closed' }] }] };
    expect(validatePack(bad).join(' ')).toMatch(/door x/);
  });
  it('a room nobody can reach is reported', () => {
    const lonely = { ...map, rooms: [...map.rooms, { id: 'c', name: 'C', x: 8, y: 4, w: 1, h: 1 }] };
    expect(validatePack({ ...pack, maps: [lonely] }).join(' ')).toMatch(/room c .*cannot be reached/);
  });
  it('wrong format version is reported', () => {
    expect(validatePack({ ...pack, formatVersion: 99 }).join(' ')).toMatch(/formatVersion/);
  });
});
