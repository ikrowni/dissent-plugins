// table-runner.js — one whole-table game, run by the DM's Hub (the house): heroes and NPCs at one table at once.
//
// Pure of the network: dnd-hub-tavern-table.js wires `broadcast` and `settle` to the tavern events, and the preview
// harness and tests wire them to a loopback. A game's RULES module (e.g. rune-dice-rules.js) exports:
//   lobbyMs?, npcs(setup, host) → [{ id, name }] (the host and any NPC regulars who play),
//   create(players, setup, rng) → state          players: [{ id, name, npc, mod }]
//   toAct(state) → [ids]                          who may act now (several at once is fine); [] = the house moves on
//   act(state, id, action, rng) → state           throws Error(reason) when the action is not allowed
//   npc(state, id, rng) → action                  what an NPC does now
//   auto(state, id, rng) → action                 what a hero who took too long does
//   step(state, rng) → state                      the house moves on (reveal, race, next round); `state.delay` ms first
//   over(state), outcome(state, id) → { won, multiplier? }, forfeit(state, id) → state, cheat(state, id) → state
// Every state change is broadcast whole; a game's view draws what its player may see.
import { cheatCheck, hostPerception } from '../lk-tavern.js';

export const LOBBY_MS = 30000, TURN_MS = 45000;

export function createTableRunner({ rules, setup, host, actor = null, broadcast, settle, rng = Math.random,
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = t => clearTimeout(t), now = () => Date.now() }) {
  const seats = new Map();       // seatId → { seatId, name, mod, sleight }
  let state = null, phase = 'lobby', lobbyTimer = null, timers = [], cheated = new Set(), waitingSince = new Map();
  const lobbyMs = rules.lobbyMs ?? LOBBY_MS;
  const startsAt = now() + lobbyMs;

  const send = data => broadcast({ hostId: host.id, ...data });
  const lobby = () => send({ kind: 'lobby', startsAt, names: [...seats.values()].map(s => s.name) });

  function start() {
    if (phase !== 'lobby') return;
    if (!seats.size) { phase = 'done'; return; }
    phase = 'playing';
    const npcs = rules.npcs(setup, host).map(n => ({ ...n, npc: true, mod: 0 }));
    const heroes = [...seats.values()].map(s => ({ id: s.seatId, name: s.name, npc: false, mod: setup.statsHelp ? s.mod : 0 }));
    state = rules.create([...heroes, ...npcs], setup, rng);
    changed();
  }

  function changed(extra = {}) {
    timers.forEach(clearTimer); timers = [];
    send({ kind: 'state', state, ...extra });
    if (rules.over(state)) return finish();
    const ids = rules.toAct(state);
    if (!ids.length) { timers.push(setTimer(() => apply(null, null, true), state.delay ?? 1200)); return; }
    const t = now();
    for (const k of [...waitingSince.keys()]) if (!ids.includes(k)) waitingSince.delete(k);
    for (const id of ids) {
      const p = state.players.find(x => x.id === id);
      if (p?.npc) timers.push(setTimer(() => apply(id, rules.npc(state, id, rng)), 700 + rng() * 1100));
      else {
        if (!waitingSince.has(id)) waitingSince.set(id, t);
        timers.push(setTimer(() => apply(id, rules.auto(state, id, rng)), Math.max(0, TURN_MS - (t - waitingSince.get(id)))));
      }
    }
  }

  /** One action (or the house's step). Wrong-turn and illegal actions are dropped (the sender is told). */
  function apply(id, action, isStep = false) {
    if (phase !== 'playing') return;
    try {
      if (isStep) { if (rules.toAct(state).length) return; state = rules.step(state, rng); }
      else {
        if (!rules.toAct(state).includes(id)) throw new Error('Not your turn.');
        state = rules.act(state, id, action, rng);
        waitingSince.delete(id);
      }
    } catch (e) {
      if (id && seats.has(id)) send({ kind: 'refused', seatId: id, reason: e.message });
      return;
    }
    changed();
  }

  function finish() {
    phase = 'done';
    timers.forEach(clearTimer); timers = [];
    for (const s of seats.values()) {
      if (s.settled) continue;
      s.settled = true;
      settle(s.seatId, rules.outcome(state, s.seatId));
    }
  }

  function out(seatId, outcome) {
    const s = seats.get(seatId);
    if (!s || s.settled) return;
    s.settled = true;
    // Gone before the game began (could not pay, or walked off): no game was played, so nothing to log or count.
    settle(seatId, phase === 'lobby' ? { ...outcome, void: true } : outcome);
    if (phase === 'playing') { state = rules.forfeit(state, seatId); changed(); }
    else { seats.delete(seatId); lobby(); }
  }

  return {
    get phase() { return phase; },
    get state() { return state; },
    /** A hero sat down (the house said yes). Only while the lobby is open. */
    addSeat(seat) {
      if (phase !== 'lobby') return false;
      seats.set(seat.seatId, { seatId: seat.seatId, name: seat.name, mod: seat.mod || 0, sleight: seat.sleight || 0 });
      if (!lobbyTimer) lobbyTimer = setTimer(start, lobbyMs);
      lobby();
      return true;
    },
    /** A hero left (could not pay, walked away): their bet is lost. */
    leave(seatId) { out(seatId, { won: false }); },
    /** A message from a hero at this table. */
    onMessage(seatId, data) {
      if (!seats.has(seatId) || !data) return;
      if (data.kind === 'hello') { if (phase === 'lobby') lobby(); else send({ kind: 'state', state }); return; }
      if (data.kind === 'act') return apply(seatId, data.action);
      if (data.kind === 'cheat' && phase === 'playing' && setup.cheating && !cheated.has(seatId)) {
        cheated.add(seatId);
        const d20 = 1 + Math.floor(rng() * 20);
        const res = cheatCheck(d20, seats.get(seatId).sleight, hostPerception(setup, actor));
        send({ kind: 'cheated', seatId, d20, ...res });
        if (res.caught) out(seatId, { won: false, caught: true });
        else { state = rules.cheat(state, seatId, rng); changed(); }
      }
    },
    startNow: start,
    close() { phase = 'done'; timers.forEach(clearTimer); if (lobbyTimer) clearTimer(lobbyTimer); },
  };
}
