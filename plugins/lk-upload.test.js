import { describe, it, expect, vi } from 'vitest';
import { uploadFile, storageAdvice, guarded } from './lk-upload.js';

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
