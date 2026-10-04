// plugins/dnd-hub/book/book-library.test.js
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../plugin-sdk.js', () => ({ request: vi.fn(), requestWithTransfer: vi.fn() }));
const { entryFromFile } = await import('./book-library.js');

describe('entryFromFile', () => {
  it('reads a files:list row in the node\'s own shape (filename, size_bytes)', () => {
    const row = { id: 'f1', filename: 'LanternKeep book - The Drowned Bell (bk1).json', mime_type: 'text/plain', size_bytes: 2048, created_at: '2026-10-04T03:45:21Z' };
    expect(entryFromFile(row, 'server')).toEqual({ fileId: 'f1', id: 'bk1', title: 'The Drowned Bell', size: 2048, createdAt: '2026-10-04T03:45:21Z', place: 'server' });
  });
  it('a file that is not a book is not listed', () => {
    expect(entryFromFile({ id: 'f2', filename: 'map.png', size_bytes: 9 }, 'server')).toBeNull();
    expect(entryFromFile(null, 'server')).toBeNull();
  });
});
