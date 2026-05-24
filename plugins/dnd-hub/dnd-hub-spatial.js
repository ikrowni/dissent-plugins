// dnd-hub-spatial.js — Phase 8: distance-based spatial audio
// updateSpatialAudio() is called on every token:move and map:set.
// It computes linear gain falloff from token positions and adjusts
// each remote participant's local playback volume via voice:setGain.
import { request } from '../plugin-sdk.js';
import { effectiveGs } from './dnd-hub-state.js?v=20260502p4';

/**
 * Recompute and apply spatial audio gains for all player tokens.
 *
 * @param {string}  myUserId  - Current user's Dissent userId
 * @param {object}  tokens    - MAP.mapData.tokens (keyed by tokenId)
 * @param {object}  mapData   - Active map object (for effectiveGs)
 * @param {string}  dmUserId  - Campaign DM's userId (always gain 1.0)
 * @param {number}  maxRange  - Max hearing range in feet (default 60)
 */
export async function updateSpatialAudio(myUserId, tokens, mapData, dmUserId, maxRange = 60) {
  const tokenArr = Object.values(tokens || {});
  const myToken = tokenArr.find(t => t.userId === myUserId);
  if (!myToken) return; // not on the map yet — nothing to adjust

  if (maxRange <= 0) return; // spatial audio disabled

  const gs = effectiveGs(mapData); // canvas pixels per 5ft square
  if (!gs) return; // can't compute distances without a valid grid size

  for (const t of tokenArr) {
    if (!t.userId || t.userId === myUserId) continue;

    let gain;
    if (t.userId === dmUserId || myUserId === dmUserId) {
      // DM always hears everyone, everyone always hears the DM
      gain = 1.0;
    } else {
      const dx = t.x - myToken.x;
      const dy = t.y - myToken.y;
      const feet = Math.sqrt(dx * dx + dy * dy) / gs * 5; // Euclidean (cinematic), not Chebyshev
      gain = Math.max(0, Math.min(1, 1 - feet / maxRange));
    }

    try {
      await request('voice:setGain', { userId: t.userId, gain });
    } catch {
      // Silently ignore — user may not be in a voice channel
    }
  }
}
