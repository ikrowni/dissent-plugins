// plugins/dnd-hub/book/book-library.test.js
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../plugin-sdk.js', () => ({ request: vi.fn(), requestWithTransfer: vi.fn() }));
vi.mock('../lk-upload.js', () => ({ guarded: f => f, uploadFile: f => f() }));
const sdk = await import('../../plugin-sdk.js');
const { entryFromFile, newestPerBook, campaignBooks, resaveBook } = await import('./book-library.js');

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

const row = (id, bookId, at) => ({ id, filename: `LanternKeep book - Bell (${bookId}).json`, size_bytes: 1, created_at: at });
const bytes = obj => ({ buffer: new TextEncoder().encode(JSON.stringify(obj)).buffer });

describe('newestPerBook', () => {
  it('two files of one book (a re-save whose old file would not delete): the newest is the book', () => {
    const e = [entryFromFile(row('old', 'bk1', '2026-10-01T00:00:00Z'), 'server'), entryFromFile(row('new', 'bk1', '2026-10-06T00:00:00Z'), 'server'),
      entryFromFile(row('x', 'bk2', '2026-10-02T00:00:00Z'), 'server')];
    expect(newestPerBook(e).map(b => b.fileId).sort()).toEqual(['new', 'x']);
  });
});

// The node cannot overwrite a file: a book saved again is a new file, and campaigns elsewhere (a personal book is used
// on every server) still hold the old id until they look it up by the book's own id.
describe('campaignBooks after a re-save', () => {
  it('a campaign whose book file is gone finds the book by its id and holds the new file from then on', async () => {
    sdk.request.mockReset();
    sdk.request.mockImplementation(async (action, p) => {
      if (action === 'files:loadArrayBuffer' && p.fileId === 'new') return bytes({ id: 'bk1', title: 'Bell' });
      if (action === 'files:loadArrayBuffer') throw new Error('not found');
      if (action === 'files:list') return p.place === 'personal' ? [row('new', 'bk1', '2026-10-06T00:00:00Z')] : [];
    });
    const camp = { bookFiles: { bk1: 'gone' } };
    const books = await campaignBooks(camp);
    expect(books.map(b => b.id)).toEqual(['bk1']);
    expect(camp.bookFiles).toEqual({ bk1: 'new' });
  });
  it('a book deleted from the library is left out', async () => {
    sdk.request.mockReset();
    sdk.request.mockImplementation(async action => { if (action === 'files:list') return []; throw new Error('not found'); });
    expect(await campaignBooks({ bookFiles: { bk9: 'gone-for-good' } })).toEqual([]);
  });
});

describe('resaveBook', () => {
  it('saves the new file where the old one was, then deletes the old one (the book file only)', async () => {
    sdk.request.mockReset(); sdk.requestWithTransfer.mockReset();
    const calls = [];
    sdk.request.mockImplementation(async (action, p) => {
      calls.push(`${action}:${p.fileId || p.place || ''}`);
      if (action === 'files:list') return p.place === 'personal' ? [] : [row('old', 'bk2', '2026-10-01T00:00:00Z')];
      return {};
    });
    sdk.requestWithTransfer.mockImplementation(async (action, p) => { calls.push(`upload:${p.private ? 'server' : p.place}`); return { id: 'new2' }; });
    const id = await resaveBook('old', { id: 'bk2', title: 'Bell', images: [{ fileId: 'pic' }] });
    expect(id).toBe('new2');
    expect(calls.filter(c => !c.startsWith('files:list'))).toEqual(['upload:server', 'files:delete:old']);
  });
});
