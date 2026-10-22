import { drawJoints, posePoints } from "./drawFigure.js";
import { drawBlast, drawBomb, drawCrate, drawCrown, drawInk, drawLedge, drawMarkers, drawMist, drawName, drawSky, drawTop, drawWalls, SERIF } from "./drawNight.js";
import { layoutMarkers } from "./markers.js";
import { Ragdoll } from "./ragdoll.js";
import { floorOf } from "./towerGen.js";

import { FH, WW } from "./tuning.js";

/**
 * Draws one frame of a round (spec §3.3, §5). The camera follows my figure — or, watching or out, whoever leads —
 * and never shows below the ground. Others are drawn where the interpolation puts them (150 ms behind). A stunned
 * figure, mine or anyone's, flops as a ragdoll (ragdoll.js) carried along its real path.
 */

export const newViewState = () => ({ y: 0, dolls: new Map(), blasts: [] });

/** The view's height in world units for a canvas of css width w, height h. */
export const viewHeight = (w, h) => h / (w / WW);

function figure(c, v, id, f, stunned, nowS, dt, reduced) {
  const pose = posePoints(f, nowS, reduced);
  let doll = v.dolls.get(id);
  if (stunned && !doll) {
    doll = new Ragdoll(pose, f.vx, f.vy, (f.vx >= 0 ? 1 : -1) * 12, dt || 1 / 60);
    v.dolls.set(id, doll);
  }
  if (!doll) {
    drawJoints(c, pose, f.color, f.blink && Math.floor(nowS * 14) % 2 ? 0.35 : 1, !!f.shield, nowS);
    return;
  }
  if (stunned) doll.step({ x: f.x, y: f.y - 21 }, Math.min(dt, 1 / 30));
  else doll.recover();
  drawJoints(c, doll.joints(pose, stunned ? 0 : dt), f.color, 1, !!f.shield, nowS);
  if (doll.done) v.dolls.delete(id);
}

export function drawRound(c, r, v, cssW, cssH, dpr, dt, reduced) {
  const s = cssW / WW;
  const vh = viewHeight(cssW, cssH);
  const nowS = Math.max(0, r.raceMs) / 1000;
  const followMe = r.me && r.myOutMs === null && !r.gaveUp;
  const focusY = followMe && r.me ? r.me.y : r.leaderY() ?? r.me?.y ?? 0;
  const want = Math.min(focusY - vh * 0.6, 110 - vh);
  v.y += (want - v.y) * Math.min(1, dt * 6);
  const top = v.y;

  c.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
  drawSky(c, top, vh, Math.min(r.floors, 150), nowS, reduced);
  c.save();
  c.translate(0, -top);
  drawWalls(c, top, vh);
  const lo = Math.max(0, Math.floor(-(top + vh) / FH) - 1);
  const hi = Math.ceil(-top / FH) + 1;
  const me = r.me;
  for (let f = lo; f <= hi; f++) {
    for (const l of r.tower.byFloor[f] ?? []) {
      drawLedge(c, l, nowS, reduced, r.raceMs);
      // My copy of the crate: gone for 10 s after I open it.
      if (l.crate && me && r.raceMs - (r.opened.get(l.id) ?? -Infinity) >= 10_000) drawCrate(c, l.x + l.w / 2, l.y, nowS);
    }
  }
  const topY = -r.floors * FH;
  if (r.mode !== "last" && topY > top - 160) {
    if (r.mode === "koth") drawCrown(c, topY, nowS);
    else drawTop(c, topY, nowS);
  }
  for (const b of r.bombs) drawBomb(c, b.x, b.y, b.t);
  v.blasts = v.blasts.filter((b) => nowS - b.at < 0.35);
  for (const b of v.blasts) drawBlast(c, b.x, b.y, 1 - (nowS - b.at) / 0.35);

  const markers = [];
  for (const seat of r.seats) {
    if (seat.id === r.selfId) continue;
    const o = r.others.get(seat.id);
    const p = o?.remote.at(r.raceMs);
    if (!p || o?.seenOutMs != null) continue;
    const off = p.y - 50 < top || p.y > top + vh;
    if (off) {
      const label = `${p.y - 50 < top ? "▲" : "▼"} ${seat.name} ${Math.abs(floorOf(p.y) - floorOf(focusY))}`;
      c.font = `12px ${SERIF}`;
      markers.push({ id: seat.id, label, x: p.x, w: c.measureText(label).width + 16, up: p.y - 50 < top, color: seat.color });
      continue;
    }
    figure(c, v, seat.id, { ...p, color: seat.color }, p.stunned, nowS, dt, reduced);
    drawName(c, seat.name, p.x, p.y);
  }
  if (me && r.myOutMs === null) {
    const seat = r.seats.find((x) => x.id === r.selfId);
    figure(c, v, r.selfId, {
      x: me.x, y: me.y, vx: me.vx, vy: me.vy, onGround: me.onGround, facing: me.facing, phase: me.phase, squash: me.squash,
      blink: me.blink > 0, color: seat?.color ?? "#f472b6", punching: r.raceMs < r.punchUntil, shield: r.shield,
    }, me.stun > 0, nowS, dt, reduced);
  }
  drawMist(c, r.mistY, top, vh, nowS);
  c.restore();

  const laid = layoutMarkers(markers);
  drawMarkers(c, laid.map((m) => ({ ...m, color: markers.find((x) => x.id === m.id)?.color ?? "#fff" })), 92 / s, vh);
  if (r.raceMs < r.inkUntil) drawInk(c, vh, r.inkUntil - r.raceMs, Math.floor(r.inkUntil));
}
