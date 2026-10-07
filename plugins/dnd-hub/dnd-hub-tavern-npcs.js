// dnd-hub-tavern-npcs.js — the NPCs who talk and run games: who they are, whether their token stands on this map,
// and whether a hero is close enough to talk.
//
// Who they are comes from the DM's sidebar (`tavern:npcs`, sent whenever an NPC or a game setup changes, and with
// `tavern:open`), else from this screen's copy of the campaign — which can be older than the sidebar's edits.
import { MAP, serverData, effectiveGs } from './dnd-hub-state.js?v=20261015h';
import { talkingNpcs, npcTokenId, withinTalkRange, cleanSetup } from './lk-tavern.js';

let _sent = null; // { npcs, setups } as the DM's sidebar last sent them

export function setNpcTalk(p) {
  if (p?.npcs && typeof p.npcs === 'object') _sent = { npcs: p.npcs, setups: p.setups && typeof p.setups === 'object' ? p.setups : {} };
}
const campaign = () => serverData?.campaigns?.[MAP.campaignId];

/** The NPC as a host ({ id, actorId, name, greeting, portraitFileId, setupId, wis }), or null when they don't talk. */
export function talkFor(actorId) {
  if (!actorId) return null;
  return _sent?.npcs?.[actorId] || talkingNpcs(campaign()).npcs[actorId] || null;
}

/** The game setup a host runs, cleaned, or null. */
export function setupOf(host) {
  const s = host?.setupId && (_sent?.setups?.[host.setupId] || campaign()?.gameSetups?.[host.setupId]);
  return s ? cleanSetup(s) : null;
}

/** The NPC's stats for the house (passive Perception): the campaign's actor, else what the host carries. */
export const actorOf = host => (host ? campaign()?.customActors?.[host.actorId] || { wis: host.wis ?? 10 } : null);

/** The NPC's token on this map, when it stands here and is not hidden. */
export function npcTokenHere(actorId) {
  const t = MAP.mapData?.tokens?.[npcTokenId(actorId)];
  return t && t.visible !== false ? t : null;
}

/** Is this user's hero (their placed token) close enough to the NPC to talk? */
export function heroInReach(uid, actorId) {
  const hero = MAP.mapData?.tokens?.[`player_${uid}`];
  return !!hero && !hero.waiting && withinTalkRange(hero, npcTokenHere(actorId), effectiveGs(MAP.mapData));
}
