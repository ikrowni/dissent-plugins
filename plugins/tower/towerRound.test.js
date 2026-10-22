import { describe, expect, it } from "vitest";
import { Round } from "./towerRound.js";
import { NO_INTENT } from "./climb.js";

import { posMsg } from "./towerProtocol.js";
import { COUNT_MS, FH, ITEMS, MODES, STEP } from "./tuning.js";
import { REPORT_DELAY_MS } from "./roundEnd.js";

const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
const CEE = "cccccccc-0000-4000-8000-000000000003";
const seats = [{ id: "me", name: "alice", color: "#f00" }, { id: BOB, name: "bob", color: "#0f0" }];
const IDLE = { ...NO_INTENT, punch: false, use: false };
const run = (r, ms, i = {}) => { for (let t = 0; t < ms; t += STEP * 1000) r.step({ ...IDLE, ...i }, STEP); };
const press = (r, i) => r.step({ ...IDLE, ...i }, STEP);
/** The report waits REPORT_DELAY_MS after the round is over from my view (the others' last claims arrive). */
const dueAfterDelay = (r) => { if (r.reportDue()) return true; r.raceMs += REPORT_DELAY_MS; return r.reportDue(); };
const placeOf = (rep, id) => rep.places.find((p) => p.user_id === id);
const started = (mode = "race", s = seats) => { const r = new Round(1, 42, 50, "me", s, false, mode); run(r, 2000); return r; };
/** bob, as his messages place him (enough of them that the 150 ms-behind view has caught up). */
const bobAt = (r, x, y, extra = {}) => {
  for (let k = 0; k < 8; k++) {
    r.receive(BOB, { ...posMsg(r.raceMs - 400 + k * 50, { x, y, vx: 0, vy: 0, onGround: true, facing: 1, phase: 0, squash: 0, blink: 0, best: Math.max(0, Math.round(-y / FH)) }), ...extra });
  }
  r.raceMs += 300;
};

describe("a round on this machine", () => {
  it("counts down 3·2·1, then GO; nothing is sent before GO", () => {
    const r = new Round(1, 42, 50, "me", seats, false);
    expect(r.started).toBe(false);
    expect(r.outbox()).toEqual([]);
    run(r, COUNT_MS * 3 + 20);
    expect(r.started).toBe(true);
    expect(r.outbox().map((m) => m.k)).toEqual(["p"]);
  });

  it("🔴 before GO nobody is shielded, inked or punching (the clock is negative then)", () => {
    const r = new Round(1, 42, 50, "me", seats, false);
    r.raceMs = -4400; // the intro and the countdown
    expect(r.shield).toBe(false);
    expect(r.raceMs < r.inkUntil).toBe(false);
    expect(r.raceMs < r.punchUntil).toBe(false);
    expect(r.tower.ledges.some((l) => r.icy(l))).toBe(false); // no ledge is icy before anyone used Slick
  });

  it("everyone drops onto the ground floor at the start", () => {
    expect(started().me?.ledge?.type).toBe("ground");
  });

  it("reaching the top finishes once, sends fin once, and the report waits for the others", () => {
    const r = started();
    const top = r.tower.byFloor[50][0];
    Object.assign(r.me, { x: top.x + 100, y: top.y - 5, vy: 200, onGround: false, ledge: null });
    run(r, 100);
    expect(r.myFinishMs).not.toBeNull();
    expect([...r.outbox(), ...r.outbox()].filter((m) => m.k === "fin")).toHaveLength(1);
    expect(r.reportDue()).toBe(false);
    r.receive(BOB, { k: "fin", t: 99_999 });
    expect(r.reportDue()).toBe(false); // over, but the others' last claims get REPORT_DELAY_MS to arrive
    expect(dueAfterDelay(r)).toBe(true);
    const rep = r.report();
    expect(rep.round).toBe(1);
    expect(rep.places[0]).toMatchObject({ user_id: "me", place: 1, score: 10_000_000 - r.myFinishMs });
    // 🔴 bob's OWN claim, not when it reached me: every copy ranks the same numbers, so the reports agree.
    expect(placeOf(rep, BOB)).toMatchObject({ place: 2, score: 10_000_000 - 99_999, label: "1:39.9" });
  });

  it("someone leaving the table doesn't hold the report up", () => {
    const r = started();
    r.myFinishMs = 1000;
    expect(r.reportDue()).toBe(false);
    r.setSeats([seats[0]]);
    expect(dueAfterDelay(r)).toBe(true);
  });

  it("🔴 giving up sends quit but does NOT report while others still race (it would start the node's 30 s settle)", () => {
    const r = started();
    r.gaveUp = true;
    expect(r.outbox().some((m) => m.k === "quit")).toBe(true);
    expect(r.reportDue()).toBe(false);
    r.receive(BOB, { k: "fin", t: 25_000 });
    expect(dueAfterDelay(r)).toBe(true);
    expect(r.report().places.map((p) => p.user_id)).toEqual([BOB, "me"]); // I gave up: placed by my floor
    const s = started();
    s.myFinishMs = 5000;
    s.receive(BOB, { k: "quit", t: 4000 });
    expect(dueAfterDelay(s)).toBe(true);
  });

  it("the mist catches a player who idles, and puts them back above it", () => {
    const r = started("race", [seats[0]]);
    run(r, 40_000);
    expect(r.me.y).toBeLessThan(r.mistY);
    expect(r.me.ledge.floor).toBeGreaterThan(0);
  });

  it("drops messages from people not at the table", () => {
    const r = started();
    r.receive("stranger", { k: "fin", t: 1 });
    expect(r.others.has("stranger")).toBe(false);
  });
});

