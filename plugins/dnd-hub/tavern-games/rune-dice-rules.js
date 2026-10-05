// rune-dice-rules.js — Rune Dice, a whole-table game run by the DM's Hub (table-runner.js). No drawing here.
//
// Everyone at the table (heroes, the host, an old regular) starts with LIFE stones. Each round all roll six rune dice
// at once, up to three times, keeping what they like; then everyone strikes the NEXT player round the table:
// axes beat helms, arrows beat shields, hands steal favour. Gold-rimmed faces earn favour, spent on a god's boon.
// Last one standing wins (or the most stones after MAX_ROUNDS). Wisdom brings starting favour and, at +3, a 4th roll.

export const LIFE = 12, MAX_ROUNDS = 6;
/** The six faces of a rune die. */
export const FACES = [
  { f: 'axe', gold: false }, { f: 'axe', gold: true }, { f: 'arrow', gold: true },
  { f: 'helm', gold: false }, { f: 'shield', gold: true }, { f: 'hand', gold: false },
];
export const BOONS = {
  fury: { name: 'The Smith\'s Fury', cost: 4, text: '2 damage that nothing blocks' },
  grace: { name: 'The Mother\'s Grace', cost: 4, text: 'Heal 3 stones' },
  raven: { name: 'The Raven\'s Theft', cost: 2, text: 'Steal 2 favour from your target' },
};
export const lobbyMs = 15000;

const roll6 = rng => Array.from({ length: 6 }, () => Math.floor(rng() * 6));
const alive = s => s.players.filter(p => !p.out);
export const maxRolls = p => (p.mod >= 3 ? 4 : 3);
const count = (p, face) => p.dice.filter(d => FACES[d].f === face).length;

export function npcs(setup, host) {
  return [{ id: 'host', name: host.name }, { id: 'brannoc', name: 'Old Brannoc' }];
}

export function create(players, setup, rng = Math.random) {
  return {
    round: 1, phase: 'roll', clash: [], delay: 700,
    players: players.map(p => ({ id: p.id, name: p.name, npc: !!p.npc, mod: p.mod || 0, life: LIFE, favor: Math.max(0, Math.min(3, p.mod || 0)),
      dice: roll6(rng), keep: Array(6).fill(false), rolls: 1, done: false, boon: null, out: false, gone: false, loaded: false })),
  };
}

export const toAct = s => (s.phase === 'roll' ? alive(s).filter(p => !p.done).map(p => p.id) : []);

/** Who `id` strikes this round: the next player still in, round the table. */
export function targetOf(s, id) {
  const live = alive(s), i = live.findIndex(p => p.id === id);
  return live.length > 1 ? live[(i + 1) % live.length] : null;
}

export function act(state, id, action, rng = Math.random) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (!p || p.out || s.phase !== 'roll' || p.done) throw new Error('Not now.');
  const keep = Array.isArray(action?.keep) ? FACES.map((_, i) => !!action.keep[i]) : p.keep;
  if (action?.type === 'roll') {
    if (p.rolls >= maxRolls(p)) throw new Error('No rolls left.');
    p.keep = keep;
    p.dice = p.dice.map((d, i) => (keep[i] ? d : Math.floor(rng() * 6)));
    p.rolls++;
  } else if (action?.type === 'done') {
    p.keep = keep;
    p.boon = BOONS[action.boon] ? action.boon : null;
    p.done = true;
  } else throw new Error('Roll or be done.');
  return s;
}

