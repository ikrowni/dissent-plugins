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

/**
 * Where a new hero's token waits: just outside the map's left edge, one row per party member counted up from the
 * bottom (the DM's "Set the scene" card covers the top-left), until the DM drags it onto the map. A waiting token
 * cannot move and sees nothing (owner, 2026-10-05). It used to be put on the map at once, by the player on any
 * square the party had seen or by the DM's screen in a row near the top-left. `mapH` 0 (not known): from the top.
 */
export function waitingSpot(memberIdx, gs, mapH = 0) {
  const row = Math.max(0, memberIdx);
  return { x: -gs * 1.5, y: mapH > gs ? mapH - gs * (row + 0.5) : gs * (row + 0.5) };
}

/**
 * A player's "Place token": a tokens:spawn of exactly their own token, waiting beside the map. The one spawn a
 * player may send (spawns are otherwise the DM's), so the DM's screen hears it. 🔴 It used to be dropped as
 * privileged, so a token a player placed reached nobody until a reload. It must be waiting: a player can never
 * spawn themselves onto the map.
 */
export function isOwnWaitingSpawn(p) {
  const t = p?.tokens;
  return !!p?.fromUserId && !p.deleted && Array.isArray(t) && t.length === 1 && t[0]?.waiting === true
    && t[0].id === `player_${p.fromUserId}` && t[0].userId === p.fromUserId && t[0].type === 'player';
}

/**
 * A d100 from two d10s, tens and ones (the 10 face reads as 0); 00 and 0 is 100. It used to be five d20s added up,
 * which gives 5–100 bunched in the middle, not an even 1–100 (2026-10-05).
 */
export const percentile = (tensFace, onesFace) => ((tensFace % 10) * 10 + (onesFace % 10)) || 100;
/** The two d10 faces that show `result` (1–100). */
export const percentileFaces = result => [Math.floor(result / 10) % 10 || 10, result % 10 || 10];

/** Is point (x, y) inside polygon `poly` ([{x, y}…])? Even-odd ray casting. */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Does a player see a token right now? Their own and the party's always; anything else only inside a hero's vision,
 * or in light (`litPolys`) that a hero has a line of sight to (`sightPolys`). An explored room stays on the map as
 * a memory, but who is in it does not (owner's question, 2026-10-05): monsters were visible through the dim fog.
 */
export function playerSees(token, uid, { visionPolys = [], sightPolys = [], litPolys = [] } = {}) {
  if (token.type === 'player') return true;
  const p = [token.x, token.y];
  if (visionPolys.some(poly => pointInPoly(...p, poly))) return true;
  return litPolys.some(poly => pointInPoly(...p, poly)) && sightPolys.some(poly => pointInPoly(...p, poly));
}

/**
 * May `attacker` hit `target` with a weapon of this `reach` (lk-rules5e weaponReach), and with advantage or
 * disadvantage? Pure. Distances are counted in squares, 5 ft each, diagonals too (the table's grid rule).
 * - melee if within reach; otherwise a ranged or thrown attack within its long range;
 * - ranged: disadvantage beyond normal range, and with an enemy standing next to the attacker;
 * - flanking (an optional rule): a melee attack with an ally on the far side of the target has advantage.
 * Owner, 2026-10-05: "attacks only if the player is within the appropriate range".
 * Returns { ok, reason, mode: 'melee'|'ranged', adv, dis, feet }.
 */
export function attackCheck({ attacker, target, reach, tokens = [], gs = 50, flanking = false }) {
  const cell = t => ({ cx: Math.floor(t.x / gs), cy: Math.floor(t.y / gs) });
  const a = cell(attacker), t = cell(target);
  const sqs = (p, q) => Math.max(Math.abs(p.cx - q.cx), Math.abs(p.cy - q.cy));
  const feet = sqs(a, t) * 5;
  const name = target.name || 'That target';
  if (!reach) return { ok: false, reason: 'That is not a weapon you can attack with.', feet };
  const foe = x => x.id !== attacker.id && x.type !== attacker.type && (x.type === 'player' || x.type === 'monster')
    && (x.hp ?? 1) > 0 && !x.waiting;
  if (reach.melee && feet <= reach.melee) {
    let adv = false;
    if (flanking && feet === 5) {
      const far = { cx: 2 * t.cx - a.cx, cy: 2 * t.cy - a.cy };
      adv = tokens.some(x => x.id !== attacker.id && x.type === attacker.type && (x.hp ?? 1) > 0 && !x.waiting
        && sqs(cell(x), far) === 0);
    }
    return { ok: true, mode: 'melee', adv, dis: false, feet, flanked: adv };
  }
  if (reach.long && feet <= reach.long) {
    const crowded = tokens.some(x => foe(x) && sqs(cell(x), a) <= 1);
    const far = reach.normal != null && feet > reach.normal;
    return { ok: true, mode: 'ranged', adv: false, dis: crowded || far, feet, crowded, far };
  }
  const can = reach.long ? `${reach.long} ft at most` : `${reach.melee} ft`;
  return { ok: false, reason: `${name} is ${feet} ft away: out of reach (${can}).`, feet };
}

/** May I attack now, in a fight: on my turn, with attacks left? `used` attacks so far this turn. */
export function attackTurnCheck({ fightOn, myTurn, used = 0, perAction = 1 }) {
  if (!fightOn) return { ok: true };
  if (!myTurn) return { ok: false, reason: 'It is not your turn: you can attack on your turn.' };
  if (used >= perAction) return { ok: false, reason: perAction > 1 ? `You have made all ${perAction} of your attacks this turn.` : 'You have already attacked this turn.' };
  return { ok: true };
}

/**
 * Where a wall or door end lands: on an existing wall or door end within `radius` (so walls join up), else on the
 * nearest grid corner when `grid` ({ gs, ox, oy }) is given, else where the pointer is (owner, 2026-10-05).
 */
export function snapWallPoint(p, ends = [], grid = null, radius = 12) {
  let best = null, bd = radius;
  for (const e of ends) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d <= bd) { bd = d; best = e; } }
  if (best) return { x: best.x, y: best.y, snapped: 'end' };
  if (grid) {
    const { gs, ox = 0, oy = 0 } = grid;
    return { x: ox + Math.round((p.x - ox) / gs) * gs, y: oy + Math.round((p.y - oy) / gs) * gs, snapped: 'grid' };
  }
  return { x: p.x, y: p.y, snapped: null };
}

/** A new hero's token, waiting beside the map (waitingSpot). */
export function newWaitingToken(uid, summary, memberIdx, gs, colorCount, mapH = 0) {
  const { x, y } = waitingSpot(memberIdx, gs, mapH);
  return { ...newPlayerToken(uid, summary, memberIdx, x, y, colorCount), waiting: true };
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

/** The world point at the centre of a window (pan and zoom as on MAP). Sent at session start (map:view). */
export function viewCentre(panX, panY, zoom, w, h) {
  return { cx: (w / 2 - panX) / zoom, cy: (h / 2 - panY) / zoom };
}

/** The pan that puts world point (cx, cy) at the centre of a w×h window at `zoom`. */
export function panFor(cx, cy, zoom, w, h) {
  return { panX: w / 2 - cx * zoom, panY: h / 2 - cy * zoom };
}
