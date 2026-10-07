// bluff-bones-rules.js — Bluff Bones (liar's dice), a whole-table game run by the DM's Hub (table-runner.js).
//
// Everyone hides DICE dice under a cup. In turn, raise the bid — "at least N dice showing F under ALL the cups" — or
// call the last bid a lie. On a call every cup lifts: if the bid stands the caller loses a die, else the bidder does.
// Lose your last die and you are out; the last one with dice wins. Wisdom (Insight) reads the bidders' tells.

export const DICE = 4;
export const lobbyMs = 30000; // heroes are called over from across the map (owner, 2026-10-07)

const alive = s => s.players.filter(p => !p.out);
const rollN = (n, rng) => Array.from({ length: n }, () => 1 + Math.floor(rng() * 6));
export const totalDice = s => alive(s).reduce((t, p) => t + p.dice.length, 0);
export const countFace = (s, face) => alive(s).reduce((t, p) => t + p.dice.filter(d => d === face).length, 0);

export function npcs(setup, host) {
  return [{ id: 'host', name: host.name }, { id: 'wren', name: 'Wren the Fence' }];
}

export function create(players, setup, rng = Math.random) {
  return {
    round: 1, phase: 'bid', bid: null, reveal: null, hints: {}, delay: 600,
    turn: players[0].id,
    players: players.map(p => ({ id: p.id, name: p.name, npc: !!p.npc, mod: p.mod || 0, dice: rollN(DICE, rng), out: false, gone: false, peek: null })),
  };
}

export const toAct = s => (s.phase === 'bid' && !s.players.find(p => p.id === s.turn)?.out ? [s.turn] : []);

function nextAlive(s, id) {
  const i = s.players.findIndex(p => p.id === id);
  for (let k = 1; k <= s.players.length; k++) { const p = s.players[(i + k) % s.players.length]; if (!p.out) return p.id; }
  return null;
}

/** Whether `bid` beats the standing one: more dice, or as many of a higher face. */
export function beats(bid, standing) {
  if (!(bid.face >= 1 && bid.face <= 6 && bid.count >= 1)) return false;
  return !standing || bid.count > standing.count || (bid.count === standing.count && bid.face > standing.face);
}

/** What Insight tells `hero` about `bid`: right more often with a better Wisdom; null without the knack. */
function tell(s, hero, bid, rng) {
  if (hero.mod <= 0) return null;
  const truth = countFace(s, bid.face) >= bid.count;
  const right = rng() < Math.min(0.9, 0.55 + 0.1 * hero.mod);
  const looksTrue = right ? truth : !truth;
  const who = s.players.find(p => p.id === bid.by)?.name || 'They';
  return { looksTrue, text: looksTrue ? `${who} doesn't blink. Your gut says it's true.` : `${who}'s eyes flick to the cup. Your gut says: a lie.` };
}

export function act(state, id, action, rng = Math.random) {
  const s = structuredClone(state);
  if (s.phase !== 'bid' || s.turn !== id) throw new Error('Not your turn.');
  if (action?.type === 'bid') {
    const bid = { count: Math.floor(action.count), face: Math.floor(action.face), by: id };
    if (bid.count > totalDice(s)) throw new Error('There aren\'t that many dice on the table.');
    if (!beats(bid, s.bid)) throw new Error('Raise the bid: more dice, or the same number of a higher face.');
    s.bid = bid;
    s.hints = {};
    for (const p of alive(s)) if (!p.npc && p.id !== id) { const t = tell(s, p, bid, rng); if (t) s.hints[p.id] = t; }
    s.turn = nextAlive(s, id);
    return s;
  }
  if (action?.type === 'call') {
    if (!s.bid || s.bid.by === id) throw new Error('There is no bid to call.');
    const total = countFace(s, s.bid.face);
    const loser = total >= s.bid.count ? id : s.bid.by;
    s.reveal = { bid: s.bid, total, caller: id, loser, dice: Object.fromEntries(alive(s).map(p => [p.id, p.dice])) };
    s.phase = 'reveal'; s.delay = 4800;
    return s;
  }
  throw new Error('Bid or call.');
}

export function step(state, rng = Math.random) {
  const s = structuredClone(state);
  if (s.phase !== 'reveal') return s;
  const loser = s.players.find(p => p.id === s.reveal.loser);
  if (loser) { loser.dice = loser.dice.slice(1); if (!loser.dice.length) loser.out = true; }
  if (alive(s).length <= 1) { s.phase = 'done'; return s; }
  s.round++;
  for (const p of alive(s)) { p.dice = rollN(p.dice.length, rng); p.peek = null; }
  s.turn = loser && !loser.out ? loser.id : nextAlive(s, s.reveal.loser);
  s.bid = null; s.reveal = null; s.hints = {}; s.phase = 'bid'; s.delay = 600;
  return s;
}

export const over = s => s.phase === 'done';

export function outcome(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p || p.gone) return { won: false };
  const live = alive(s);
  return { won: live.length === 1 && live[0].id === id };
}

/** An NPC bids what it holds plus a fair share of the rest, and calls a bid that stretches belief. */
export function npc(s, id, rng = Math.random) {
  const me = s.players.find(p => p.id === id), others = totalDice(s) - me.dice.length;
  const mine = f => me.dice.filter(d => d === f).length;
  const expect = f => mine(f) + others / 6;
  const nerve = (rng() - 0.5) * 1.2;
  if (s.bid && s.bid.count > expect(s.bid.face) + 1 + nerve) return { type: 'call' };
  let best = 1; for (let f = 2; f <= 6; f++) if (mine(f) > mine(best) || (mine(f) === mine(best) && f > best)) best = f;
  if (!s.bid) return { type: 'bid', count: Math.max(1, Math.round(expect(best) - 0.5)), face: best };
  const count = best > s.bid.face ? s.bid.count : s.bid.count + 1;
  if (count > expect(best) + 1.6 + nerve) return { type: 'call' };
  return { type: 'bid', count, face: best };
}

export function auto(s, id) {
  if (s.bid && s.bid.by !== id) return { type: 'call' };
  return { type: 'bid', count: 1, face: 6 };
}

export function forfeit(state, id) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (!p) return s;
  Object.assign(p, { gone: true, out: true, dice: [] });
  if (alive(s).length <= 1) { s.phase = 'done'; return s; }
  if (s.turn === id) s.turn = nextAlive(s, id);
  if (s.bid?.by === id) s.bid = null;
  return s;
}

/** A peek that went unseen: the dice under the next player's cup, for this round. */
export function cheat(state, id) {
  const s = structuredClone(state), p = s.players.find(x => x.id === id);
  if (p) p.peek = nextAlive(s, id);
  return s;
}
