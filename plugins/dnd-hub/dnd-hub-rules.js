// plugins/dnd-hub/dnd-hub-rules.js — pure gameplay rules, kept free of Pixi and storage
// so they can be tested.

/**
 * Player ids that need a token placed on this map. Only the DM's client calls this.
 * 🔴 Every client used to re-create any missing player token on every redraw, so a token
 * the DM deleted came straight back. A player is seeded ONCE per map; deleting the token
 * afterwards sticks. The DM's "Party" button clears the flag to re-place them.
 */
export function playerTokensToSeed(campaign, mapData) {
  const seeded = mapData.seededPlayers || {};
  const summaries = campaign.characterSummaries || {};
  return (campaign.members || []).filter(uid =>
    summaries[uid] && !seeded[uid] && !mapData.tokens?.[`player_${uid}`]);
}

/** Where a dragged token should be shown: the pointer, unless that crosses a wall. */
export function dragStep(lastValid, target, crosses) {
  if (crosses(lastValid.x, lastValid.y, target.x, target.y)) return { ...lastValid, blocked: true };
  return { x: target.x, y: target.y, blocked: false };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** The door (never a window) within `radius` of a point, measured to the whole segment. */
export function findDoorAt(doors, wx, wy, radius, toPx) {
  let best = null, bestD = radius;
  for (const d of Object.values(doors || {})) {
    if (d.isWindow) continue;
    const p = toPx(d);
    const dist = distToSegment(wx, wy, p.x1, p.y1, p.x2, p.y2);
    if (dist <= bestD) { best = d; bestD = dist; }
  }
  return best;
}

export function nextDoorState(state, isDM) {
  if (isDM) return ({ closed: 'open', open: 'locked', locked: 'closed' })[state] || 'closed';
  if (state === 'locked') return 'locked';
  return state === 'open' ? 'closed' : 'open';
}

export function playerMayToggleDoor(door, playerToken, gs, toPx) {
  if (!playerToken || door.state === 'locked') return false;
  const p = toPx(door);
  return distToSegment(playerToken.x, playerToken.y, p.x1, p.y1, p.x2, p.y2) <= gs * 1.5;
}
