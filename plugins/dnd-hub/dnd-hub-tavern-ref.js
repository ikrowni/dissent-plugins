// dnd-hub-tavern-ref.js — the DM's Hub as the house: it seats heroes, counts their games, and pays them.
//
// Runs only on the DM's screen. A player's Hub asks to sit (`tavern:sit`), the house checks it against the DM's
// setup and answers (`tavern:seated`); when the game ends (`tavern:result`) the house settles it with
// lk-tavern.js `settle` and pays (`tavern:payout`, to the hero's sheet). The sender is the node's sender_id
// (dnd-hub-events.js onEvent), so a hero can only sit, leave or report for themselves.
import { MAP, serverData } from './dnd-hub-state.js?v=20261014e';
import { localPublish } from '../plugin-sdk.js';
import { publishTo } from './lk-bus.js';
import { PLAYABLE, stakeProblem, settle, gameType } from './lk-tavern.js';
import { openTavernData, setupFor, setBusy } from './dnd-hub-tavern.js?v=20261014e';
import { showTriggerToast } from './dnd-hub-triggers.js?v=20261014e';

let _ref = null; // { tavernId, seats: { seatId: {...} }, plays: { 'user:setup': n }, out: Set<userId> }

export function refereeOpen(tavernId) {
  _ref = { tavernId, seats: {}, plays: {}, out: new Set() };
  announceBusy();
}
export function refereeClose() {
  // Anyone still mid-game when the DM closes up has lost their bet (they were told by the close itself).
  _ref = null;
}

const tell = (type, data) => publishTo(type === 'tavern:payout' ? ['player'] : [], type, { type, campaignId: MAP.campaignId, ...data });
const log = message => localPublish('dnd-master', 'tavern:log', { type: 'tavern:log', campaignId: MAP.campaignId, message });
const heroName = (userId, fallback) => fallback || serverData?.campaigns?.[MAP.campaignId]?.characters?.[userId]?.name || 'A hero';

function announceBusy() {
  if (!_ref) return;
  const busy = {};
  for (const s of Object.values(_ref.seats)) (busy[s.hostId] ||= []).push(s.name);
  setBusy(busy);
  tell('tavern:busy', { busy });
}

/** Why this hero may not sit at this host's table now; null when they may. */
function refusal(p, host, setup) {
  if (!host || !setup) return 'That table is empty tonight.';
  if (!PLAYABLE.has(setup.type)) return 'This game is not ready to play yet.';
  if (_ref.out.has(p.fromUserId)) return 'You\'ve been thrown out of here. Not tonight.';
  if (Object.values(_ref.seats).some(s => s.userId === p.fromUserId)) return 'You\'re already at a table.';
  const played = _ref.plays[`${p.fromUserId}:${setup.id}`] || 0;
  if (setup.playsPerVisit && played >= setup.playsPerVisit) return 'You\'ve had your games for tonight, friend.';
  return stakeProblem(setup, p.stake, null);
}

export async function refereeEvent(p) {
  if (!_ref || !p.fromUserId) return;
  switch (p.type) {
    case 'tavern:sit': {
      if (p.tavernId !== _ref.tavernId) return tell('tavern:seated', { seatId: p.seatId, userId: p.fromUserId, ok: false, reason: 'That tavern has closed.' });
      const host = openTavernData()?.hosts.find(h => h.id === p.hostId);
      const setup = setupFor(host);
      const reason = refusal(p, host, setup);
      if (reason) return tell('tavern:seated', { seatId: p.seatId, userId: p.fromUserId, ok: false, reason });
      _ref.seats[p.seatId] = { seatId: p.seatId, userId: p.fromUserId, name: heroName(p.fromUserId, p.name), hostId: host.id,
        setupId: setup.id, stake: p.stake };
      tell('tavern:seated', { seatId: p.seatId, userId: p.fromUserId, ok: true });
      announceBusy();
      return;
    }
    case 'tavern:leave': {
      const seat = _ref.seats[p.seatId];
      if (seat?.userId !== p.fromUserId) return;
      delete _ref.seats[p.seatId];
      announceBusy();
      return;
    }
    case 'tavern:result': {
      const seat = _ref.seats[p.seatId];
      if (seat?.userId !== p.fromUserId) return;
      delete _ref.seats[p.seatId];
      const host = openTavernData()?.hosts.find(h => h.id === seat.hostId);
      const setup = setupFor(host);
      if (!setup) { announceBusy(); return; }
      _ref.plays[`${seat.userId}:${setup.id}`] = (_ref.plays[`${seat.userId}:${setup.id}`] || 0) + 1;
      const caught = !!p.caught;
      const { gold, itemId } = settle(setup, { stake: seat.stake, won: p.won === 'draw' ? 'draw' : p.won === true, multiplier: p.multiplier, caught });
      const thrownOut = caught && setup.caught !== 'forfeit';
      if (thrownOut) _ref.out.add(seat.userId);
      const itemName = itemId ? serverData?.campaigns?.[MAP.campaignId]?.items?.[itemId]?.name || null : null;
      tell('tavern:payout', { seatId: seat.seatId, userId: seat.userId, gold, itemId, itemName, thrownOut });
      const game = gameType(setup.type)?.name || 'a game';
      log(caught ? `${seat.name} was caught cheating at ${game} with ${host.name} (bet ${seat.stake} gp lost)`
        : p.walkedAway ? `${seat.name} walked away from ${game} (bet ${seat.stake} gp lost)`
        : gold ? `${seat.name} won ${gold} gp${itemName ? ` and ${itemName}` : ''} at ${game} (bet ${seat.stake} gp)`
        : `${seat.name} lost ${seat.stake} gp at ${game} with ${host.name}`);
      if (caught && setup.caught === 'brawl') showTriggerToast(`🍺 Brawl! ${seat.name} was caught cheating at ${host.name}'s table.`);
      announceBusy();
    }
  }
}
