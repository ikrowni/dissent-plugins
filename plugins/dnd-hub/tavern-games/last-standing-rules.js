// last-standing-rules.js — Last One Standing, a whole-table drinking contest run by the DM's Hub (table-runner.js).
//
// Each round everyone still upright drinks: first they keep their tankard steady (a few seconds on their own screen,
// a score 0..1 the house turns into -1..+2), then a Constitution save: d20 + CON + steadiness against a DC that
// climbs every round. Fail and you are out (and wake up poisoned). If every drinker fails together, the best total
// stays in. The last one upright wins; still several after MAX_ROUNDS, they share it.

export const MAX_ROUNDS = 8;
export const lobbyMs = 30000; // heroes are called over from across the map (owner, 2026-10-07)
export const dcFor = round => 8 + 2 * round;
export const steadyBonus = score => Math.round(3 * Math.max(0, Math.min(1, Number(score) || 0)) - 1);
const NPC_STEADY = { novice: [0.2, 0.6], regular: [0.35, 0.8], shark: [0.55, 0.95] };

const alive = s => s.players.filter(p => !p.out);

export function npcs(setup, host) {
  return [{ id: 'host', name: host.name, con: 2 }, { id: 'hrolf', name: 'Big Hrolf', con: 4 }];
}

export function create(players, setup, rng = Math.random) {
  return {
    round: 1, phase: 'steady', rolls: [], delay: 600, skill: setup?.npcSkill || 'regular',
    players: players.map(p => ({ id: p.id, name: p.name, npc: !!p.npc, mod: p.npc ? (p.con ?? 2) : (p.mod || 0), steady: null, out: false, gone: false, pour: false })),
  };
}

export const toAct = s => (s.phase === 'steady' ? alive(s).filter(p => p.steady == null).map(p => p.id) : []);

export function act(state, id, action) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (s.phase !== 'steady' || !p || p.out || p.steady != null) throw new Error('Drink up and wait.');
  if (action?.type !== 'steady') throw new Error('Steady your tankard.');
  p.steady = Math.max(0, Math.min(1, Number(action.score) || 0));
  return s;
}

export function step(state, rng = Math.random) {
  const s = structuredClone(state);
  if (s.phase === 'results') {
    s.round++;
    if (alive(s).length <= 1 || s.round > MAX_ROUNDS) { s.phase = 'done'; return s; }
    for (const p of alive(s)) { p.steady = null; p.pour = false; }
    s.phase = 'steady'; s.rolls = []; s.delay = 600;
    return s;
  }
  const dc = dcFor(s.round);
  s.rolls = alive(s).map(p => {
    const d20 = 1 + Math.floor(rng() * 20), bonus = steadyBonus(p.steady), total = d20 + p.mod + bonus;
    return { id: p.id, d20, mod: p.mod, bonus, total, poured: p.pour, pass: p.pour || (d20 !== 1 && (d20 === 20 || total >= dc)) };
  });
  if (!s.rolls.some(r => r.pass)) {             // everyone went down at once: the best total stays up
    const best = Math.max(...s.rolls.map(r => r.total));
    for (const r of s.rolls) if (r.total === best) { r.pass = true; r.saved = true; }
  }
  for (const r of s.rolls) if (!r.pass) s.players.find(p => p.id === r.id).out = true;
  s.phase = 'results'; s.dc = dc; s.delay = 5200;
  return s;
}

export const over = s => s.phase === 'done';

export function outcome(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p || p.gone || p.out) return { won: false };
  return { won: alive(s).length === 1 ? true : 'draw' };
}

/** An NPC's steadiness: by how good the house made it, and a little worse every round. */
export function npc(s, id, rng = Math.random) {
  const [lo, hi] = NPC_STEADY[s.skill] || NPC_STEADY.regular;
  return { type: 'steady', score: Math.max(0, lo + rng() * (hi - lo) - 0.04 * (s.round - 1)) };
}

export const auto = () => ({ type: 'steady', score: 0 });

export function forfeit(state, id) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (p) Object.assign(p, { gone: true, out: true });
  if (alive(s).length <= 1 && s.phase === 'steady') s.phase = 'done';
  return s;
}

/** Poured into the plant pot, unseen: this round's save is passed. */
export function cheat(state, id) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (p) p.pour = true;
  return s;
}
