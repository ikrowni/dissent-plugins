import { knock } from "./climb.js";
import { blast, punchLands } from "./fight.js";
import { band, draw, ITEM_INFO, oddsFor, placeShare } from "./items.js";

import { floorOf } from "./towerGen.js";

import { FH, FIGHT, ITEMS } from "./tuning.js";

/**
 * What arriving messages and used pick-ups DO to my round (spec §3.5–3.6, §7). 🔴 Everything here acts on MY
 * figure only: another machine's message can knock me, ink me or swap me, but each machine moves its own player
 * and decides against what its own screen showed. A shield stops the next hit, blast, ink or grapple.
 */

const nameless = (r, id) => r.seats.find((s) => s.id === id)?.name ?? "Someone";

/** Uses up my shield if it's up. True = the shield took it. */
function shielded(r) {
  if (!r.shield) return false;
  r.shieldUntil = -Infinity;
  r.events.push("shield-pop");
  return true;
}

/** A finish claim, if it could be true: no faster than MIN_MS_PER_FLOOR a floor (the node used to refuse those; now
 *  every honest copy does, the same way, so the copies still agree). */
export const MIN_MS_PER_FLOOR = 300;
function claimFinish(r, o, t) {
  if (o.seenFinishMs !== null || t < r.floors * MIN_MS_PER_FLOOR) return;
  o.seenFinishMs = t;
}

export function receive(r, from, m) {
  const o = r.others.get(from);
  if (!o) return;
  const now = Math.max(0, Math.round(r.raceMs));
  const me = r.me;
  switch (m.k) {
    // 🔴 Every copy ranks the round from what each player CLAIMED (their own race clock), never from when the
    // claim reached this machine: the node settles only when the reports agree, and arrival times never do.
    case "p":
      o.remote.push(m, r.raceMs);
      if (m.fn !== undefined) claimFinish(r, o, m.fn);
      if (m.ot !== undefined && o.seenOutMs === null) o.seenOutMs = m.ot;
      if (m.cr !== undefined) o.crownMs = Math.max(o.crownMs, m.cr);
      return;
    case "fin": claimFinish(r, o, m.t); return;
    case "out": if (o.seenOutMs === null) { o.seenOutMs = m.t; r.events.push({ feed: `${nameless(r, from)} is out` }); } return;
    case "quit": if (!o.quit) { o.quit = true; o.quitMs = Math.max(0, m.t); } return;
    case "crown":
      o.crownMs = Math.max(o.crownMs, m.held);
      if (r.crownFirstMs === null) r.crownFirstMs = r.raceMs;
      return;
    case "bomb":
      r.bombs.push({ id: m.id, by: from, x: m.x, y: m.y, vx: m.vx, vy: m.vy, t: 0 });
      return;
    case "atk": {
      if (r.mode === "nohit" || !me || !r.live || me.stun > 0) return;
      const a = o.remote.at(r.raceMs) ?? { x: m.x, y: m.y };
      if (!punchLands(a, m.f, me)) return;
      if (shielded(r)) { r.events.push({ feed: `Your shield stopped ${nameless(r, from)}` }); return; }
      knock(me, m.f * (m.run ? FIGHT.knockXRunning : FIGHT.knockX), FIGHT.knockY, FIGHT.stunMs / 1000);
      r.hitStopMs = FIGHT.hitStopMs;
      r.events.push("hurt");
      return;
    }
    case "use": {
      if (m.item === "slick") {
        for (let f = m.floor + 1; f <= m.floor + ITEMS.slickFloors; f++) {
          for (const l of r.tower.byFloor[f] ?? []) { l.slickUntil = r.raceMs + ITEMS.slickMs; l.slickBy = from; }
        }
        if (me && floorOf(me.y) > m.floor && floorOf(me.y) <= m.floor + ITEMS.slickFloors) {
          r.events.push("iced");
          r.events.push({ feed: `${nameless(r, from)} iced the ledges around you` });
        }
        return;
      }
      if (!me || !r.live) return;
      if (m.item === "ink") {
        const s = o.remote.at(r.raceMs) ?? { y: m.y };
        if (me.y >= s.y - 20) return; // only those above the one who used it
        if (shielded(r)) return;
        r.inkUntil = r.raceMs + ITEMS.inkMs;
        r.events.push("inked");
        r.events.push({ feed: `${nameless(r, from)} inked you!` });
        return;
      }
      if (m.item === "grapple" && m.target === r.selfId) {
        if (shielded(r)) { r.queue.push({ k: "swap", t: now, to: from, ok: 0, x: Math.round(me.x), y: Math.round(me.y) }); return; }
        const was = { x: Math.round(me.x), y: Math.round(me.y) };
        Object.assign(me, { x: m.x, y: m.y, vx: 0, vy: -200, onGround: false, ledge: null, jumpFloor: floorOf(m.y) });
        r.queue.push({ k: "swap", t: now, to: from, ok: 1, ...was });
        r.events.push("grappled");
        r.events.push({ feed: `${nameless(r, from)} grappled past you!` });
      }
      return;
    }
    case "swap":
      if (m.to !== r.selfId || r.pendingGrapple !== from || !me) return;
      r.pendingGrapple = null;
      if (!m.ok) { r.events.push({ feed: `${nameless(r, from)}'s shield stopped your grapple` }); return; }
      Object.assign(me, { x: m.x, y: m.y, vx: 0, vy: -200, onGround: false, ledge: null, jumpFloor: floorOf(m.y) });
      r.events.push("swapped");
      return;
  }
}