describe("the fight", () => {
  it("J punches: an atk goes out with where I stand; never in No hitting", () => {
    const r = started();
    press(r, { punch: true });
    expect(r.outbox().find((m) => m.k === "atk")).toMatchObject({ k: "atk", f: 1 });
    press(r, { punch: true }); // cooldown
    expect(r.outbox().filter((m) => m.k === "atk")).toHaveLength(0);
    const n = started("nohit");
    press(n, { punch: true });
    expect(n.outbox().some((m) => m.k === "atk")).toBe(false);
  });

  it("a punch from bob next to me knocks me limp — judged from where I SEE bob; not from above; not through a shield", () => {
    const r = started();
    const me = r.me;
    bobAt(r, me.x - 20, me.y);
    r.receive(BOB, { k: "atk", t: 1, x: 9999, y: 9999, f: 1, run: 0 }); // his claimed spot is ignored
    expect(me.stun).toBeGreaterThan(0);
    expect(r.hitStopMs).toBeGreaterThan(0);
    expect(r.events).toContain("hurt");

    const above = started();
    bobAt(above, above.me.x - 20, above.me.y - 50);
    above.receive(BOB, { k: "atk", t: 1, x: 0, y: 0, f: 1, run: 0 });
    expect(above.me.stun).toBe(0);

    const shielded = started();
    shielded.shieldUntil = shielded.raceMs + 5000;
    bobAt(shielded, shielded.me.x - 20, shielded.me.y);
    shielded.receive(BOB, { k: "atk", t: 1, x: 0, y: 0, f: 1, run: 0 });
    expect(shielded.me.stun).toBe(0);
    expect(shielded.shield).toBe(false);
  });

  it("landing on bob's head bounces me up, unstunned", () => {
    const r = started();
    bobAt(r, 300, 0);
    Object.assign(r.me, { x: 302, y: -70, vy: 300, onGround: false, ledge: null });
    run(r, 60);
    expect(r.events).toContain("bounce");
    expect(r.me.stun).toBe(0);
  });

  it("standing on a crate opens it; the same crate again only after 10 s", () => {
    const r = started();
    const crate = r.tower.ledges.find((l) => l.crate && l.floor < 10);
    Object.assign(r.me, { x: crate.x + crate.w / 2, y: crate.y, onGround: true, ledge: crate, vx: 0 });
    press(r, {});
    expect(r.item).not.toBeNull();
    r.item = null;
    run(r, 1000);
    expect(r.item).toBeNull();
  });

  it("ink: mine goes out; bob's reaches me only when I'm above him", () => {
    const r = started();
    r.item = "ink";
    press(r, { use: true });
    expect(r.outbox().find((m) => m.k === "use")).toMatchObject({ item: "ink" });
    bobAt(r, 100, 200); // bob below me
    r.receive(BOB, { k: "use", t: 1, item: "ink", floor: 0, x: 100, y: 200 });
    expect(r.raceMs < r.inkUntil).toBe(true);
    const s = started();
    bobAt(s, 100, -10 * FH); // bob above me
    s.receive(BOB, { k: "use", t: 1, item: "ink", floor: 10, x: 100, y: -10 * FH });
    expect(s.raceMs < s.inkUntil).toBe(false);
  });

  it("slick: bob's ice is icy for me; mine isn't for me", () => {
    const r = started();
    r.receive(BOB, { k: "use", t: 1, item: "slick", floor: 0, x: 1, y: 1 });
    const l = r.tower.byFloor[3][0];
    expect(r.icy(l)).toBe(true);
    const s = started();
    s.item = "slick";
    press(s, { use: true });
    expect(s.icy(s.tower.byFloor[3][0])).toBe(false);
  });

  it("grapple: I swap with bob above me when his machine says ok; his grapple on me moves me and answers", () => {
    const r = started();
    bobAt(r, 200, -3 * FH);
    r.item = "grapple";
    press(r, { use: true });
    expect(r.outbox().find((m) => m.k === "use")).toMatchObject({ item: "grapple", target: BOB });
    r.receive(BOB, { k: "swap", t: 1, to: "me", ok: 1, x: 200, y: -3 * FH });
    expect(r.me.x).toBe(200);
    expect(r.raceMs < r.grappleReadyAt).toBe(true); // 20 s cooldown

    const s = started();
    const was = { x: Math.round(s.me.x), y: Math.round(s.me.y) };
    s.receive(BOB, { k: "use", t: 1, item: "grapple", floor: 0, x: 50, y: 0, target: "me" });
    expect(s.me.x).toBe(50);
    expect(s.outbox().find((m) => m.k === "swap")).toMatchObject({ to: BOB, ok: 1, ...was });
  });

  it("a bomb flies on every machine; its blast knocks only my own player, me included", () => {
    const r = started();
    r.item = "bomb";
    press(r, { use: true });
    expect(r.outbox().some((m) => m.k === "bomb")).toBe(true);
    const s = started();
    s.receive(BOB, { k: "bomb", t: 1, id: "b-1", x: Math.round(s.me.x), y: Math.round(s.me.y - 30), vx: 0, vy: 100 });
    run(s, 400);
    expect(s.events.some((e) => typeof e === "object" && "boom" in e)).toBe(true);
    expect(s.events).toContain("hurt");
  });
});

