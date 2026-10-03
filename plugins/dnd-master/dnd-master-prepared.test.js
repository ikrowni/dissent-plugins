import { describe, it, expect } from 'vitest';
import { preparedToDraft, spawnPositions } from './dnd-master-prepared.js';

const srd = [{ id: 'goblin', name: 'Goblin' }, { id: 'hobgoblin', name: 'Hobgoblin' }];

describe('prepared encounters', () => {
  it('become builder entries from SRD monsters; unknown ids are dropped', () => {
    const d = preparedToDraft({ items: [{ id: 'hobgoblin', count: 1 }, { id: 'goblin', count: 2 }, { id: 'nope', count: 1 }] }, srd);
    expect(d.map(e => [e.monster.id, e.count])).toEqual([['hobgoblin', 1], ['goblin', 2]]);
  });
  it('monsters stand on their cells in launch order, then fall back to the old column', () => {
    const order = [{ type: 'player' }, { type: 'monster' }, { type: 'monster' }, { type: 'monster' }];
    const pos = spawnPositions(order, [{ cx: 10, cy: 5 }, { cx: 9, cy: 6 }], 50, { x: 999, y: 0 });
    expect(pos).toEqual([null, { x: 525, y: 275 }, { x: 475, y: 325 }, { x: 999, y: 0 }]);
  });
});
