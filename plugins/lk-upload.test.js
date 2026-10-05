import { describe, it, expect, vi } from 'vitest';
import { uploadFile, storageAdvice, guarded, shrinkPicture, SHRINK_OVER } from './lk-upload.js';

describe('uploadFile', () => {
  it('returns the file on success and shows nothing', async () => {
    const shown = [];
    const send = vi.fn(async () => ({ id: 'f1', url: 'u' }));
    expect(await uploadFile(send, { name: 'a.png' }, m => shown.push(m))).toEqual({ id: 'f1', url: 'u' });
    expect(send).toHaveBeenCalledWith({ name: 'a.png' });
    expect(shown).toEqual([]);
  });
  it('turns the refusal into one clear message, shows it once, and rejects', async () => {
    const shown = [];
    const send = vi.fn(async () => { throw new Error('there is nowhere to keep this file yet — connect your own storage in Settings → Storage, or ask a server admin…'); });
    await expect(uploadFile(send, { name: 'a.png' }, m => shown.push(m))).rejects.toThrow(/Settings → Storage/);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/^There is nowhere to keep this file yet/);
  });
  it('treats a reply with no file id as a failure', async () => {
    const shown = [];
    await expect(uploadFile(async () => ({}), {}, m => shown.push(m))).rejects.toThrow(/could not be uploaded/);
    expect(shown).toHaveLength(1);
  });
});

describe('storageAdvice', () => {
  it('keeps the node\'s wording for storage refusals and says what else failed otherwise', () => {
    expect(storageAdvice('you\'ve used all your storage on this server — …')).toMatch(/^You've used all your storage/);
    expect(storageAdvice('HTTP 413')).toMatch(/too large/i);
    expect(storageAdvice('this file is over your 25 MB limit on this server')).toMatch(/25 MB limit/);
    expect(storageAdvice('boom')).toMatch(/could not be uploaded \(boom\)/);
  });
});

describe('guarded', () => {
  it('passes the arguments through untouched and shows a refusal', async () => {
    const send = vi.fn(async (action, p, transfer, ms) => ({ id: 'x', action, p, transfer, ms }));
    const r = await guarded(send)('files:upload', { a: 1 }, ['buf'], 9);
    expect(r).toEqual({ id: 'x', action: 'files:upload', p: { a: 1 }, transfer: ['buf'], ms: 9 });
    const shown = vi.fn(); globalThis.alert = shown;
    await expect(guarded(async () => { throw new Error('connect your own storage in Settings → Storage'); })('files:upload', {})).rejects.toThrow();
    expect(shown).toHaveBeenCalledTimes(1);
  });
});

describe('the shown mark', () => {
  it('marks a failure the helper already showed, so callers do not alert twice', async () => {
    const err = await uploadFile(async () => { throw new Error('x'); }, {}, () => {}).catch(e => e);
    expect(err.shown).toBe(true);
  });
});

describe('shrinkPicture', () => {
  const big = () => new ArrayBuffer(SHRINK_OVER + 10);
  const small = new ArrayBuffer(1000);
  it('re-encodes a big picture as WebP, named and sized to match', async () => {
    const out = await shrinkPicture({ name: 'Sword.png', mime: 'image/png', data: big(), size: 1 }, async () => new ArrayBuffer(500));
    expect(out).toMatchObject({ name: 'Sword.webp', mime: 'image/webp', size: 500 });
    expect(out.data.byteLength).toBe(500);
  });
  it('leaves small pictures, GIFs, other files and a re-encode that is not smaller alone', async () => {
    const enc = async () => new ArrayBuffer(10);
    const p1 = { name: 'a.png', mime: 'image/png', data: small };
    expect(await shrinkPicture(p1, enc)).toEqual(p1);
    const gif = { name: 'a.gif', mime: 'image/gif', data: big() };
    expect((await shrinkPicture(gif, enc)).mime).toBe('image/gif');
    const mp3 = { name: 'a.mp3', mime: 'audio/mpeg', data: big() };
    expect((await shrinkPicture(mp3, enc)).mime).toBe('audio/mpeg');
    const worse = await shrinkPicture({ name: 'b.jpg', mime: 'image/jpeg', data: big() }, async () => new ArrayBuffer(SHRINK_OVER + 99));
    expect(worse.mime).toBe('image/jpeg');
    expect((await shrinkPicture({ name: 'c.png', mime: 'image/png', data: big() }, async () => { throw new Error('no'); })).mime).toBe('image/png');
  });
  it('passes the caller\'s size limit, and never sends it on', async () => {
    let side = 0;
    const out = await shrinkPicture({ name: 'p.png', mime: 'image/png', data: big(), maxSide: 1024 }, async (_d, _m, s) => { side = s; return new ArrayBuffer(5); });
    expect(side).toBe(1024);
    expect('maxSide' in out).toBe(false);
  });
});

describe('guarded', () => {
  it('sends the shrunk bytes, and transfers them instead of the old ones', async () => {
    const send = vi.fn(async () => ({ id: 'f' }));
    const data = new ArrayBuffer(10);
    await guarded(send)('files:upload', { name: 'a.txt', mime: 'text/plain', data }, [data], 5000);
    expect(send).toHaveBeenCalledWith('files:upload', { name: 'a.txt', mime: 'text/plain', data }, [data], 5000);
    await guarded(send)('files:upload', { name: 'b.txt', mime: 'text/plain', data });
    expect(send).toHaveBeenLastCalledWith('files:upload', { name: 'b.txt', mime: 'text/plain', data });
  });
});
