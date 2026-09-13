import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from './data.js';
import { loadDigests, PAGE } from './digestStore.js';
import { DIGEST_VERSION } from './digest.js';

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const snapshot = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));

function fakeLocal(initial = null) {
  let value = initial;
  return { get: vi.fn(async () => value), set: vi.fn(async (_k, v) => { value = v; }), peek: () => value };
}

function realSaves() {
  return vi.fn(async (action, params) => {
    if (action === 'runs') return snapshot('runs');
    if (action === 'run') return params.id === '1773796874' ? snapshot('run-1773796874') : { status: 'not_found' };
    return { status: 'error' };
  });
}

describe('loadDigests', () => {
  it('summarises the REAL runs page and caches the digests', async () => {
    const saves = realSaves(); const local = fakeLocal();
    const r = await loadDigests({ saves, local, data: createData({ load }) });
    expect(saves).toHaveBeenCalledWith('runs', { limit: PAGE });
    expect(r.status).toBe('ok');
    expect(r.digests.map((d) => d.id)).toEqual(['1773796874']);
    expect(local.set).toHaveBeenCalledTimes(1);
    expect(local.peek()).toMatchObject({ version: DIGEST_VERSION });
    expect(Object.keys(local.peek().digests)).toEqual(['1773796874']);
  });

  it('🔴 reads no run it has already summarised, and writes nothing when nothing changed', async () => {
    const saves = realSaves(); const local = fakeLocal();
    await loadDigests({ saves, local, data: createData({ load }) });
    saves.mockClear(); local.set.mockClear();
    const r = await loadDigests({ saves, local, data: createData({ load }) });
    expect(saves.mock.calls.map((c) => c[0])).toEqual(['runs']);
    expect(local.set).not.toHaveBeenCalled();
    expect(r.digests).toHaveLength(1);
  });

  it('rebuilds every digest when the digest version changed', async () => {
    const saves = realSaves();
    const local = fakeLocal({ version: DIGEST_VERSION - 1, digests: { 1773796874: { id: '1773796874', stale: true } } });
    const r = await loadDigests({ saves, local, data: createData({ load }) });
    expect(saves).toHaveBeenCalledWith('run', { id: '1773796874' });
    expect(r.digests[0].stale).toBeUndefined();
  });

  it('forgets a run that is no longer in the history', async () => {
    const saves = realSaves();
    const local = fakeLocal({ version: DIGEST_VERSION, digests: { gone: { id: 'gone' } } });
    await loadDigests({ saves, local, data: createData({ load }) });
    expect(Object.keys(local.peek().digests)).toEqual(['1773796874']);
  });

  it('follows next_before across pages, and stops without it on a short page', async () => {
    const run = snapshot('runs').runs[0];
    const saves = vi.fn(async (action, params) => {
      if (action === 'run') return { status: 'not_found' };
      if (!params.before) return { status: 'ok', runs: [{ ...run, id: '9' }], skipped: 0, next_before: '5' };
      return { status: 'ok', runs: [{ ...run, id: '4' }], skipped: 0, next_before: null };
    });
    const r = await loadDigests({ saves, local: fakeLocal(), data: createData({ load }) });
    expect(saves).toHaveBeenCalledWith('runs', { limit: PAGE, before: '5' });
    expect(r).toMatchObject({ status: 'ok', skipped: 2 });
  });

  it('passes a non-ok status through (web answers desktop_only)', async () => {
    const r = await loadDigests({ saves: vi.fn(async () => ({ status: 'desktop_only' })), local: fakeLocal(), data: createData({ load }) });
    expect(r).toEqual({ status: 'desktop_only' });
  });

  it('reports progress for runs it has to read', async () => {
    const onProgress = vi.fn();
    await loadDigests({ saves: realSaves(), local: fakeLocal(), data: createData({ load }), onProgress });
    expect(onProgress).toHaveBeenLastCalledWith({ done: 1, total: 1 });
  });
});
