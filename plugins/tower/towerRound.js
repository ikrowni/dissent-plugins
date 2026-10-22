import { newClimber, respawnAbove, stepClimber } from "./climb.js";
import { landsOnHead, stepBomb } from "./fight.js";
import { ITEM_INFO } from "./items.js";
import { stepMist } from "./mist.js";
import { Remote, Sender } from "./net.js";
import { placesOf, REPORT_DELAY_MS, roundOver, standings } from "./roundEnd.js";
import { applyBlast, openCrate, receive, applyItem } from "./roundEffects.js";
import { posMsg } from "./towerProtocol.js";
import { floorOf, genTower, moveLedges, placeCrates } from "./towerGen.js";
import { COUNT_MS, FH, FIGHT, ITEMS, MIST, MODES, MOVE, WW } from "./tuning.js";

/**
 * One round on this machine (spec §3, §7): the tower from the node's seed, my climber (none when watching),
 * the others as they arrive over the relay, the mist, the clock, and piece 3's fight: punches, head bounces,
 * crates and pick-ups, bombs, and the five playstyles. No React and no network calls: the component feeds it
 * steps, messages and time, and asks it what to send, what to show and what happened (`events`).
 * What arriving messages and used items DO lives in roundEffects.js; when the round is over, in roundEnd.js.
 */

/** Eight colours for the seats, in seat order (spec §5: a clash gets the next free one). */
export const SEAT_COLORS = ["#f472b6", "#38bdf8", "#34d399", "#f59e0b", "#a78bfa", "#f87171", "#facc15", "#2dd4bf"];

export class Round {
  tower;
  /** The tower's height (Last standing builds a tower with no real top). */
  floors;
  me;
  others = new Map();
  /** Race clock: ms since GO; negative during the countdown. */
  raceMs = -COUNT_MS * 3;
  mistY = MIST.startY;
  myFinishMs = null;
  myOutMs = null;
  myCrownMs = 0;
  crownFirstMs = null;
  gaveUp = false;
  gaveUpMs = null;
  reported = false;
  /** When the round was first over from my view (race ms), or null. */
  overAtMs = null;
  // Fight and pick-ups (roundEffects.js changes these).
  item = null;
  // -Infinity, not -1: the race clock is NEGATIVE before GO, so "until -1" read as active all through the
  // countdown (piece 3 drew a shield, a punch and ink blots on everyone until GO).
  shieldUntil = -Infinity;
  inkUntil = -Infinity;
  grappleReadyAt = 0;
  pendingGrapple = null;
  punchUntil = -Infinity;
  punchReadyAt = 0;
  hitStopMs = 0;
  opened = new Map();
  bombs = [];
  /** Messages waiting to go, besides my position. */
  queue = [];
  /** What happened since the component last looked. */
  events = [];
  sender = new Sender();
  finSent = false;
  quitSent = false;
  crownSentAt = -1;
  bombSeq = 0;

  round;
  selfId;
  seats;
  mode;

  constructor(round, seed, floors, selfId, seats, watching, mode = "race") {
    this.round = round;
    this.selfId = selfId;
    this.seats = seats;
    this.mode = mode;
    this.floors = mode === "last" ? MODES.lastFloors : floors;
    this.tower = genTower(seed, this.floors);
    placeCrates(this.tower, mode === "chaos", ITEMS.chaosShare);
    const i = Math.max(0, seats.findIndex((s) => s.id === selfId));
    // Spread the players along the ground; they drop in from above the view.
    this.me = watching ? null : newClimber(WW / 2 + (i - (seats.length - 1) / 2) * 70, -6 * FH);
    for (const s of seats) if (s.id !== selfId) this.others.set(s.id, { remote: new Remote(), seenFinishMs: null, seenOutMs: null, crownMs: 0, quit: false, quitMs: null });
  }

  get started() {
    return this.raceMs >= 0;
  }

