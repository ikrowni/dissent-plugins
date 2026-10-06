// dnd-hub-tavern-ref.js — the DM's Hub as the house: it seats heroes, counts their games, and pays them.
//
// Runs only on the DM's screen. A player's Hub asks to sit (`tavern:sit`), the house checks it against the DM's
// setup and answers (`tavern:seated`); when the game ends (`tavern:result`) the house settles it with
// lk-tavern.js `settle` and pays (`tavern:payout`, to the hero's sheet). The sender is the node's sender_id
// (dnd-hub-events.js onEvent), so a hero can only sit, leave or report for themselves.
import { MAP, serverData } from './dnd-hub-state.js?v=20261014r';
import { localPublish } from '../plugin-sdk.js';
import { publishTo } from './lk-bus.js';
import { PLAYABLE, stakeProblem, settle, gameType } from './lk-tavern.js';
import { openTavernData, setupFor, setBusy, actorFor } from './dnd-hub-tavern.js?v=20261014r';
import { tableFor, tableAt, closeTables } from './dnd-hub-tavern-table.js?v=20261014r';
import { showTriggerToast } from './dnd-hub-triggers.js?v=20261014r';

let _ref = null; // { tavernId, seats: { seatId: {...} }, plays: { 'user:setup': n }, out: Set<userId> }

export function refereeOpen(tavernId) {
  closeTables();
  _ref = { tavernId, seats: {}, plays: {}, out: new Set() };
  announceBusy();
}
export function refereeClose() {
  // Anyone still mid-game when the DM closes up has lost their bet (they were told by the close itself).
  closeTables();
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
      const no = reason => tell('tavern:seated', { seatId: p.seatId, userId: p.fromUserId, ok: false, reason });
      if (p.tavernId !== _ref.tavernId) return no('That tavern has closed.');
      const host = openTavernData()?.hosts.find(h => h.id === p.hostId);
      const setup = setupFor(host);
      const reason = refusal(p, host, setup);
      if (reason) return no(reason);
      const seat = { seatId: p.seatId, userId: p.fromUserId, name: heroName(p.fromUserId, p.name), hostId: host.id,
        setupId: setup.id, stake: p.stake, table: gameType(setup.type)?.mode === 'table' };
      if (seat.table) {
        // A whole-table game: the hero joins the open lobby, or waits for the next game.
        const runner = await tableFor(host, setup, actorFor(host), (seatId, outcome) => settleSeat(seatId, outcome));
        if (!runner.addSeat({ seatId: p.seatId, name: seat.name, mod: Number(p.hero?.mod) || 0, sleight: Number(p.hero?.sleight) || 0 })) {
          return no('A game is under way at this table. Wait for the next one, friend.');
        }
      }
      _ref.seats[p.seatId] = seat;
      tell('tavern:seated', { seatId: p.seatId, userId: p.fromUserId, ok: true });
      announceBusy();
      return;
    }
    case 'tavern:leave': {
      const seat = _ref.seats[p.seatId];
      if (seat?.userId !== p.fromUserId) return;
      if (seat.table) { tableAt(seat.hostId)?.leave(seat.seatId); return; } // the runner settles it (bet lost)
      delete _ref.seats[p.seatId];
      announceBusy();
      return;
    }
    case 'tavern:game': {
      // A hero's move at a whole-table game: only from the hero in that seat.
      const seat = _ref.seats[p.seatId];
      if (seat?.userId !== p.fromUserId || !seat.table) return;
      tableAt(seat.hostId)?.onMessage(seat.seatId, p.data);
      return;
    }
    case 'tavern:result': {
      const seat = _ref.seats[p.seatId];
      if (seat?.userId !== p.fromUserId) return;
      // A whole-table game is settled by its runner, never by a hero's screen; walking away still loses the bet.
      if (seat.table) { if (p.walkedAway) tableAt(seat.hostId)?.leave(seat.seatId); return; }
      settleSeat(seat.seatId, { won: p.won, multiplier: p.multiplier, caught: !!p.caught, walkedAway: !!p.walkedAway });
    }
  }
}

/** Pay out one seat from the DM's setup (lk-tavern.js settle), tell the hero and the DM's log. */
function settleSeat(seatId, { won = false, multiplier = null, caught = false, walkedAway = false, void: none = false } = {}) {
  const seat = _ref?.seats[seatId];
  if (!seat) return;
  delete _ref.seats[seatId];
  if (none) { announceBusy(); return; } // left a whole-table lobby before the game began
  const host = openTavernData()?.hosts.find(h => h.id === seat.hostId);
  const setup = setupFor(host);
  if (!setup) { announceBusy(); return; }
  _ref.plays[`${seat.userId}:${setup.id}`] = (_ref.plays[`${seat.userId}:${setup.id}`] || 0) + 1;
  const { gold, itemId } = settle(setup, { stake: seat.stake, won: won === 'draw' ? 'draw' : won === true, multiplier, caught });
  const thrownOut = caught && setup.caught !== 'forfeit';
  if (thrownOut) _ref.out.add(seat.userId);
  const itemName = itemId ? serverData?.campaigns?.[MAP.campaignId]?.items?.[itemId]?.name || null : null;
  tell('tavern:payout', { seatId, userId: seat.userId, gold, itemId, itemName, thrownOut, caught });
  const game = gameType(setup.type)?.name || 'a game';
  log(caught ? `${seat.name} was caught cheating at ${game} with ${host.name} (bet ${seat.stake} gp lost)`
    : walkedAway ? `${seat.name} walked away from ${game} (bet ${seat.stake} gp lost)`
    : gold ? `${seat.name} won ${gold} gp${itemName ? ` and ${itemName}` : ''} at ${game} (bet ${seat.stake} gp)`
    : `${seat.name} lost ${seat.stake} gp at ${game} with ${host.name}`);
  if (caught && setup.caught === 'brawl') showTriggerToast(`🍺 Brawl! ${seat.name} was caught cheating at ${host.name}'s table.`);
  announceBusy();
}
