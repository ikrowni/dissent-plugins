// dnd-hub-tavern-seat.js — a hero at a table: sitting down, paying, playing the game, and being paid.
//
//   my Hub ──tavern:sit──▶ DM's Hub   (checks the tavern is open, the bet, the plays left, not thrown out)
//   my Hub ◀─tavern:seated── DM's Hub
//   my Hub ──tavern:pay──▶ my sheet   (local: takes bet + entry fee from my purse, or says no)
//   my Hub ◀─tavern:paid── my sheet
//   …the game plays here (dnd-hub-tavern-games.js)…
//   my Hub ──tavern:result──▶ DM's Hub ──tavern:payout──▶ my sheet (adds the winnings) and my Hub (shows them)
//
// The DM's Hub decides what a result pays (lk-tavern.js settle, from the DM's setup), so a screen that lies about
// its result still cannot pay itself more than the DM's own odds. Every wait gives up after a few seconds.
import { MAP, userId, serverData } from './dnd-hub-state.js?v=20261015j';
import { localPublish } from '../plugin-sdk.js';
import { publishTo } from './lk-bus.js';
import { gameType, statEdge, cheatCheck, hostPerception } from './lk-tavern.js';
import { medal, actorFor } from './dnd-hub-tavern.js?v=20261015j';
import { myHero } from './dnd-hub-tavern-talk.js?v=20261015j';
import { loadGame } from './dnd-hub-tavern-games.js?v=20261015j';
import { animateDiceFree } from './dnd-hub-dice.js?v=20261015j';
import { myLook } from './dnd-hub-dice-look.js';

const HOUSE_KINDS = new Set(['lobby', 'state', 'cheated', 'refused']);
const _waiting = new Map();   // `${type}:${seatId}` → resolve
let _seat = null;             // { seatId, host, setup, stake, abort, listeners }

const wait = (type, seatId, ms = 8000) => new Promise(res => {
  const key = `${type}:${seatId}`;
  const t = setTimeout(() => { _waiting.delete(key); res(null); }, ms);
  _waiting.set(key, p => { clearTimeout(t); _waiting.delete(key); res(p); });
});
const newSeatId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const send = (type, data) => publishTo([], type, { type, campaignId: MAP.campaignId, fromUserId: userId, ...data });

export async function onSeatEvent(p) {
  if (p.type === 'tavern:game') {
    if (!_seat || p.hostId !== _seat.host.id) return;
    // What the house says (the table's state, who cheated) counts only from the DM's Hub: the node stamps the sender.
    if (HOUSE_KINDS.has(p.data?.kind) && p.fromUserId !== serverData?.campaigns?.[MAP.campaignId]?.dmUserId) return;
    _seat.listeners.forEach(f => f(p.data, p));
    return;
  }
  if (p.userId && p.userId !== userId) return;
  _waiting.get(`${p.type}:${p.seatId}`)?.(p);
}

/** Sit at `host`'s table with this bet. True when the game is on, else what to tell the player. */
export async function sit(host, setup, stake) {
  if (_seat) return 'Finish the game you are in first.';
  const seatId = newSeatId();
  const hero = myHero();
  const seatedP = wait('tavern:seated', seatId); // listening before asking: the answer can be quick
  const g = gameType(setup.type);
  send('tavern:sit', { hostId: host.id, stake, seatId, name: hero?.name || '',
    // a whole-table game is played on the DM's Hub, which needs the hero's numbers (their own sheet's word)
    hero: { mod: hero?.mods?.[g?.stat] ?? 0, sleight: hero?.skills?.['Sleight of Hand'] ?? hero?.mods?.dex ?? 0 } });
  const seated = await seatedP;
  if (!seated) return 'The house isn\'t answering. (The DM\'s map has to be open.)';
  if (!seated.ok) return seated.reason || 'Not tonight, friend.';
  const paidP = wait('tavern:paid', seatId);
  localPublish('dnd-player', 'tavern:pay', { type: 'tavern:pay', seatId, campaignId: MAP.campaignId,
    amount: stake + setup.entryFee, what: `${gameType(setup.type)?.name} with ${host.name}` });
  const paid = await paidP;
  if (!paid?.ok) {
    send('tavern:leave', { seatId });
    return paid?.reason || 'Your sheet didn\'t answer: open your character sheet so you can pay.';
  }
  playAt(host, setup, stake, seatId).catch(e => { console.error('[tavern] game failed', e); leaveTable(); });
  return true;
}

/** Leave the table at once (the tavern closed, or I walked off): the bet is lost. */
export function leaveTable() {
  if (!_seat) return;
  const s = _seat;
  _seat = null;
  s.abort.abort();
  send('tavern:result', { seatId: s.seatId, won: false, walkedAway: true });
  document.getElementById('lk-tavern-game')?.remove();
}