/** A bomb goes off: every machine knocks only its own player (the thrower's too). */
export function applyBlast(r, b) {
  r.events.push({ boom: { x: b.x, y: b.y } });
  const me = r.me;
  if (!me || !r.live) return;
  const k = blast(b.x, b.y, me);
  if (!k || shielded(r)) return;
  knock(me, k.vx, k.vy, k.stunS);
  r.events.push("hurt");
}

/** Standing on a crate (not opened in the last 10 s, hands free): open it. */
export function openCrate(r, me) {
  const l = me.ledge;
  if (!me.onGround || !l?.crate || r.item || Math.abs(me.x - (l.x + l.w / 2)) > ITEMS.grab) return;
  if (r.raceMs - (r.opened.get(l.id) ?? -Infinity) < ITEMS.reopenMs) return;
  r.opened.set(l.id, r.raceMs);
  const rows = r.standings().filter((p) => p.outMs === null && !p.quit);
  const share = r.seats.length > 1 ? placeShare(rows.findIndex((p) => p.me) + 1, rows.length) : null;
  r.item = draw(oddsFor(r.mode, share, r.raceMs >= r.grappleReadyAt), Math.random);
  r.events.push({ crate: r.item, strong: share !== null && band(share) === "back" });
}

/** Uses what I'm holding (E). */
export function applyItem(r, me) {
  const it = r.item;
  if (!it) return;
  const t = Math.round(r.raceMs);
  const floor = Math.max(0, floorOf(me.y));
  switch (it) {
    case "updraft":
      Object.assign(me, { vy: -ITEMS.updraft, onGround: false, ledge: null, jumpFloor: floor, stun: 0 });
      break;
    case "shield":
      r.shieldUntil = r.raceMs + ITEMS.shieldMs;
      break;
    case "ink":
    case "slick":
      r.queue.push({ k: "use", t, item: it, floor, x: Math.round(me.x), y: Math.round(me.y) });
      if (it === "slick") for (let f = floor + 1; f <= floor + ITEMS.slickFloors; f++) {
        for (const l of r.tower.byFloor[f] ?? []) { l.slickUntil = r.raceMs + ITEMS.slickMs; l.slickBy = r.selfId; }
      }
      break;
    case "grapple": {
      // The nearest player above me on my screen (within a screen's height). Kept if nobody is in reach.
      let best = null;
      for (const [id, o] of r.others) {
        const s = o.remote.at(r.raceMs);
        if (!s || o.quit || o.seenOutMs !== null || o.seenFinishMs !== null) continue;
        const dy = me.y - s.y;
        if (dy > 20 && dy < FH * 9 && (!best || dy < best.dy)) best = { id, dy };
      }
      if (!best) { r.events.push({ feed: "Grapple: nobody above you on screen" }); return; }
      r.pendingGrapple = best.id;
      r.grappleReadyAt = r.raceMs + ITEMS.grappleCooldownMs;
      r.queue.push({ k: "use", t, item: "grapple", floor, x: Math.round(me.x), y: Math.round(me.y), target: best.id });
      break;
    }
    case "bomb": {
      const b = { id: r.bombId(), by: r.selfId, x: Math.round(me.x), y: Math.round(me.y - 34), vx: Math.round(me.facing * 430 + me.vx * 0.4), vy: -560, t: 0 };
      r.bombs.push(b);
      r.queue.push({ k: "bomb", t, id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy });
      break;
    }
  }
  r.events.push({ used: it, note: ITEM_INFO[it].name });
  r.item = null;
}
