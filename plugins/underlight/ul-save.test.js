import { describe, it, expect } from 'vitest';
import { saveOf, readSave, runFrom } from './ul-save.js';
import { STEPS } from './ul-run.js';
import { Store } from './ul-store.js';

const CAMP_STEP = STEPS.indexOf('camp');

describe('a save', () => {
  it('round-trips a run at the camp', () => {
    const save = saveOf({ base: 12345, step: CAMP_STEP, carry: { hp: 61.5, oil: 40, flask: 1 } }, 1700000000000);
    expect(readSave(JSON.parse(JSON.stringify(save)))).toEqual({ base: 12345, step: CAMP_STEP, carry: { hp: 61.5, oil: 40, flask: 1 }, at: 1700000000000 });
    expect(runFrom(readSave(save))).toEqual({ base: 12345, step: CAMP_STEP, carry: { hp: 61.5, oil: 40, flask: 1 }, resumed: true });
  });
  it('refuses anything that is not exactly a save at a camp', () => {
    const good = saveOf({ base: 7, step: CAMP_STEP, carry: { hp: 50, oil: 50, flask: 0 } }, 1);
    for (const bad of [null, 'x', { ...good, v: 2 }, { ...good, step: 0 }, { ...good, base: -1 }, { ...good, base: 1.5 },
      { ...good, carry: { ...good.carry, hp: 0 } }, { ...good, carry: { ...good.carry, hp: 101 } }, { ...good, carry: { ...good.carry, oil: NaN } },
      { ...good, carry: { ...good.carry, flask: 2 } }, { ...good, carry: null }]) expect(readSave(bad)).toBe(null);
  });
});

describe('the store', () => {
  const host = (impl) => async (action, params) => impl(action, params);
  it('reads, writes and deletes your own data (user scope)', async () => {
    const seen = [], data = {};
    const s = new Store(host((action, p) => { seen.push([action, p.scope, p.key]); if (action === 'storage:get') return data[p.key] === undefined ? null : { value: data[p.key] }; if (action === 'storage:set') data[p.key] = p.value; else delete data[p.key]; return null; }));
    expect(await s.get('run')).toBe(null);
    expect(await s.set('run', { a: 1 })).toBe(true);
    expect(await s.get('run')).toEqual({ a: 1 });
    expect(await s.del('run')).toBe(true);
    expect(seen.every(([, scope]) => scope === 'user')).toBe(true);
    expect(s.state).toBe('ok');
  });
  it('knows a refusal (View Without Joining) from any other failure', async () => {
    const refused = new Store(host(() => { throw new Error('storage:user not granted'); }));
    expect(await refused.set('run', 1)).toBe(false);
    expect(refused.state).toBe('refused');
    const broken = new Store(host(() => { throw new Error('timeout'); }));
    await broken.get('run');
    expect(broken.state).toBe('error');
  });
  it('without a host (opened on its own) saves nothing, and says so', async () => {
    const s = new Store(null);
    expect([s.state, await s.set('run', 1), await s.get('run')]).toEqual(['standalone', false, null]);
  });
});
