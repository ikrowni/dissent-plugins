import { describe, it, expect } from 'vitest';
import { createArchetypes, newArchetypeId, MAX_CARDS } from './archetypes.js';

function memoryStore() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async (k) => { m.delete(k); } };
}

describe('archetypes', () => {
  it('stores each archetype under its own key, plus a small index', async () => {
    const store = memoryStore();
    const a = createArchetypes(store);
    await a.save({ id: 'x1', name: 'Strength', character: 'ironclad', cards: [{ id: 'BASH', upgrades: 0 }] });
    await a.save({ id: 'x2', name: 'Exhaust', character: 'ironclad', cards: [] });
    expect([...store.m.keys()].sort()).toEqual(['archetype:x1', 'archetype:x2', 'archetypes']);
    expect(await a.list('ironclad')).toEqual([{ id: 'x1', name: 'Strength', character: 'ironclad' }, { id: 'x2', name: 'Exhaust', character: 'ironclad' }]);
    expect((await a.get('x1')).cards).toEqual([{ id: 'BASH', upgrades: 0 }]);
  });

  it('saving again replaces, never duplicates, the index entry', async () => {
    const a = createArchetypes(memoryStore());
    await a.save({ id: 'x1', name: 'One', character: 'silent', cards: [] });
    await a.save({ id: 'x1', name: 'Renamed', character: 'silent', cards: [] });
    expect(await a.list('silent')).toEqual([{ id: 'x1', name: 'Renamed', character: 'silent' }]);
  });

  // ⚠️ The node allows 60 personal-storage writes a minute per user (router.go). A card edit
  // must cost one write, not two: the index is rewritten only when its entry changes.
  it('a card-only edit writes the archetype key and not the index', async () => {
    const store = memoryStore();
    const a = createArchetypes(store);
    const arch = await a.save({ id: 'x1', name: 'A', character: 'silent', cards: [] });
    const writes = [];
    const set = store.set;
    store.set = async (k, v) => { writes.push(k); return set(k, v); };
    await a.save({ ...arch, cards: [{ id: 'NEUTRALIZE', upgrades: 0 }] });
    expect(writes).toEqual(['archetype:x1']);
    await a.save({ ...arch, name: 'B' });
    expect(writes).toEqual(['archetype:x1', 'archetype:x1', 'archetypes']);
  });

  it('lists by character', async () => {
    const a = createArchetypes(memoryStore());
    await a.save({ id: 'x1', name: 'A', character: 'silent', cards: [] });
    await a.save({ id: 'x2', name: 'B', character: 'defect', cards: [] });
    expect((await a.list('defect')).map((x) => x.id)).toEqual(['x2']);
  });

  it('removes the key and the index entry', async () => {
    const store = memoryStore();
    const a = createArchetypes(store);
    await a.save({ id: 'x1', name: 'A', character: 'silent', cards: [] });
    await a.remove('x1');
    expect(store.m.has('archetype:x1')).toBe(false);
    expect(await a.list()).toEqual([]);
  });

  it('cleans what it stores: name trimmed and defaulted, upgrades a small integer, card count capped', async () => {
    const a = createArchetypes(memoryStore());
    const big = Array.from({ length: MAX_CARDS + 5 }, () => ({ id: 'STRIKE_IRONCLAD', upgrades: '7', extra: 'dropped' }));
    const saved = await a.save({ id: 'x1', name: '   ', character: 'ironclad', cards: big });
    expect(saved.name).toBe('Untitled');
    expect(saved.cards).toHaveLength(MAX_CARDS);
    expect(saved.cards[0]).toEqual({ id: 'STRIKE_IRONCLAD', upgrades: 7 });
  });

  // 🔴 The node refuses a value over 64 KB. The largest archetype must fit with room to spare.
  it('🔴 the largest allowed archetype is far below the 64 KB value cap', async () => {
    const store = memoryStore();
    const long = 'X'.repeat(60);
    await createArchetypes(store).save({ id: newArchetypeId(), name: long, character: 'necrobinder',
      cards: Array.from({ length: MAX_CARDS }, () => ({ id: 'THE_LONGEST_PLAUSIBLE_CARD_ID_IN_THE_GAME', upgrades: 9 })) });
    for (const v of store.m.values()) expect(JSON.stringify(v).length).toBeLessThan(32 * 1024);
  });

  it('ids are storage-key safe', () => {
    expect(newArchetypeId()).toMatch(/^[a-z0-9]{6,}$/);
  });
});
