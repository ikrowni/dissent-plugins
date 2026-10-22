import { describe, expect, it } from "vitest";
import { genTower, moveLedges, placeCrates, SECTION_NAMES } from "./towerGen.js";
import { newClimber, stepClimber } from "./climb.js";
import { FH, MOVE, STEP, WL, WR } from "./tuning.js";

const PINNED = 1394088428; // the same on piece 2's live code (checked 2026-10-20)

describe("genTower", () => {
  it("builds the same tower from the same seed, every time", () => {
    const strip = (t) => JSON.stringify(t.ledges);
    expect(strip(genTower(1234, 100))).toBe(strip(genTower(1234, 100)));
    expect(strip(genTower(1234, 100))).not.toBe(strip(genTower(1235, 100)));
  });

  it("has the ground, a landing every 10th floor, a ledge on most floors, all inside the walls", () => {
    const t = genTower(77, 150);
    expect(t.byFloor[0][0].type).toBe("ground");
    for (let f = 10; f <= 150; f += 10) expect(t.byFloor[f][0].type).toBe("landing");
    expect(t.byFloor[150][0].type).toBe("landing");
    for (const l of t.ledges) {
      expect(l.x).toBeGreaterThanOrEqual(WL);
      expect(l.x + l.w).toBeLessThanOrEqual(WR + 0.001);
      expect(l.y).toBe(-l.floor * FH);
    }
    expect(t.byFloor[10][0].section).toBe("zigzag"); // the first section is always the gentle one
  });

  it("🔴 the tower for a seed never changes: web and desktop on different versions must climb the same tower", () => {
    // A fingerprint of every ledge for one seed, pinned. If this fails, a change to the generator would give
    // players on an older client a different tower from everyone else's. Don't re-pin it: add new things
    // from their own random stream (as placeCrates does).
    const fp = genTower(1234, 150).ledges.map((l) => `${l.floor}:${l.type}:${Math.round(l.x * 100)}:${Math.round(l.w * 100)}`).join("|");
    let h = 5381;
    for (let i = 0; i < fp.length; i++) h = ((h * 33) ^ fp.charCodeAt(i)) >>> 0;
    expect(h).toBe(PINNED);
  });

  it("crates come from their own random stream: the ledges are the same with or without them", () => {
    const plainT = genTower(99, 100);
    const crated = genTower(99, 100);
    placeCrates(crated, false, 0.6);
    const strip = (t) => JSON.stringify(t.ledges.map(({ crate: _c, ...l }) => l));
    expect(strip(crated)).toBe(strip(plainT));
    const per = (t, base) => t.ledges.filter((l) => l.crate && l.floor >= base && l.floor < base + 10).length;
    for (let b = 1; b <= 100; b += 10) expect([1, 2]).toContain(per(crated, b));
    expect(crated.ledges.filter((l) => l.crate).every((l) => l.type === "plain")).toBe(true);
    const chaos = genTower(99, 100);
    placeCrates(chaos, true, 0.6);
    expect(chaos.ledges.filter((l) => l.crate).length).toBeGreaterThan(crated.ledges.filter((l) => l.crate).length * 2);
  });

  it("uses every section type across seeds", () => {
    const seen = new Set();
    for (let s = 0; s < 60; s++) for (const l of genTower(s, 150).ledges) if (l.section) seen.add(l.section);
    expect([...seen].sort()).toEqual([...SECTION_NAMES].sort());
  });
});

// ── Climbable: from the ground, the default movement reaches the top of every tower (spec §4) ─────────

/** Tries to get from standing on `a` to landing on `b` with real movement code: run up, jump, steer. */
function canReach(tower, a, b) {
  const bx = () => b.x + b.w / 2;
  for (const t0 of [0, 1.7, 3.4]) {
    for (const takeoff of [0, 50, 100, 160, 220, 290]) {
      moveLedges(tower, t0);
      const toward = bx() >= a.x + a.w / 2 ? 1 : -1;
      // Start at the far end of `a` from `b`, for the longest run-up.
      const c = newClimber(toward > 0 ? a.x + 9 : a.x + a.w - 9, a.y);
      Object.assign(c, { onGround: true, ledge: a, spawning: false, jumpFloor: a.floor });
      let jumped = false;
      if (a.type === "spring") { // nobody stands on a spring: it throws you up from its middle
        Object.assign(c, { x: a.x + a.w / 2, onGround: false, ledge: null, vy: -MOVE.spring });
        jumped = true;
      }
      let time = t0;
      for (let n = 0; n < 420; n++) {
        time += STEP;
        moveLedges(tower, time);
        const dx = bx() - c.x;
        const i = { dir: Math.abs(dx) > 6 ? (Math.sign(dx)) : 0, jumpPressed: false, jumpHeld: true, drop: false };
        if (!jumped && c.onGround && Math.abs(dx) <= takeoff + 8) { i.jumpPressed = true; jumped = true; }
        if (!jumped && c.onGround && c.ledge === a && (c.x - a.x < 10 || a.x + a.w - c.x < 10) && Math.sign(dx) === (c.x - a.x < 10 ? -1 : 1)) {
          i.jumpPressed = true; jumped = true; // at the edge: jump now rather than walk off
        }
        const ev = stepClimber(c, i, tower, STEP);
        if (c.ledge === b && (c.onGround || ev.includes("spring"))) return true;
        if (jumped && (c.onGround || ev.includes("spring")) && c.ledge !== b) break;
        if (c.y > a.y + FH * 2) break;
      }
    }
  }
  return false;
}

function topReachable(tower) {
  const seen = new Set ([tower.byFloor[0][0].id]);
  const queue = [tower.byFloor[0][0]];
  let best = 0;
  while (queue.length) {
    const a = queue.shift();
    best = Math.max(best, a.floor);
    if (a.floor === tower.floors) return { ok: true, stuckAt: -1 };
    for (let f = a.floor + 1; f <= Math.min(a.floor + 3, tower.floors); f++) {
      for (const b of tower.byFloor[f] ?? []) {
        if (seen.has(b.id)) continue;
        if (canReach(tower, a, b)) { seen.add(b.id); queue.push(b); }
      }
    }
  }
  return { ok: false, stuckAt: best };
}

describe("every tower is climbable", () => {
  it("reaches the top of 200 seeded 50-floor towers with the default movement", () => {
    const stuck = [];
    for (let s = 1; s <= 200; s++) {
      const t = genTower(s * 7919, 50);
      const r = topReachable(t);
      if (!r.ok) stuck.push(`seed ${s * 7919} stuck at floor ${r.stuckAt} (${t.byFloor[Math.floor(r.stuckAt / 10) * 10 + 10]?.[0]?.section})`);
    }
    expect(stuck).toEqual([]);
  }, 120_000);
});
