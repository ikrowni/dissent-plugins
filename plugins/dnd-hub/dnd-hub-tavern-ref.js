// dnd-hub-tavern-ref.js — the DM's Hub as the house: it seats heroes, counts their games, and pays them.
//
// Runs only on the DM's screen, on any map: an NPC runs a game wherever their token stands (owner, 2026-10-07). A
// player's Hub asks to sit (`tavern:sit`); the house checks the NPC is on this map, the hero is in reach, and the bet
// against the DM's setup, and answers (`tavern:seated`). When the game ends (`tavern:result`) the house settles it
// with lk-tavern.js `settle` — from the setup the seat was taken under — and pays (`tavern:payout`, to the hero's
// sheet). The sender is the node's sender_id (dnd-hub-events.js onEvent), so a hero only sits or reports for themselves.
import { MAP, serverData } from './dnd-hub-state.js?v=20261015c';
import { localPublish } from '../plugin-sdk.js';
import { publishTo } from './lk-bus.js';
import { PLAYABLE, stakeProblem, settle, gameType } from './lk-tavern.js';
import { setBusy } from './dnd-hub-tavern.js?v=20261015c';
import { talkFor, setupOf, actorOf, npcTokenHere, heroInReach } from './dnd-hub-tavern-npcs.js?v=20261015c';
import { tableFor, tableAt, closeTables } from './dnd-hub-tavern-table.js?v=20261015c';
import { showTriggerToast } from './dnd-hub-triggers.js?v=20261015c';

let _ref = null; // { seats: { seatId: {...} }, plays: { 'user:actor': n }, out: Set<userId> }
const house = () => (_ref ||= { seats: {}, plays: {}, out: new Set() });

/** A tavern was loaded: a fresh visit (plays a visit and who was thrown out start over). */
export function refereeOpen() {
  closeTables();
  _ref = { seats: {}, plays: {}, out: new Set() };
  announceBusy();
}
/** The tavern closed: games in progress end (their heroes were told by the close itself). */
export function refereeClose() {
  closeTables();
  _ref = null;
  announceBusy();
}

const tell = (type, data) => publishTo(type === 'tavern:payout' ? ['player'] : [], type, { type, campaignId: MAP.campaignId, ...data });
const log = message => localPublish('dnd-master', 'tavern:log', { type: 'tavern:log', campaignId: MAP.campaignId, message });
const heroName = (userId, fallback) => fallback || serverData?.campaigns?.[MAP.campaignId]?.characters?.[userId]?.name || 'A hero';

function announceBusy() {
  const busy = {}, users = {}; // names to show; user ids to tell who is at a table (two heroes can share a name)
  for (const s of Object.values(_ref?.seats || {})) { (busy[s.hostId] ||= []).push(s.name); (users[s.hostId] ||= []).push(s.userId); }
  setBusy(busy, users);
  tell('tavern:busy', { busy, users });
}

/** Why this hero may not sit at this NPC's table now; null when they may. */
function refusal(p, host, setup) {
  if (!host || !setup || !npcTokenHere(host.actorId)) return 'That table is empty tonight.';
  if (!PLAYABLE.has(setup.type)) return 'This game is not ready to play yet.';
  if (!heroInReach(p.fromUserId, host.actorId)) return 'Walk over to the table first, friend.';
  const h = house();
  if (h.out.has(p.fromUserId)) return 'You\'ve been thrown out of here. Not tonight.';
  if (Object.values(h.seats).some(s => s.userId === p.fromUserId)) return 'You\'re already at a table.';
  const played = h.plays[`${p.fromUserId}:${host.actorId}`] || 0;
  if (setup.playsPerVisit && played >= setup.playsPerVisit) return 'You\'ve had your games for tonight, friend.';
  return stakeProblem(setup, p.stake, null);
}