  /** Still climbing: started, not finished, out or given up, not watching. */
  get live() {
    return !!this.me && this.started && this.myFinishMs === null && this.myOutMs === null && !this.gaveUp;
  }

  get shield() {
    return this.raceMs < this.shieldUntil;
  }

  /** Is a ledge icy for me right now (someone else's Slick)? */
  icy = (l) => (l.slickUntil ?? -Infinity) > this.raceMs && l.slickBy !== this.selfId;

  /** One fixed step. */
  step(intent, dt) {
    this.raceMs += dt * 1000;
    moveLedges(this.tower, Math.max(0, this.raceMs) / 1000);
    const me = this.me;
    if (me) this.stepMe(me, intent, dt);
    for (const b of this.bombs) if (stepBomb(b, this.tower, dt)) { (b).gone = true; applyBlast(this, b); }
    this.bombs = this.bombs.filter((b) => !(b).gone);
  }

  stepMe(me, intent, dt) {
    const live = this.live;
    const prevY = me.y;
    for (const e of stepClimber(me, live ? intent : { dir: 0, jumpPressed: false, jumpHeld: false, drop: false }, this.tower, dt, this.icy)) this.events.push(e);
    if (live && me.vy > 0 && me.stun <= 0) this.headBounce(me, prevY);
    if (live && intent.punch) this.punch(me);
    if (live && intent.use && this.item) applyItem(this, me);
    if (live) openCrate(this, me);
    if (!this.started) return;

    const outs = (this.myOutMs !== null ? 1 : 0) + [...this.others.values()].filter((o) => o.seenOutMs !== null).length;
    const mistStopped = this.mode === "koth" && this.crownFirstMs !== null;
    if (!mistStopped) this.mistY = stepMist(this.mistY, this.raceMs, this.leaderY(), this.floors, dt, this.mode === "last" ? MODES.lastPerOut * outs : 0);
    if (live && me.y > this.mistY - 2 && !me.spawning) {
      if (this.mode === "last") {
        this.myOutMs = Math.round(this.raceMs);
        this.queue.push({ k: "out", t: this.myOutMs });
        this.events.push("out");
      } else {
        respawnAbove(me, this.tower, this.mistY, MIST.respawnFloors, MIST.blinkMs / 1000);
      }
    }
    const onTop = me.onGround && me.ledge !== null && me.ledge.floor >= this.floors;
    if (this.mode === "koth") {
      if (live && onTop) this.holdCrown(dt);
    } else if (this.mode !== "last" && live && onTop) {
      this.myFinishMs = Math.round(this.raceMs);
    }
  }

  headBounce(me, prevY) {
    for (const [, o] of this.others) {
      const s = o.remote.at(this.raceMs);
      if (!s || !landsOnHead(prevY, me, s)) continue;
      me.y = s.y - FIGHT.headTop;
      me.vy = -MOVE.jump * FIGHT.bounce;
      me.jumpHeld = true;
      me.squash = -0.5;
      me.jumpFloor = floorOf(me.y);
      this.events.push("bounce");
      return;
    }
  }

  punch(me) {
    if (this.mode === "nohit" || me.stun > 0 || this.raceMs < this.punchReadyAt) return;
    this.punchUntil = this.raceMs + FIGHT.punchMs;
    this.punchReadyAt = this.raceMs + FIGHT.cooldownMs;
    this.queue.push({ k: "atk", t: Math.round(this.raceMs), x: Math.round(me.x), y: Math.round(me.y), f: me.facing,
      run: Math.abs(me.vx) > MOVE.run * 0.6 || !me.onGround ? 1 : 0 });
    this.events.push("punch");
  }

