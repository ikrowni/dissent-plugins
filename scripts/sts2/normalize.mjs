// scripts/sts2/normalize.mjs — the Spire Codex export, trimmed to what the plugin uses.
//
// Pure: takes parsed JSON, returns plugin data. The build script (../sts2-data.mjs) does the
// I/O. Fields are PICKED, not copied through, so a new export field never silently grows
// the shipped data.

const ORIGIN = 'https://spire-codex.com';
const abs = (u) => (!u ? null : u.startsWith('http') ? u : `${ORIGIN}${u}`);

const pickCard = (c, api) => ({
  id: c.id,
  name: c.name,
  description: c.description,
  upgradeDescription: c.upgrade_description ?? null,
  cost: c.cost,
  xCost: Boolean(c.is_x_cost),
  starCost: c.star_cost ?? null,
  type: c.type,
  rarity: c.rarity,
  color: c.color,
  target: c.target ?? null,
  keywords: c.keywords ?? [],
  powers: (c.powers_applied ?? []).map((p) => ({ power: p.power, amount: p.amount })),
  order: c.compendium_order ?? 0,
  image: api?.image_url_card ?? null,
  imageUpgraded: api?.image_url_card_upg ?? null,
  portrait: abs(c.image_url),
});

const pickRelic = (r) => ({
  id: r.id, name: r.name, description: r.description, flavor: r.flavor ?? null,
  rarity: r.rarity_key ?? r.rarity, pool: r.pool ?? null, order: r.compendium_order ?? 0, image: abs(r.image_url),
});

const pickPotion = (p) => ({
  id: p.id, name: p.name, description: p.description, rarity: p.rarity_key ?? p.rarity,
  pool: p.pool ?? null, order: p.compendium_order ?? 0, image: abs(p.image_url),
});

const pickPower = (p) => ({
  id: p.id, name: p.name, description: p.description, type: p.type ?? null, image: abs(p.image_url),
});

const pickMonster = (m) => ({
  id: m.id, name: m.name, type: m.type,
  hp: { min: m.min_hp, max: m.max_hp ?? m.min_hp, minAscension: m.min_hp_ascension ?? null, maxAscension: m.max_hp_ascension ?? m.min_hp_ascension ?? null },
  moves: (m.moves ?? []).map((mv) => ({ id: mv.id, name: mv.name, intent: mv.intent ?? null, damage: mv.damage ?? null, block: mv.block ?? null })),
  pattern: m.attack_pattern ?? null,
  encounters: (m.encounters ?? []).map((e) => e.encounter_id ?? e.id),
  image: abs(m.image_url),
});

const pickEvent = (e) => ({
  id: e.id, name: e.name, act: e.act ?? null, description: e.description,
  options: (e.options ?? []).map((o) => ({ id: o.id, title: o.title, description: o.description })),
});

const pickEncounter = (e) => ({
  id: e.id, name: e.name, roomType: e.room_type, act: e.act ?? null, weak: Boolean(e.is_weak),
  monsters: (e.monsters ?? []).map((m) => m.id),
});

/**
 * @param {{ cards, apiCards, relics, potions, powers, monsters, events?, encounters?, keywords, changelogs }} src
 */
export function normalize(src) {
  const api = new Map((src.apiCards ?? []).map((c) => [c.id, c]));
  const latest = (src.changelogs ?? [])[0] ?? {};
  return {
    cards: src.cards.map((c) => pickCard(c, api.get(c.id))),
    relics: (src.relics ?? []).map(pickRelic),
    potions: (src.potions ?? []).map(pickPotion),
    powers: (src.powers ?? []).map(pickPower),
    monsters: (src.monsters ?? []).map(pickMonster),
    events: (src.events ?? []).map(pickEvent),
    encounters: (src.encounters ?? []).map(pickEncounter),
    keywords: (src.keywords ?? []).map((k) => ({ id: k.id, name: k.name, description: k.description })),
    meta: {
      gameVersion: latest.game_version ?? 'unknown',
      dataDate: latest.date ?? null,
      source: 'https://spire-codex.com',
      sourceRepo: 'https://github.com/ptrlrd/spire-codex',
      copyright: 'Slay the Spire 2 © Mega Crit Games',
      game: 'https://store.steampowered.com/app/2868840/',
    },
  };
}

/** Every image the plugin needs, as download jobs. `resize` is a max edge in px. */
export function imageJobs(data) {
  const jobs = [];
  for (const c of data.cards) {
    if (c.image) {
      jobs.push({ id: `card:${c.id}`, group: 'cards', url: c.image });
      if (c.imageUpgraded) jobs.push({ id: `card-upg:${c.id}`, group: 'cards-upg', url: c.imageUpgraded });
    } else if (c.portrait) {
      jobs.push({ id: `card:${c.id}`, group: 'cards', url: c.portrait, fallback: true });
    }
  }
  for (const r of data.relics) if (r.image) jobs.push({ id: `relic:${r.id}`, group: 'relics', url: r.image });
  for (const p of data.potions) if (p.image) jobs.push({ id: `potion:${p.id}`, group: 'potions', url: p.image });
  for (const p of data.powers) if (p.image) jobs.push({ id: `power:${p.id}`, group: 'powers', url: p.image });
  for (const m of data.monsters) if (m.image) jobs.push({ id: `monster:${m.id}`, group: 'monsters', url: m.image, resize: 480 });
  return jobs;
}
