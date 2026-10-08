// dnd-hub-zone-pos.js — tells my own player sheet where my token stands, in grid squares, for sound zones.
// Sound zones are stored in squares (x, y, radius: dnd-hub-audio-zones.js), and the sheet plays them. It used to be
// sent the token's map position in pixels and compared it with the zone's squares, so a player heard a zone only
// within a few pixels of its centre: in practice never (rules playtest, 2026-10-04).
import { MAP, userId, effectiveGs } from './dnd-hub-state.js?v=20261015x';
import { localPublish } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20261015x';

/** Map position (px) → squares, the way a sound zone's centre is stored. Pure apart from MAP. */
export function toSquares(x, y, md = MAP.mapData) {
  const gs = effectiveGs(md);
  const ox = (MAP._bgOffset?.x ?? 0) + (md?.gridOffsetX || 0), oy = (MAP._bgOffset?.y ?? 0) + (md?.gridOffsetY || 0);
  return { x: (x - ox) / gs, y: (y - oy) / gs };
}

/** Send my sheet my token's place (`at` = a new position, else where the map has it). */
export function tellSheetWhereIAm(at = null) {
  if (MAP.isDM || !MAP.mapData || !userId) return;
  const id = `player_${userId}`;
  const t = at || MAP.mapData.tokens?.[id];
  if (!t || t.x == null) return;
  localPublish('dnd-player', EV.TOKEN_MOVE, { type: EV.TOKEN_MOVE, campaignId: MAP.campaignId, mapId: MAP.mapId,
    tokenId: id, x: t.x, y: t.y, cell: toSquares(t.x, t.y) });
}