export async function refereeEvent(p) {
  if (!p.fromUserId) return;
  const h = house();
  switch (p.type) {
    case 'tavern:sit': {
      const no = reason => tell('tavern:seated', { seatId: p.seatId, userId: p.fromUserId, ok: false, reason });
      const host = talkFor(p.hostId);
      const setup = setupOf(host);
      const reason = refusal(p, host, setup);
      if (reason) return no(reason);
      const seat = { seatId: p.seatId, userId: p.fromUserId, name: heroName(p.fromUserId, p.name), hostId: host.id,
        hostName: host.name, setup, stake: p.stake, table: gameType(setup.type)?.mode === 'table' };
      if (seat.table) {
        // A whole-table game: the hero joins the open lobby, or waits for the next game.
        const runner = await tableFor(host, setup, actorOf(host), (seatId, outcome) => settleSeat(seatId, outcome));
        if (!runner.addSeat({ seatId: p.seatId, name: seat.name, mod: Number(p.hero?.mod) || 0, sleight: Number(p.hero?.sleight) || 0 })) {
          return no('A game is under way at this table. Wait for the next one, friend.');
        }
      }
      h.seats[p.seatId] = seat;
      tell('tavern:seated', { seatId: p.seatId, userId: p.fromUserId, ok: true });
      announceBusy();
      return;
    }
    case 'tavern:leave': {
      const seat = h.seats[p.seatId];
      if (seat?.userId !== p.fromUserId) return;
      if (seat.table) { tableAt(seat.hostId)?.leave(seat.seatId); return; } // the runner settles it (bet lost)
      delete h.seats[p.seatId];
      announceBusy();
      return;
    }
    case 'tavern:game': {
      // A hero's move at a whole-table game: only from the hero in that seat.
      const seat = h.seats[p.seatId];
      if (seat?.userId !== p.fromUserId || !seat.table) return;
      tableAt(seat.hostId)?.onMessage(seat.seatId, p.data);
      return;
    }
    case 'tavern:result': {
      const seat = h.seats[p.seatId];
      if (seat?.userId !== p.fromUserId) return;
      // A whole-table game is settled by its runner, never by a hero's screen; walking away still loses the bet.
      if (seat.table) { if (p.walkedAway) tableAt(seat.hostId)?.leave(seat.seatId); return; }
      settleSeat(seat.seatId, { won: p.won, multiplier: p.multiplier, caught: !!p.caught, walkedAway: !!p.walkedAway });
    }
  }
}

/** Pay out one seat from the setup it sat down under (lk-tavern.js settle), tell the hero and the DM's log. */
function settleSeat(seatId, { won = false, multiplier = null, caught = false, walkedAway = false, void: none = false } = {}) {
  const seat = _ref?.seats[seatId];
  if (!seat) return;
  delete _ref.seats[seatId];
  if (none) { announceBusy(); return; } // left a whole-table lobby before the game began
  const { setup } = seat;
  const key = `${seat.userId}:${seat.hostId}`;
  _ref.plays[key] = (_ref.plays[key] || 0) + 1;
  const { gold, itemId } = settle(setup, { stake: seat.stake, won: won === 'draw' ? 'draw' : won === true, multiplier, caught });
  const thrownOut = caught && setup.caught !== 'forfeit';
  if (thrownOut) _ref.out.add(seat.userId);
  const itemName = itemId ? serverData?.campaigns?.[MAP.campaignId]?.items?.[itemId]?.name || null : null;
  tell('tavern:payout', { seatId, userId: seat.userId, gold, itemId, itemName, thrownOut, caught });
  const game = gameType(setup.type)?.name || 'a game';
  log(caught ? `${seat.name} was caught cheating at ${game} with ${seat.hostName} (bet ${seat.stake} gp lost)`
    : walkedAway ? `${seat.name} walked away from ${game} (bet ${seat.stake} gp lost)`
    : gold ? `${seat.name} won ${gold} gp${itemName ? ` and ${itemName}` : ''} at ${game} (bet ${seat.stake} gp)`
    : `${seat.name} lost ${seat.stake} gp at ${game} with ${seat.hostName}`);
  if (caught && setup.caught === 'brawl') showTriggerToast(`🍺 Brawl! ${seat.name} was caught cheating at ${seat.hostName}'s table.`);
  announceBusy();
}
