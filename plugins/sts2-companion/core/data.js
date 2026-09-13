// core/data.js — the ONLY module that knows where STS2 data comes from.
//
// Today: JSON files bundled with the plugin (built by scripts/sts2-data.mjs from a pinned
// Spire Codex export). A live refresh, when net:direct exists, belongs here and nowhere else.

const KINDS = { card: 'cards', relic: 'relics', potion: 'potions', power: 'powers', monster: 'monsters', event: 'events', encounter: 'encounters', keyword: 'keywords' };

/** `CARD.BASH` → `{ kind: 'card', id: 'BASH' }`. An unprefixed id has kind null. */
export function saveIdToDataId(raw) {
  const i = raw.indexOf('.');
  if (i < 0) return { kind: null, id: raw };
  const kind = raw.slice(0, i).toLowerCase();
  return { kind: KINDS[kind] ? kind : null, id: raw.slice(i + 1) };
}

const defaultLoad = async (name) => {
  const r = await fetch(`data/${name}.json`);
  if (!r.ok) throw new Error(`data ${name}: ${r.status}`);
  return r.json();
};

export function createData({ load = defaultLoad } = {}) {
  const cache = new Map(); // category -> Promise<{ list, byId }>

  function category(name) {
    if (!cache.has(name)) {
      cache.set(name, load(name).then((list) => ({ list, byId: new Map(list.map((x) => [x.id, x])) })));
    }
    return cache.get(name);
  }

  const unknown = (kind, id) => ({ unknown: true, kind, id, name: id, description: '' });

  return {
    KINDS,
    async list(kind) { return (await category(KINDS[kind])).list; },
    /** Never undefined: an id the data lacks answers an explicit unknown record. */
    async get(kind, id) {
      if (!KINDS[kind]) return unknown(kind, id);
      return (await category(KINDS[kind])).byId.get(id) ?? unknown(kind, id);
    },
    /** Game text names powers ("Vulnerable"); the data keys them by id. */
    async powerByName(name) {
      const { list } = await category('powers');
      const lower = name.toLowerCase();
      return list.find((p) => p.name.toLowerCase() === lower) ?? null;
    },
    async keywordByName(name) {
      const { list } = await category('keywords');
      const lower = name.toLowerCase();
      return list.find((k) => k.name.toLowerCase() === lower) ?? null;
    },
    meta: () => load('meta'),
  };
}