/** The NPC (actor id) whose table I am at, or null. */
export const seatedAt = () => _seat?.host.id || null;

async function playAt(host, setup, stake, seatId) {
  const g = gameType(setup.type);
  const hero = myHero() || { mods: {}, skills: {}, name: '' };
  const abort = new AbortController();
  _seat = { seatId, host, setup, stake, abort, listeners: new Set() };
  const { table, body, bark } = await buildTable(host, g, stake);
  const actor = actorFor(host);
  const ctx = {
    setup, host, actor, hero, stake, seatId, signal: abort.signal,
    edge: statEdge(setup, hero.mods?.[g.stat] ?? 0),
    say: bark,
    rollD20: async () => (await animateDiceFree(20, 1, myLook()))[0],
    /** A cheat attempt: null when this table doesn't allow it, else { caught, total, perception }. */
    tryCheat: async () => {
      if (!setup.cheating) return null;
      const [d20] = await animateDiceFree(20, 1, myLook());
      const sleight = hero.skills?.['Sleight of Hand'] ?? hero.mods?.dex ?? 0;
      return cheatCheck(d20, sleight, hostPerception(setup, actor));
    },
    me: seatId, // a hero's id in a whole-table game's state
    /** A condition the game leaves on the hero (Last One Standing: Poisoned): told to my own sheet, which keeps it. */
    condition: name => localPublish('dnd-player', 'tavern:condition', { type: 'tavern:condition', campaignId: MAP.campaignId, condition: name }),
    send: data => send('tavern:game', { seatId, hostId: host.id, data }),
    onMessage: fn => { _seat?.listeners.add(fn); },
  };
  // Listening for the payout from the start: a whole-table game is settled by the house the moment it ends,
  // which can be before this screen has finished drawing the last move.
  const payoutP = wait('tavern:payout', seatId, 30 * 60000);
  const game = await loadGame(setup.type);
  const outcome = await game.play(body, ctx);
  if (_seat?.seatId !== seatId) return; // walked away meanwhile
  if (g.mode !== 'table') send('tavern:result', { seatId, won: outcome?.won ?? false, multiplier: outcome?.multiplier ?? null, caught: !!outcome?.caught });
  const payout = await Promise.race([payoutP, new Promise(r => setTimeout(() => r(null), 10000))]);
  showResult(body, { ...outcome, caught: outcome?.caught || payout?.caught }, payout, () => { _seat = null; table.remove(); });
}

async function buildTable(host, g, stake) {
  const wrap = document.getElementById('map-canvas-wrap');
  document.getElementById('lk-tavern-game')?.remove();
  const table = document.createElement('div');
  table.id = 'lk-tavern-game';
  table.innerHTML = '<div class="tv-head"><b></b><span class="tv-bark" aria-live="polite" style="font-size:12px;font-style:italic;color:var(--lk-text)"></span>' +
    '<span class="tv-pot"></span><button class="tv-btn" title="Leave the table: your bet is lost">Leave</button></div><div class="tv-body"></div>';
  table.querySelector('.tv-head').prepend(await medal(host));
  table.querySelector('b').textContent = `${g.name} · ${host.name}`;
  table.querySelector('.tv-pot').textContent = `Your bet: ${stake} gp`;
  table.querySelector('.tv-head .tv-btn').onclick = () => { if (confirm('Leave the table? Your bet is lost.')) leaveTable(); };
  wrap.appendChild(table);
  const barkEl = table.querySelector('.tv-bark');
  return { table, body: table.querySelector('.tv-body'), bark: text => { barkEl.textContent = text ? `“${text}”` : ''; } };
}

function showResult(body, outcome, payout, done) {
  const won = outcome?.won === true, draw = outcome?.won === 'draw';
  const el = document.createElement('div');
  el.className = 'tv-result' + (won || draw ? '' : ' lose');
  const gold = payout?.gold ?? 0;
  const title = outcome?.caught ? 'Caught cheating!' : won ? 'You win!' : draw ? 'A draw' : 'The house wins';
  const text = !payout ? 'The house is counting… your winnings will reach your sheet.'
    : gold ? `${gold} gold to your purse${payout.itemName ? `, and ${payout.itemName}` : ''}.`
    : outcome?.caught && payout.thrownOut ? 'You are shown the door.' : 'Better luck next time.';
  el.innerHTML = '<div><h2></h2><p></p><button class="tv-btn primary">Back to the map</button></div>';
  el.querySelector('h2').textContent = title;
  el.querySelector('p').textContent = text;
  el.querySelector('button').onclick = done;
  body.appendChild(el);
  el.querySelector('button').focus();
}