describe("the playstyles", () => {
  it("last standing: the mist puts me out; the round ends when one is left; I report my out time", () => {
    const r = started("last", [...seats, { id: CEE, name: "cee", color: "#00f" }]);
    expect(r.floors).toBe(MODES.lastFloors);
    r.mistY = r.me.y - 10;
    press(r, {});
    expect(r.myOutMs).not.toBeNull();
    expect(r.outbox().some((m) => m.k === "out")).toBe(true);
    expect(r.reportDue()).toBe(false); // bob and cee are both still standing
    r.receive(CEE, { k: "out", t: 1 });
    expect(dueAfterDelay(r)).toBe(true);
    const rep = r.report();
    expect(rep.places[0]).toMatchObject({ user_id: BOB, place: 1 }); // still standing
    expect(placeOf(rep, "me").score).toBe(r.myOutMs);
    expect(placeOf(rep, CEE)).toMatchObject({ place: 3, score: 1 }); // out first, at cee's own claimed 1 ms
  });

  it("king of the hill: alone on the top I gain crown time, sent once a second; 60 s ends the round", () => {
    const r = started("koth");
    const top = r.tower.byFloor[50][0];
    Object.assign(r.me, { x: 320, y: top.y, onGround: true, ledge: top });
    run(r, 2100);
    expect(r.myCrownMs).toBeGreaterThan(1900);
    expect(r.outbox().filter((m) => m.k === "crown").length).toBeGreaterThanOrEqual(2);
    expect(r.reportDue()).toBe(false);
    r.myCrownMs = MODES.crownWinMs;
    expect(dueAfterDelay(r)).toBe(true);
    expect(placeOf(r.report(), "me")).toMatchObject({ place: 1, score: MODES.crownWinMs, label: "Crown 1:00" });
  });

  it("king of the hill: two on the crown and nobody's time counts", () => {
    const r = started("koth");
    const top = r.tower.byFloor[50][0];
    bobAt(r, 300, top.y);
    Object.assign(r.me, { x: 340, y: top.y, onGround: true, ledge: top });
    run(r, 1000);
    expect(r.myCrownMs).toBe(0);
  });

  it("chaos puts many more crates on the tower", () => {
    const chaos = new Round(1, 42, 100, "me", seats, false, "chaos");
    const race = new Round(1, 42, 100, "me", seats, false, "race");
    const count = (r) => r.tower.ledges.filter((l) => l.crate).length;
    expect(count(chaos)).toBeGreaterThan(count(race) * 2);
    expect(ITEMS.chaosShare).toBe(0.6);
  });

  it("last standing: someone giving up counts as out then — the one still standing comes first", () => {
    const r = started("last");
    r.me.best = 2;
    bobAt(r, 100, -20 * FH); // bob climbed much higher
    r.receive(BOB, { k: "quit", t: 1 });
    expect(dueAfterDelay(r)).toBe(true);
    expect(r.standings()[0].id).toBe("me");
    expect(placeOf(r.report(), BOB)).toMatchObject({ place: 2, score: 1 });
  });
});

