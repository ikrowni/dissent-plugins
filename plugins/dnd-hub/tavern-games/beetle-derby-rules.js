// beetle-derby-rules.js — Beetle Derby, a whole-table game run by the DM's Hub (table-runner.js). No drawing here.
//
// Six beetles, odds on each. Every hero backs one; then the house runs the race once and every screen plays the same
// frames. A winning beetle pays its odds (×, capped by lk-tavern.js MAX_PAYOUT). The odds follow each beetle's
// known form, but on the day some are keener than others: Wisdom (Insight) catches a whisper about one of them.

export const LANES = 6, TICKS = 90, TICK_MS = 90;
export const lobbyMs = 30000; // heroes are called over from across the map (owner, 2026-10-07)
const NAMES = ['Old Clatterback', 'Saint Nibbles', 'Rust Duchess', 'Gravel Prince', 'Little Thunder', 'Moss Widow', 'Captain Crumb',
  'The Undertaker', 'Lady Scuttle', 'Brass Button', 'Burrow Baron', 'Sweet Mildred'];
const SHELLS = ['#b8412a', '#2f6a3a', '#3a5aa8', '#c79a2a', '#6a3a8a', '#2a8a8a', '#8a5a2a', '#a83a6a'];
const ODDS = [2, 3, 4, 5, 7, 9];

export function npcs() { return []; }

export function create(players, setup, rng = Math.random) {
  const names = [...NAMES].sort(() => rng() - 0.5).slice(0, LANES), shells = [...SHELLS].sort(() => rng() - 0.5);
  // known form, best first; odds follow it. Keenness on the day wanders around it.
  const form = Array.from({ length: LANES }, (_, i) => 1.18 - i * 0.07);
  const order = [...Array(LANES).keys()].sort(() => rng() - 0.5);
  const beetles = order.map((rank, lane) => ({
    lane, name: names[lane], shell: shells[lane % shells.length], odds: ODDS[rank], form: Math.max(1, 5 - rank),
    keen: form[rank] * (0.86 + rng() * 0.28),
  }));
  const s = { phase: 'pick', beetles, frames: null, winner: null, delay: 600, whispers: {},
    players: players.map(p => ({ id: p.id, name: p.name, npc: !!p.npc, mod: p.mod || 0, pick: null, sugar: false, gone: false })) };
  for (const p of s.players) {
    if (p.mod <= 0 || p.npc) continue;
    // the most surprising beetle on the day (the keenest against its odds, or the dullest favourite)
    const odd = [...beetles].sort((a, b) => Math.abs(b.keen - (1.18 - (ODDS.indexOf(b.odds)) * 0.07)) - Math.abs(a.keen - (1.18 - (ODDS.indexOf(a.odds)) * 0.07)))[0];
    const keener = odd.keen > 1.18 - ODDS.indexOf(odd.odds) * 0.07;
    const right = rng() < Math.min(0.9, 0.55 + 0.1 * p.mod);
    s.whispers[p.id] = (right ? keener : !keener)
      ? `A stable boy mutters that ${odd.name} has been fed well this week — keen as mustard.`
      : `You notice ${odd.name} dragging a leg. Not its day.`;
  }
  return s;
}

export const toAct = s => (s.phase === 'pick' ? s.players.filter(p => !p.gone && p.pick == null).map(p => p.id) : []);

export function act(state, id, action) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (s.phase !== 'pick' || !p || p.pick != null) throw new Error('The bets are in.');
  const lane = Number(action?.beetle);
  if (action?.type !== 'pick' || !(lane >= 0 && lane < LANES)) throw new Error('Pick a beetle.');
  p.pick = lane;
  return s;
}

/** Run the race (every screen plays the same frames), then end. */
export function step(state, rng = Math.random) {
  const s = structuredClone(state);
  if (s.phase === 'race') { s.phase = 'done'; return s; }
  const keen = s.beetles.map(b => b.keen * (s.players.some(p => p.sugar && p.pick === b.lane) ? 1.22 : 1));
  const pos = Array(LANES).fill(0), frames = [];
  let winner = null, stall = Array(LANES).fill(0);
  for (let t = 0; t < TICKS * 3 && winner == null; t++) {
    for (let i = 0; i < LANES; i++) {
      if (stall[i] > 0) { stall[i]--; continue; }
      if (rng() < 0.012) { stall[i] = 4 + Math.floor(rng() * 6); continue; }    // stops to nibble something
      pos[i] += (0.0115 * keen[i]) * (0.55 + rng() * 0.9);
    }
    frames.push(pos.map(x => Math.round(Math.min(1, x) * 1000) / 1000));
    const done = pos.map((x, i) => [x, i]).filter(([x]) => x >= 1).sort((a, b) => b[0] - a[0]);
    if (done.length) winner = done[0][1];
  }
  s.frames = frames; s.winner = winner ?? pos.indexOf(Math.max(...pos));
  s.phase = 'race'; s.delay = frames.length * TICK_MS + 2500;
  return s;
}

export const over = s => s.phase === 'done';

export function outcome(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p || p.gone || p.pick == null || s.winner == null) return { won: false };
  return p.pick === s.winner ? { won: true, multiplier: s.beetles[p.pick].odds } : { won: false };
}

export const npc = () => null;
/** A hero who never chose backs the favourite. */
export const auto = s => ({ type: 'pick', beetle: [...s.beetles].sort((a, b) => a.odds - b.odds)[0].lane });

export function forfeit(state, id) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (p) p.gone = true;
  return s;
}

/** A sugar cube that went unseen: the hero's beetle runs keener. */
export function cheat(state, id) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (p) p.sugar = true;
  return s;
}
