// plugins/dnd-hub/dnd-hub-rules.js — pure gameplay rules, kept free of Pixi and storage
// so they can be tested.
import { defaultSettings } from './lk-table-rules.js';
import { attackOutcome } from './lk-rules5e.js';

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

/**
 * Where a dropped token's centre lands on one axis. Odd-sized tokens (1×1, 3×3) sit
 * centred in the cell under the pointer; even-sized ones (2×2, 4×4) centre on the
 * nearest grid corner.
 * 🔴 Used to be round(...)*gs + gs/2 for medium tokens: that rounds to the nearest
 * CORNER and then adds half a cell, so about half of all drops landed in the next cell.
 */
export function snapToGrid(v, offset, gs, cells) {
  const n = Math.max(1, Math.round(cells)); // tiny (0.5) occupies a cell like medium
  return n % 2 === 1
    ? Math.floor((v - offset) / gs) * gs + gs / 2 + offset
    : Math.round((v - offset) / gs) * gs + offset;
}

/** The shape of a player's token. One builder for DM seeding and self-placement. */
export function newPlayerToken(uid, summary, idx, x, y, colorCount) {
  return {
    id: `player_${uid}`, type: 'player', userId: uid,
    name: summary?.name || 'Unknown',
    x, y,
    visionRadius: 60,
    hp: summary?.hp || 10, hpMax: summary?.hpMax || 10,
    conditions: [], visible: true, colorIdx: Math.max(0, idx) % colorCount,
    portraitUrl:    summary?.portraitUrl    || '',
    portraitFileId: summary?.portraitFileId || '',
  };
}

/**
 * What "Place token" does for a player: move their token, create it if it was never
 * placed on this map (the DM may not have opened the map since they joined), or refuse
 * if the DM removed it. Before, it silently did nothing whenever the token was missing.
 */
export function placeOwnTokenVerdict(mapData, uid) {
  if (mapData.tokens?.[`player_${uid}`]) return 'move';
  return mapData.seededPlayers?.[uid] ? 'removed-by-dm' : 'create';
}

/**
 * Fog opacity for a cell. 🔴 The DM used to get the players' solid black fog, so a new
 * DM's own map was black until they revealed it or found the Fog button. The DM now sees
 * the whole map with fog as a tint, which also shows them what the players cannot see.
 */
export function fogAlpha(state, isDM) {
  if (state === 'visible') return 0;
  if (isDM) return state === 'explored' ? 0.2 : 0.45;
  return state === 'explored' ? 0.55 : 1;
}
/** A new campaign's record — one shape for "Start New Campaign" and the sample adventure. */
export function campaignRecord({ id, name, description = '', dmUserId, dmDisplayName = 'Unknown DM',
  visibility = 'open', maxPlayers = 4, startingLevel = 1, now = new Date().toISOString() }) {
  return {
    id, name, description, dmUserId, dmDisplayName,
    visibility, autoAccept: visibility === 'open', maxPlayers, startingLevel,
    currentLevel: startingLevel, members: [], joinRequests: [],
    status: 'active', createdAt: now, updatedAt: now,
    maps: {}, sessions: [], history: [], handouts: [],
    storyRecap: '', xpSystem: 'milestone', partyXP: 0,
    library: { monsters: {}, spells: {}, items: {}, subclasses: {} },
    dmNotes: '', activeMapId: null, initiative: null, encounters: {},
    journals: {}, items: {}, scenes: {},
    settings: defaultSettings(),
  };
}

/** Where the i-th player's token is first placed: along a row from the map's start cell. */
export function seedCell(mapData, i) {
  const s = mapData?.startCell;
  return s ? { cx: s.cx + i, cy: s.cy } : { cx: 2 + i * 2, cy: 3 };
}

/**
 * Should a received token move be applied? 🔴 The node echoes a plugin's own realtime events back to the
 * screen that sent them, and the live-drag move and the final snapped move travel as separate requests, so
 * they can arrive in either order. A late live-drag echo used to overwrite the dragger's own snapped position
 * (audit O6, 2 runs in 7). Drop my own echoes and anything older than the last move applied from that screen.
 * `seen` is { "<token>|<client>": seq }, updated in place.
 */
export function acceptMove(seen, p, myClientId) {
  if (!p.clientId || p.seq == null) return true;
  if (p.clientId === myClientId) return false;
  const k = `${p.tokenId}|${p.clientId}`;
  if (seen[k] != null && p.seq <= seen[k]) return false;
  seen[k] = p.seq;
  return true;
}

/**
 * Hit or miss for one attack roll against each target. `natural` is the d20 as rolled (a 20 always hits and is a
 * critical, a 1 always misses). Null with no target. Decided on the attacker's screen, shown on every screen.
 */
export function attackVerdict(targets, natural, total) {
  if (!targets?.length) return null;
  const rows = targets.map(t => {
    const ac = t.ac ?? 10;
    return { id: t.id, name: t.name, ac, hit: attackOutcome(natural, total, ac).hit };
  });
  const crit = natural === 20;
  const tail = crit ? ' — CRITICAL HIT, roll the damage dice twice' : natural === 1 ? ' — a natural 1 misses' : '';
  return {
    text: rows.map(r => `${r.name}: ${r.hit ? 'HIT' : 'MISS'} (AC ${r.ac})`).join(' | ') + tail,
    hitIds: rows.filter(r => r.hit).map(r => r.id),
    crit,
  };
}

/** The token whose turn it is in the DM's tracker, or null while it waits for rolls or no fight is on. */
export function activeTokenId(init) {
  if (!init?.active || init.waiting) return null;
  const c = init.order?.[init.currentIndex || 0];
  if (!c) return null;
  return c.type === 'player' ? `player_${c.userId}` : c.id;
}
