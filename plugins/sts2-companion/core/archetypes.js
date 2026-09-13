// core/archetypes.js — Builder archetypes in storage:user.
//
// One key per archetype (`archetype:<id>`), so the node's 64 KB per-value cap binds one deck at a
// time and never the whole collection (spec §3.2). `archetypes` is the small index the list reads.
// Write order: the archetype first, then the index — a failed index write leaves an orphan key,
// never an index entry pointing at nothing. Remove runs the other way for the same reason.

const INDEX = 'archetypes';
export const MAX_CARDS = 200;

export const newArchetypeId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const clean = (arch) => ({
  id: String(arch.id),
  name: String(arch.name ?? '').trim().slice(0, 60) || 'Untitled',
  character: String(arch.character),
  cards: (arch.cards ?? []).slice(0, MAX_CARDS).map((c) => ({
    id: String(c.id),
    upgrades: Math.max(0, Math.min(9, Number.parseInt(c.upgrades, 10) || 0)),
  })),
});

export function createArchetypes(store) {
  const index = async () => (await store.get(INDEX)) ?? [];
  return {
    async list(character) {
      return (await index()).filter((a) => !character || a.character === character);
    },
    get: (id) => store.get(`archetype:${id}`),
    async save(arch) {
      const a = clean(arch);
      await store.set(`archetype:${a.id}`, a);
      const list = await index();
      const was = list.find((x) => x.id === a.id);
      // ⚠️ The node allows 60 personal-storage writes a minute: a card edit costs one write.
      if (!was || was.name !== a.name || was.character !== a.character) {
        await store.set(INDEX, [...list.filter((x) => x.id !== a.id), { id: a.id, name: a.name, character: a.character }]);
      }
      return a;
    },
    async remove(id) {
      await store.set(INDEX, (await index()).filter((x) => x.id !== id));
      await store.del(`archetype:${id}`);
    },
  };
}
