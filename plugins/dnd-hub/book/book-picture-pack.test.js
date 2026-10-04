// plugins/dnd-hub/book/book-picture-pack.test.js
import { describe, it, expect } from 'vitest';
import { planPictureFiles, packText, unpack, isRateLimited } from './book-picture-pack.js';

describe('storing a book’s pictures', () => {
  it('a 40-card deck is one pack; big maps a file each; a pack never passes its size', () => {
    const cards = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, size: 80_000 }));
    const maps = [{ id: 'm1', size: 4_000_000 }, { id: 'm2', size: 3_500_000 }];
    const plan = planPictureFiles([...maps, ...cards]);
    expect(plan.filter(s => s.single).map(s => s.single.id)).toEqual(['m1', 'm2']);
    expect(plan.filter(s => s.pack).map(s => s.pack.length)).toEqual([40]);
    const many = planPictureFiles(Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, size: 500_000 })));
    expect(many.every(s => s.pack.reduce((n, p) => n + p.size, 0) <= 6_000_000)).toBe(true);
    expect(many.reduce((n, s) => n + s.pack.length, 0)).toBe(100);
  });
  it('a pack gives back every picture’s bytes, and refuses a file that is not one', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    const out = unpack(packText([{ id: 'a', bytes }, { id: 'b', bytes: new Uint8Array([1, 2, 3]) }]));
    expect([...out.a]).toEqual([...bytes]);
    expect([...out.b]).toEqual([1, 2, 3]);
    expect(() => unpack('{"kind":"something-else"}')).toThrow();
  });
  it('knows a rate limit from other failures', () => {
    expect(isRateLimited(new Error('rate limit exceeded'))).toBe(true);
    expect(isRateLimited('HTTP 429')).toBe(true);
    expect(isRateLimited(new Error('You have used all your storage'))).toBe(false);
  });
});
