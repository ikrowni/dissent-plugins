import { describe, it, expect, vi } from 'vitest';

vi.mock('./dnd-hub-state.js?v=20261014y', () => ({ MAP: {}, serverData: null, userId: 'u', effectiveGs: () => 50 }));
vi.mock('./dnd-hub-storage.js?v=20261014y', () => ({ saveHubDm: async () => {} }));
vi.mock('./dnd-hub-publish.js', () => ({ realtimePublish: async () => {} }));
const { pictureAt, resized } = await import('./dnd-hub-pictures.js');

describe('pictureAt', () => {
  const pics = [
    { id: 'a', cx: 100, cy: 100, w: 2, ar: 1 },    // 100×100 px around (100, 100)
    { id: 'b', cx: 140, cy: 100, w: 2, ar: 0.5 },  // 100×50 px, on top of a
  ];
  it('finds the top picture under the point', () => {
    expect(pictureAt(pics, 150, 100, 50)?.id).toBe('b');
    expect(pictureAt(pics, 60, 60, 50)?.id).toBe('a');
  });
  it('respects the height a picture really has', () => {
    expect(pictureAt(pics, 180, 130, 50)).toBe(null); // b is only 25 px tall each side
  });
  it('nothing there, or no pictures, is null', () => {
    expect(pictureAt(pics, 400, 400, 50)).toBe(null);
    expect(pictureAt(undefined, 0, 0, 50)).toBe(null);
  });
});

describe('resized', () => {
  it('grows and shrinks, within reason', () => {
    expect(resized(4, 1.25)).toBe(5);
    expect(resized(4, 0.8)).toBe(3.2);
    expect(resized(0.5, 0.8)).toBe(0.5);
    expect(resized(40, 1.25)).toBe(40);
  });
});
