// plugins/dnd-hub/dnd-hub-frame.test.js
import { describe, it, expect } from 'vitest';
import { fitView, legacyFrame, migrateMapToImageFrame, defaultGridSize } from './dnd-hub-frame.js';

describe('fitView', () => {
  it('fits a wide map into a tall view, centred', () => {
    const v = fitView(1000, 800, 2000, 1000);   // view W,H ; image W,H
    expect(v.zoom).toBe(0.5);
    expect(v.panX).toBe(0);
    expect(v.panY).toBe(150);                   // (800 - 1000*0.5)/2
  });
});

describe('legacyFrame', () => {
  it('reproduces the old letterbox fit', () => {
    expect(legacyFrame(1000, 800, 2000, 1000)).toEqual({ ox: 0, oy: 150, scale: 0.5 });
  });
});

describe('migrateMapToImageFrame', () => {
  const frame = { ox: 10, oy: 20, scale: 0.5 };
  it('converts every saved position to image pixels and marks the map', () => {
    const md = {
      gridSize: 20, gridOffsetX: 4, gridOffsetY: 6,
      tokens: { t: { x: 60, y: 120 } },
      pins: [{ id: 'p', cx: 110, cy: 70 }],
      lights: [{ id: 'l', x: 30, y: 40 }],
      audioZones: [{ id: 'z', x: 50, y: 60, radius: 3 }],
      walls: [{ id: 'w', x1: 10, y1: 20, x2: 110, y2: 20 }],
      doors: { d: { id: 'd', x1: 10, y1: 20, x2: 10, y2: 70, state: 'closed' } },
      triggers: [{ id: 'tr', cx: 2, cy: 3 }],
    };
    const out = migrateMapToImageFrame(md, frame);
    expect(out.coordFrame).toBe('image');
    expect(out.tokens.t).toEqual({ x: 100, y: 200 });
    expect(out.pins[0]).toMatchObject({ cx: 200, cy: 100 });
    expect(out.lights[0]).toMatchObject({ x: 40, y: 40 });
    expect(out.audioZones[0]).toMatchObject({ x: 80, y: 80, radius: 3 });   // radius is in cells
    expect(out.walls[0]).toMatchObject({ x1: 0, y1: 0, x2: 200, y2: 0 });
    expect(out.doors.d).toMatchObject({ x1: 0, y1: 0, x2: 0, y2: 100 });
    expect(out.gridSize).toBe(40);
    expect(out.gridOffsetX).toBe(8);
    expect(out.triggers[0]).toEqual({ id: 'tr', cx: 2, cy: 3 });          // cell space: untouched
  });
  it('leaves cell-format walls alone and gridSize alone when the map has mapCellW', () => {
    const md = { wallFmt: 'cell', mapCellW: 30, gridSize: 40, walls: [{ cx1: 1, cy1: 1, cx2: 2, cy2: 1 }] };
    const out = migrateMapToImageFrame(md, frame);
    expect(out.walls[0]).toEqual({ cx1: 1, cy1: 1, cx2: 2, cy2: 1 });
    expect(out.gridSize).toBe(40);
  });
  it('is idempotent', () => {
    const once = migrateMapToImageFrame({ tokens: { t: { x: 60, y: 120 } } }, frame);
    expect(migrateMapToImageFrame(once, frame)).toEqual(once);
  });
});

describe('defaultGridSize', () => {
  it('gives roughly 25 cells across the long edge, never below 20', () => {
    expect(defaultGridSize(2500, 1000)).toBe(100);
    expect(defaultGridSize(300, 200)).toBe(20);
  });
});