/** Everyone is ready: the clash; or after the clash has been shown: the next round. */
export function step(state, rng = Math.random) {
  const s = structuredClone(state);
  if (s.phase === 'clash') {
    s.round++;
    if (alive(s).length <= 1 || s.round > MAX_ROUNDS) { s.phase = 'done'; return s; }
    s.phase = 'roll'; s.clash = []; s.delay = 700;
    for (const p of alive(s)) Object.assign(p, { dice: roll6(rng), keep: Array(6).fill(false), rolls: 1, done: false, boon: null, loaded: false });
    return s;
  }
  const live = alive(s), get = id => s.players.find(p => p.id === id);
  const ev = Object.fromEntries(live.map(p => [p.id, { from: p.id, to: targetOf(s, p.id)?.id, dmg: 0, stole: 0, heal: 0, gained: 0, boon: null }]));
  for (const p of live) { const g = p.dice.filter(d => FACES[d].gold).length; p.favor += g; ev[p.id].gained = g; }
  for (const p of live) {
    const t = get(ev[p.id].to); if (!t) continue;
    const n = Math.min(count(p, 'hand'), t.favor); t.favor -= n; p.favor += n; ev[p.id].stole += n;
  }
  for (const p of live) {
    const b = BOONS[p.boon], t = get(ev[p.id].to);
    if (!b || p.favor < b.cost) continue;
    p.favor -= b.cost; ev[p.id].boon = p.boon;
    if (p.boon === 'grace') { const h = Math.min(3, LIFE - p.life); p.life += h; ev[p.id].heal = h; }
    if (p.boon === 'raven' && t) { const n = Math.min(2, t.favor); t.favor -= n; p.favor += n; ev[p.id].stole += n; }
  }
  for (const p of live) {
    const t = get(ev[p.id].to); if (!t) continue;
    const dmg = Math.max(0, count(p, 'axe') + (p.loaded ? 2 : 0) - count(t, 'helm')) + Math.max(0, count(p, 'arrow') - count(t, 'shield'))
      + (ev[p.id].boon === 'fury' ? 2 : 0);
    ev[p.id].dmg = dmg;
  }
  for (const e of Object.values(ev)) { const t = get(e.to); if (t) t.life = Math.max(0, t.life - e.dmg); }
  for (const p of live) if (p.life <= 0) p.out = true;
  s.clash = Object.values(ev);
  s.phase = 'clash'; s.delay = 3800;
  return s;
}

export const over = s => s.phase === 'done';

/** The winner(s): the last one in, else the most stones, then the most favour. */
export function winners(s) {
  const live = alive(s);
  if (live.length === 1) return [live[0].id];
  const pool = live.length ? live : s.players;
  const best = Math.max(...pool.map(p => p.life * 100 + p.favor));
  return pool.filter(p => p.life * 100 + p.favor === best).map(p => p.id);
}

export function outcome(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p || p.gone) return { won: false };
  const w = winners(s);
  return { won: w.includes(id) ? (w.length === 1 ? true : 'draw') : false };
}

/** An NPC keeps blades and gold, rolls the rest, and calls a boon it can afford. */
export function npc(s, id, rng = Math.random) {
  const p = s.players.find(x => x.id === id), t = targetOf(s, id);
  const keep = p.dice.map(d => ['axe', 'arrow'].includes(FACES[d].f) || FACES[d].gold || (FACES[d].f === 'helm' && rng() < 0.4));
  if (p.rolls < maxRolls(p) && keep.some(k => !k)) return { type: 'roll', keep };
  const golds = p.dice.filter(d => FACES[d].gold).length, fav = p.favor + golds;
  const boon = p.life <= 5 && fav >= 4 ? 'grace' : fav >= 4 ? 'fury' : fav >= 2 && t?.favor >= 3 ? 'raven' : null;
  return { type: 'done', keep, boon };
}

export const auto = (s, id) => ({ type: 'done', keep: s.players.find(x => x.id === id).keep, boon: null });

export function forfeit(state, id) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (p) Object.assign(p, { gone: true, out: true, life: 0, done: true });
  if (alive(s).length <= 1 && s.phase === 'roll') s.phase = 'done';
  return s;
}

/** A loaded die that went unseen: two extra axes this round. */
export function cheat(state, id) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (p) p.loaded = true;
  return s;
}
