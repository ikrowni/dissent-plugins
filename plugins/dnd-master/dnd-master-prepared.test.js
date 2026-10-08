import { describe, it, expect } from 'vitest';
import { preparedToDraft, monsterSpots, tokenSize } from './dnd-master-prepared.js';

const srd = [{ id: 'goblin', name: 'Goblin' }, { id: 'hobgoblin', name: 'Hobgoblin' }];

describe('prepared encounters', () => {
  it('become builder entries from SRD monsters; unknown ids are dropped', () => {
    const d = preparedToDraft({ items: [{ id: 'hobgoblin', count: 1 }, { id: 'goblin', count: 2 }, { id: 'nope', count: 1 }] }, srd);
    expect(d.map(e => [e.monster.id, e.count])).toEqual([['hobgoblin', 1], ['goblin', 2]]);
  });
});

describe('monster tokens land where a drop would snap them (owner, 2026-10-08: "placing tokens feels wonky")', () => {
  // The Hub's own drop rule (dnd-hub-rules.js snapToGrid): odd sizes on a cell centre, even sizes on a grid corner.
  const snap = (v, off, gs, cells) => (Math.max(1, Math.round(cells)) % 2 ? Math.floor((v - off) / gs) * gs + gs / 2 + off : Math.round((v - off) / gs) * gs + off);
  const map = { bgOffsetX: 0, bgOffsetY: 0, bgScaledW: 1000, bgScaledH: 800, mapCellW: 20, gridOffsetX: 7, gridOffsetY: 3, gridSize: 40 };
  const order = [{ type: 'player' }, { type: 'monster', size: 'medium' }, { type: 'monster', size: 'large' }, { type: 'monster', size: 'huge' }, { type: 'monster' }];
  it('off the map: one column right of it, on squares of the map\'s own grid (mapCellW, offsets), stacked by size', () => {
    const pos = monsterSpots(order, map, null);
    expect(pos[0]).toBe(null);
    const gs = 50, cells = [1, 2, 3, 1];
    pos.slice(1).forEach((p, i) => {
      expect(p.x).toBe(snap(p.x, 7, gs, cells[i]));
      expect(p.y).toBe(snap(p.y, 3, gs, cells[i]));
      expect(p.x - cells[i] * gs / 2).toBeGreaterThanOrEqual(1000 + gs); // its left side a full square off the map
    });
    // No two overlap: each starts below the one before.
    for (let i = 2; i < pos.length; i++) expect(pos[i].y - cells[i - 1] * gs / 2).toBeGreaterThanOrEqual(pos[i - 1].y + cells[i - 2] * gs / 2);
  });
  it('prepared cells are the Hub\'s cells (with the grid offset): a 1×1 on the centre, a 2×2 covering the cell and the three after it', () => {
    const pos = monsterSpots([{ type: 'monster' }, { type: 'monster', size: 'large' }], map, [{ cx: 4, cy: 2 }, { cx: 6, cy: 2 }]);
    expect(pos).toEqual([{ x: 7 + 4.5 * 50, y: 3 + 2.5 * 50 }, { x: 7 + 7 * 50, y: 3 + 3 * 50 }]);
  });
  it('a stored map without its image size yet falls back to gridSize', () => {
    const [p] = monsterSpots([{ type: 'monster' }], { gridSize: 40 }, [{ cx: 1, cy: 1 }]);
    expect(p).toEqual({ x: 60, y: 60 });
  });
  it('sizes as the map draws them: "Large" from the SRD is large; unknown is medium', () => {
    expect(tokenSize('Large')).toBe('large');
    expect(tokenSize('Gargantuan')).toBe('gargantuan');
    expect(tokenSize('weird')).toBe('medium');
    expect(tokenSize(undefined)).toBe('medium');
  });
});