// The Tower plugin (2026-10-21): the node settles a round only when the players' reports agree, so every copy ranks
// from what each player CLAIMED, and the claims ride in every position message.
describe("claims", () => {
  it("my claims ride in every position message", () => {
    const r = started("race");
    r.myFinishMs = 20_000;
    r.raceMs += 1000;
    const p = r.outbox().find((m) => m.k === "p");
    expect(p.fn).toBe(20_000);
    const k = started("koth");
    k.myCrownMs = 1234.4;
    k.raceMs += 1000;
    expect(k.outbox().find((m) => m.k === "p").cr).toBe(1234);
  });

  it("a finish carried only in a position message still counts (the fin was lost)", () => {
    const r = started();
    bobAt(r, 100, -10 * FH, { fn: 30_000 });
    expect(r.view().players.find((p) => p.id === BOB).finishedMs).toBe(30_000);
  });

  it("🔴 an impossible finish claim is ignored the same way on every copy (faster than 300 ms a floor)", () => {
    const r = started(); // 50 floors: nothing under 15 s
    r.receive(BOB, { k: "fin", t: 14_999 });
    expect(r.view().players.find((p) => p.id === BOB).finishedMs).toBeNull();
    r.receive(BOB, { k: "fin", t: 15_000 });
    expect(r.view().players.find((p) => p.id === BOB).finishedMs).toBe(15_000);
  });

  it("two copies that heard the same claims in a different order report the same places", () => {
    const a = started(), b = started();
    a.myFinishMs = 40_000; b.myFinishMs = 40_000;
    a.receive(BOB, { k: "fin", t: 40_000 });
    b.raceMs += 3000; // b heard it later
    b.receive(BOB, { k: "fin", t: 40_000 });
    expect(dueAfterDelay(a) && dueAfterDelay(b)).toBe(true);
    const ranks = (r) => r.report().places.map((p) => `${p.user_id}:${p.place}`).sort();
    expect(ranks(a)).toEqual(ranks(b));
    expect(a.report().places.every((p) => p.place === 1)).toBe(true); // the same claimed time: a tie
  });
});

