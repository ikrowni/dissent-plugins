// scripts/sts2/pack.test.mjs
import { describe, it, expect } from 'vitest';
import { packImages, MAX_PACK_BYTES } from './pack.mjs';

const img = (id, n, fill = 1) => ({ id, group: 'cards', bytes: new Uint8Array(n).fill(fill) });

describe('packImages', () => {
  it('concatenates images and records where each one is', () => {
    const { packs, index } = packImages([img('A', 3, 1), img('B', 2, 2)], { maxBytes: 100 });
    expect(packs).toHaveLength(1);
    expect(packs[0].name).toBe('cards-00.pack');
    expect([...packs[0].bytes]).toEqual([1, 1, 1, 2, 2]);
    expect(index.A).toEqual({ pack: 'cards-00.pack', offset: 0, length: 3 });
    expect(index.B).toEqual({ pack: 'cards-00.pack', offset: 3, length: 2 });
  });

  it('starts a new pack before one would exceed the cap', () => {
    const { packs, index } = packImages([img('A', 60), img('B', 60), img('C', 30)], { maxBytes: 100 });
    expect(packs.map((p) => p.name)).toEqual(['cards-00.pack', 'cards-01.pack']);
    expect(index.B.pack).toBe('cards-01.pack');
    expect(index.C).toEqual({ pack: 'cards-01.pack', offset: 60, length: 30 });
    for (const p of packs) expect(p.bytes.length).toBeLessThanOrEqual(100);
  });

  it('keeps groups in separate packs, so a filtered view loads only its own', () => {
    const { packs } = packImages(
      [img('A', 5), { id: 'R', group: 'relics', bytes: new Uint8Array(5) }],
      { maxBytes: 100 },
    );
    expect(packs.map((p) => p.name)).toEqual(['cards-00.pack', 'relics-00.pack']);
  });

  // 🔴 One oversized image would otherwise become an oversized pack the node refuses.
  it('🔴 refuses a single image larger than the cap, naming it', () => {
    expect(() => packImages([img('HUGE', 101)], { maxBytes: 100 })).toThrow(/HUGE/);
  });

  // 🔴 Found 2026-09-13: a conversion that failed left an empty cached file, which packed as a
  // zero-length entry. Reading it returned the NEXT image's bytes — a valid-looking header.
  it('🔴 refuses an empty image, naming it', () => {
    expect(() => packImages([img('A', 3), img('EMPTY', 0)], { maxBytes: 100 })).toThrow(/EMPTY/);
  });

  it('refuses a duplicate id', () => {
    expect(() => packImages([img('A', 1), img('A', 1)], { maxBytes: 100 })).toThrow(/duplicate.*A/i);
  });

  it('defaults the cap below the node limit of 2 MB', () => {
    expect(MAX_PACK_BYTES).toBeLessThan(2 * 1024 * 1024);
  });
});
