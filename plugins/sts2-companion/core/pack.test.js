import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPackReader } from './pack.js';

const ART = new URL('../art/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', ART)));

const serveArt = () => vi.fn(async (url) => {
  const name = String(url).split('/').pop();
  const buf = readFileSync(new URL(name, ART));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
});

describe('the pack reader, over the REAL generated packs', () => {
  // 🔴 Every entry must slice to a WebP. A wrong offset shows as a broken image, not an error.
  it('🔴 every index entry slices to a WebP file', async () => {
    const fetchFn = serveArt();
    const reader = createPackReader({ index, base: 'art/', fetchFn, makeUrl: (b) => b });
    for (const id of Object.keys(index)) {
      const blob = await reader.blob(id);
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      expect(String.fromCharCode(...head.slice(0, 4)), id).toBe('RIFF');
      expect(String.fromCharCode(...head.slice(8, 12)), id).toBe('WEBP');
    }
  }, 60_000);

  it('fetches each pack once, however many images it holds', async () => {
    const fetchFn = serveArt();
    const reader = createPackReader({ index, base: 'art/', fetchFn, makeUrl: () => 'blob:x' });
    const sameGroup = Object.entries(index).filter(([, e]) => e.pack === 'cards-00.pack').slice(0, 5).map(([id]) => id);
    await Promise.all(sameGroup.map((id) => reader.url(id)));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('answers null for an id with no art', async () => {
    const reader = createPackReader({ index, base: 'art/', fetchFn: serveArt(), makeUrl: () => 'blob:x' });
    expect(await reader.url('card:NOT_A_CARD')).toBeNull();
  });

  it('revokes every URL it made', async () => {
    const revoke = vi.fn();
    let n = 0;
    const reader = createPackReader({ index, base: 'art/', fetchFn: serveArt(), makeUrl: () => `blob:${++n}`, revokeUrl: revoke });
    const [a, b] = Object.keys(index);
    await reader.url(a); await reader.url(b);
    reader.releaseAll();
    expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:1', 'blob:2']);
  });
});
