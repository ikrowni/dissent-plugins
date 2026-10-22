/**
 * Every number the Tower's feel depends on, in one place (spec 2026-10-19-tower-game-design §8.3). Started from
 * the playable mock the owner approved (docs/design/tower-game-mock.html). World units: the tower is WW wide
 * whatever the panel's size; the view scales to fit the width.
 */

/** The tower's width, its two walls, and one floor's height. */
export const WW = 640;
export const WL = 22;
export const WR = WW - 22;
export const FH = 84;

/** The fixed game step: 120 a second, at most MAX_STEPS per frame. */
export const STEP = 1 / 120;
export const MAX_STEPS = 12;

export const MOVE = {
  run: 360,
  accel: 2600,
  airAccel: 1600,
  decel: 3200,
  gravity: 2300,
  fallMult: 1.55,
  jump: 760,
  /** Running at full speed adds this much to the jump (Icy Tower: run = jump higher). */
  speedJump: 0.4,
  /** Half gravity at the top of a held jump (Celeste). */
  apexHalf: true,
  apexBand: 140,
  coyoteMs: 100,
  bufferMs: 120,
  maxFall: 1500,
  /** Bouncing off a side wall in the air keeps this much speed. */
  wallKeep: 0.92,
  spring: 1180,
  /** Combos: jumps of 2+ floors in a row; 3 s without one ends it. */
  comboFloors: 2,
  comboMs: 3000,
};

/** The figure's collision width. */
export const BODY_W = 16;

/** The rising mist (§3.3): starts after startMs, faster every stepMs, much faster when far behind the leader. */
export const MIST = {
  startY: 260,
  startMs: 5000,
  speed: 26,
  stepMs: 30_000,
  stepSpeed: 12,
  catchUpFloors: 14,
  catchUpMult: 3.5,
  /** Caught: back on the first ledge this many floors above the mist, blinking. */
  respawnFloors: 3,
  blinkMs: 1200,
};

/** The network (§7.1, §10): 20 messages a second, others drawn this far in the past. */
export const NET = {
  sendMs: 50,
  delayMs: 150,
  /** With nothing new, keep a figure moving this long before it stops. */
  extrapolateMs: 100,
  /** After the node says we were too fast, send half as often for this long. */
  backoffMs: 2000,
};

/** GO is the node's start time + LEAD_MS + the countdown, on every machine (tower-main.js times it from the node's
 *  `elapsed_ms`, never this PC's clock). The lead covers the game frame loading after Start; the game fades in
 *  during it. */
export const LEAD_MS = 2600;

/** The countdown before GO: 3 · 2 · 1, this far apart. */
export const COUNT_MS = 600;

/** Hitting (spec §3.5): a punch reaches about one body width ahead, only at your own height. */
export const FIGHT = {
  reach: 42,
  height: 24,
  punchMs: 180,
  cooldownMs: 380,
  knockX: 520,
  knockXRunning: 600,
  knockY: -380,
  stunMs: 550,
  hitStopMs: 60,
  /** Landing on a head: you bounce up this share of a jump; they squash; nobody is stunned. */
  bounce: 0.8,
  headTop: 50,
  headHalfWidth: 15,
};

/** Pick-ups (spec §3.6). */
export const ITEMS = {
  reopenMs: 10_000,
  shieldMs: 10_000,
  grappleCooldownMs: 20_000,
  inkMs: 3000,
  slickMs: 7000,
  slickFloors: 8,
  updraft: 1320,
  bombFuseMs: 1600,
  bombRadius: 130,
  bombKnock: 640,
  bombLift: -660,
  bombStunMs: 750,
  /** Crates per 10-floor section: 1–2, or 60% of plain ledges in Chaos. */
  chaosShare: 0.6,
  /** Standing within this of a crate's middle opens it. */
  grab: 22,
};

/** Playstyles (spec §3.4). */
export const MODES = {
  /** Last standing has no top: the tower goes on (the node knows; it ignores floors there). */
  lastFloors: 500,
  /** Last standing: the mist rises this much faster for every player out. */
  lastPerOut: 6,
  /** King of the hill: hold the crown this long in total, or most after crownMaxMs from the first reach. */
  crownWinMs: 60_000,
  crownMaxMs: 5 * 60_000,
  crownSendMs: 1000,
};