  holdCrown(dt) {
    if (this.crownFirstMs === null) this.crownFirstMs = this.raceMs;
    // Alone on the crown counts; two or more and nobody's time counts (spec §3.4).
    const shared = [...this.others.values()].some((o) => {
      const s = o.remote.at(this.raceMs);
      return s && s.onGround && floorOf(s.y) >= this.floors;
    });
    if (shared) return;
    this.myCrownMs += dt * 1000;
    if (this.raceMs - this.crownSentAt >= MODES.crownSendMs) {
      this.crownSentAt = this.raceMs;
      this.queue.push({ k: "crown", t: Math.round(this.raceMs), held: Math.round(this.myCrownMs) });
      this.events.push("crown");
    }
  }

  /** The highest anyone is (up is negative), from my own figure and what the others last sent. */
  leaderY() {
    let y = this.me && this.myOutMs === null ? this.me.y : null;
    for (const o of this.others.values()) {
      const l = o.remote.latest;
      if (l && o.seenOutMs === null && (y === null || l.y < y)) y = l.y;
    }
    return y;
  }

  /** A relay message from another player. */
  receive(from, m) {
    receive(this, from, m);
  }

  /** A new bomb id, unique to me this round. */
  bombId() {
    return `${this.selfId.slice(0, 8)}-${++this.bombSeq}`;
  }

  /** What to send now: queued events, my finish/quit once, my position 20 a second. */
  outbox() {
    const me = this.me;
    if (!me || !this.started) return [];
    const out = this.queue.splice(0);
    if (this.myFinishMs !== null && !this.finSent) { this.finSent = true; out.push({ k: "fin", t: this.myFinishMs }); }
    if (this.gaveUp && !this.quitSent) { this.quitSent = true; out.push({ k: "quit", t: Math.round(this.raceMs) }); }
    if (this.sender.due(this.raceMs)) {
      // My claims ride along every time (roundEnd.js): a lost fin or out can't split the copies' rankings.
      const claims = {};
      if (this.myFinishMs !== null) claims.fn = this.myFinishMs;
      if (this.myOutMs !== null) claims.ot = this.myOutMs;
      if (this.mode === "koth") claims.cr = Math.round(this.myCrownMs);
      out.push(posMsg(this.raceMs, me, {
        st: me.stun > 0 ? 1 : 0, sh: this.shield ? 1 : 0, pu: this.raceMs < this.punchUntil ? 1 : 0,
        it: this.item ? ITEM_INFO[this.item].code : 0, ...claims,
      }));
    }
    return out;
  }

  limited() {
    this.sender.limited(this.raceMs);
  }

  /** The seats changed (someone left): forget anyone no longer seated. */
  setSeats(seats) {
    this.seats = seats;
    for (const id of [...this.others.keys()]) if (!seats.some((s) => s.id === id)) this.others.delete(id);
  }

  view() {
    const players = [];
    if (this.me) {
      players.push({ id: this.selfId, me: true, finishedMs: this.myFinishMs, outMs: this.myOutMs, crownMs: this.myCrownMs,
        floor: this.me.best, quit: this.gaveUp, quitMs: this.gaveUpMs });
    }
    for (const [id, o] of this.others) {
      players.push({ id, me: false, finishedMs: o.seenFinishMs, outMs: o.seenOutMs, crownMs: o.crownMs,
        floor: o.remote.latest?.b ?? 0, quit: o.quit, quitMs: o.quitMs });
    }
    return { mode: this.mode, raceMs: this.raceMs, crownFirstMs: this.crownFirstMs, players };
  }

  /** My report is due REPORT_DELAY_MS after the round is over as I see it (roundEnd.js says why never sooner). */
  reportDue() {
    if (!this.me || this.reported || !this.started) return false;
    if (this.overAtMs === null) {
      if (!roundOver(this.view())) return false;
      this.overAtMs = this.raceMs;
    }
    return this.raceMs - this.overAtMs >= REPORT_DELAY_MS; // the others' last claims arrive meanwhile
  }

  /** My report: the round's places as this machine ranks them from everyone's claims. */
  report() {
    return { round: this.round, places: placesOf(this.view()) };
  }

  standings() {
    return standings(this.view());
  }
}
