// dnd-hub-pin-travel.js — travel pins: a map pin that opens one of the DM's scenes (owner requests 2026-10-04).
// Pure rules, no DOM. The DM's screen is the only one that loads a scene: a player's click is a request, and the
// DM's Hub checks it here before doing anything (scene:load stays DM-only in dnd-hub-events.js).
//
// A pin carries `sceneId` (opaque: scenes are a DM secret, so players never see the scene's name, only the pin's),
// `travel` ('dm' | 'all' | 'some') and `travelers` (user ids, for 'some').

export const TRAVEL_MODES = ['dm', 'all', 'some'];

/** Whether `uid` may use `pin` to change the scene. The DM always may; a player only on a pin shared with players. */
export function canTravel(pin, uid, dmUserId) {
  if (!pin?.sceneId || !uid) return false;
  if (dmUserId && uid === dmUserId) return true;
  if (pin.visible !== 'all') return false;
  if (pin.travel === 'all') return true;
  if (pin.travel === 'some') return Array.isArray(pin.travelers) && pin.travelers.includes(uid);
  return false;
}

/** The travel fields of a pin, cleaned: an unknown mode is DM only, travellers only for 'some'. */
export function travelFields({ sceneId, travel, travelers } = {}) {
  if (!sceneId) return { sceneId: null, travel: 'dm', travelers: [] };
  const mode = TRAVEL_MODES.includes(travel) ? travel : 'dm';
  const who = mode === 'some' && Array.isArray(travelers) ? [...new Set(travelers.filter(x => typeof x === 'string' && x))] : [];
  return { sceneId: String(sceneId), travel: mode === 'some' && !who.length ? 'dm' : mode, travelers: who };
}

/** Who a pin lets travel, in words, for the DM's pin menu. `nameOf(uid)` gives a player's name. */
export function travelSummary(pin, nameOf = id => id) {
  if (!pin?.sceneId) return '';
  if (pin.visible !== 'all' || pin.travel === 'dm' || !pin.travel) return 'Only you can travel with it';
  if (pin.travel === 'all') return 'Every player can travel with it';
  return 'These players can travel with it: ' + (pin.travelers || []).map(nameOf).join(', ');
}

// One player's clicks cannot flick everyone's map back and forth: a request within this many ms of the last
// accepted travel is dropped.
export const TRAVEL_COOLDOWN_MS = 4000;
export const travelTooSoon = (lastAt, now = Date.now()) => !!lastAt && now - lastAt < TRAVEL_COOLDOWN_MS;
